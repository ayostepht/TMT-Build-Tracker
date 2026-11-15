/**
 * Applying a saved design to a build that may have started printing (pure: no DB, Svelte or Node).
 *
 * Two modes:
 * - `colors` ("Colors only"): the build's slots take the design's filaments; part slots, locks, plates,
 *   print files, progress, logs and spools stay. `planRecolor` decides slot by slot.
 * - `full` ("Colors and print files"): also moves parts to the design's slots (`mutate.ts` replaceColors).
 *
 * The server (`designs/mutate.ts`) and the dialog preview (dry run) share these functions.
 */
import { materialFamily } from '../filament-catalog.ts';
import { stockKg } from './accounting.ts';
import { materialAllowed, sameFilament } from './design.ts';
import type { BuildView, FilamentRole, StartedInfo } from './types.ts';

export type ApplyMode = 'colors' | 'full';

export interface SlotColor {
	key: string;
	name: string;
	material: string;
	hex: string;
}

export interface SkippedSlot {
	role: string;
	/** The slot's current filament name (what stays). */
	name: string;
	reason: 'material' | 'locked';
}

export interface KeptStockSlot {
	role: string;
	/** The slot's name after the change. */
	name: string;
	/** The filament it held before. */
	was: string;
	/** Kilograms of stock on hand (spools plus later additions). */
	spools: number;
	/** The slot is linked to a Spoolman spool. */
	spoolman: boolean;
}

export interface RecolorPlan {
	/** Slots whose name, material or hex change. */
	changes: SlotColor[];
	skipped: SkippedSlot[];
	/** Changed slots that keep spools or a Spoolman link although the filament is another one now. */
	keptStock: KeptStockSlot[];
}

/** What the dry run (`POST /api/designs/[id]/apply` with `dryRun`) and the dialog preview carry. */
export interface ApplyPreview extends RecolorPlan {
	started: StartedInfo;
	summary: string;
	/** Why "Colors and print files" is refused right now, or null. */
	fullBlocked: string | null;
}

interface DesignLike {
	roles: SlotColor[];
	partRoles: Record<string, string>;
}

const norm = (hex: string) => hex.toLowerCase();

/** Do two materials stay in the same family (PLA/PLA+ yes, PLA/TPU no)? */
export function sameMaterialFamily(a: string, b: string): boolean {
	return materialFamily(a) === materialFamily(b);
}

/**
 * "Colors only": for each slot of the build the target is the design's slot with the same key; with none,
 * the design color most common among the slot's unlocked parts; with none of those, the slot is left alone
 * (and not reported: the design says nothing about it). A slot is skipped (and reported) when the target
 * is another material family, no part on it may use the target's material, or it holds locked parts.
 */
export function planRecolor(
	view: Pick<BuildView, 'allParts' | 'filaments'>,
	d: DesignLike
): RecolorPlan {
	const changes: SlotColor[] = [];
	const skipped: SkippedSlot[] = [];
	const keptStock: KeptStockSlot[] = [];
	for (const f of view.filaments) {
		const onSlot = view.allParts.filter((p) => p.role === f.key);
		let target = d.roles.find((r) => r.key === f.key);
		if (!target) {
			const votes = new Map<string, number>();
			for (const p of onSlot) {
				if (p.locked) continue;
				const k = d.partRoles[p.slug];
				if (k) votes.set(k, (votes.get(k) ?? 0) + 1);
			}
			let best = 0;
			for (const [k, n] of votes)
				if (n > best && d.roles.some((r) => r.key === k)) {
					best = n;
					target = d.roles.find((r) => r.key === k);
				}
		}
		if (!target) continue;
		const to = { key: f.key, name: target.name, material: target.material, hex: norm(target.hex) };
		if (sameFilament(f, to)) continue;
		if (onSlot.some((p) => p.locked)) {
			skipped.push({ role: f.key, name: f.name, reason: 'locked' });
			continue;
		}
		if (
			!sameMaterialFamily(f.material, to.material) ||
			onSlot.some((p) => !materialAllowed(p.allowedMaterials, to.material))
		) {
			skipped.push({ role: f.key, name: f.name, reason: 'material' });
			continue;
		}
		changes.push(to);
		const kg = stockKg(f);
		if (kg > 0 || f.spoolmanSpoolId !== null)
			keptStock.push({
				role: f.key,
				name: to.name,
				was: f.name,
				spools: kg,
				spoolman: f.spoolmanSpoolId !== null
			});
	}
	return { changes, skipped, keptStock };
}

/** Why "Colors and print files" is refused: a plate is printing or a printer job is live. Null when allowed. */
export function fullReplaceBlock(info: StartedInfo): string | null {
	if (info.printingPlates.length)
		return info.printingPlates.length === 1
			? `Plate ${info.printingPlates[0]} is printing right now.`
			: `Plates ${info.printingPlates.join(', ')} are printing right now.`;
	if (info.liveJobs) return 'A printer job is running for this build.';
	return null;
}

/** The build's colors and part colors as they are now: stored with the activity row and used by Undo. */
export interface DesignSnapshot {
	roles: SlotColor[];
	partRoles: Record<string, string>;
	lockedParts: string[];
}

export function designSnapshot(view: Pick<BuildView, 'allParts' | 'filaments'>): DesignSnapshot {
	return {
		roles: view.filaments.map((f: FilamentRole) => ({
			key: f.key,
			name: f.name,
			material: f.material,
			hex: f.hex
		})),
		partRoles: Object.fromEntries(view.allParts.map((p) => [p.slug, p.role])),
		lockedParts: view.allParts.filter((p) => p.locked).map((p) => p.slug)
	};
}

/**
 * One `PATCH /api/builds/[id]/design` body that puts a snapshot back: the old filaments (no reset), every
 * part's old slot, locks as they were, and `removeRoles` for slots added since (`currentKeys` = slots now).
 */
export function undoPatch(
	before: DesignSnapshot,
	current: Pick<BuildView, 'allParts' | 'filaments'>
) {
	const have = new Set(current.filaments.map((f) => f.key));
	const keep = before.roles.filter((r) => have.has(r.key));
	const added = current.filaments
		.map((f) => f.key)
		.filter((k) => !before.roles.some((r) => r.key === k));
	const wasLocked = new Set(before.lockedParts);
	const nowLocked = new Set(current.allParts.filter((p) => p.locked).map((p) => p.slug));
	const unlock = [...nowLocked].filter((s) => !wasLocked.has(s));
	const relock = before.lockedParts.filter((s) => !nowLocked.has(s));
	return {
		palette: {
			label: 'previous',
			slots: Object.fromEntries(
				keep.map((r) => [r.key, { name: r.name, material: r.material, hex: r.hex }])
			)
		},
		partRoles: before.partRoles,
		...(relock.length ? { lock: { slugs: relock, locked: true } } : {}),
		...(unlock.length && !relock.length ? { lock: { slugs: unlock, locked: false } } : {}),
		...(added.length ? { removeRoles: added } : {})
	};
}
