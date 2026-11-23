import { and, eq } from 'drizzle-orm';
import {
	effectivePartRoles,
	materialAllowed,
	newRoleKey,
	ROLE_KEY_RE,
	roleBlockedReason,
	sameFilament
} from '#lib/domain/design.ts';
import { stockKg } from '#lib/domain/accounting.ts';
import {
	designSnapshot,
	fullReplaceBlock,
	planRecolor,
	type ApplyMode,
	type ApplyPreview,
	type RecolorPlan
} from '#lib/domain/design-apply.ts';
import { startedSummary } from '#lib/domain/started.ts';
import type { BuildView, FilamentRole } from '#lib/domain/types.ts';
import { ApiError, buildAccess } from '../access';
import { mutateBuild } from '../builds/actions';
import { remapRoleKey } from '../builds/role-keys';
import { BuildStartedError } from '../builds/started-guard';
import { loadBuildView } from '../builds/view';
import type { Db } from '../db';
import { buildCustomPieces, buildFilaments, builds, colorDesigns } from '../db/schema';
import { canSeeDesign } from './access';
import { isObj, type Obj } from '#lib/domain/guards.ts';

function bad(msg: string): never {
	throw new ApiError(400, msg);
}

export interface DesignRole {
	key: string;
	name: string;
	material: string;
	hex: string;
}

const rolesOf = (filaments: FilamentRole[]): DesignRole[] =>
	filaments.map((f) => ({ key: f.key, name: f.name, material: f.material, hex: f.hex }));

function str(v: unknown, field: string, max = 100): string {
	if (typeof v !== 'string' || !v.trim() || v.length > max)
		bad(`${field} must be a non-empty string`);
	return v.trim();
}
function hexOf(v: unknown): string {
	if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) bad('hex must be like #1a2b3c');
	return v.toLowerCase();
}

/**
 * Edit a build's color design (editors and owners; one `design.update` activity row and one SSE event per call).
 * Parts of the body run in this order inside one transaction:
 *
 * - `addRole: { key?, name, material, hex }`: add a slot.
 * - `confirm: true`: needed with `palette.reset` on a build that has started printing (otherwise 409
 *   `build-started`, see `BuildStartedError`); the activity row then carries `before` (the undo snapshot).
 * - `palette: { label, slots: { [roleKey]: { name, material, hex } }, reset?: true }`: set those slots'
 *   filaments. With `reset`, every unlocked part goes back to its kit slot, and a locked part sitting on a
 *   slot whose filament changes moves to a slot holding its old filament (an existing non-kit slot with the
 *   same name/material/hex, else a new one, reported as `lockedAdded`). Without `reset` (Undo) only the
 *   filaments are written.
 * - `partRoles: { slug: roleKey }`: move parts.
 * - `lock: { slugs, locked }`: "Lock part color" on or off (exactly the parts listed; never expanded to symmetry peers) (`design.lockedParts`).
 * - `removeRole: key` (+ `replaceWith: key`): remove a slot. A used slot needs `replaceWith`; all its parts
 *   (also those of unchosen options) move there, and grams keyed to it follow. Its spools and Spoolman link go.
 * - `removeRoles: [key]`: remove slots that are unused by now (Undo of an auto-added lock slot).
 */
export function updateBuildDesign(db: Db, buildId: string, userId: string, body: unknown): void {
	if (!isObj(body)) bad('Invalid body');
	const keys = ['partRoles', 'addRole', 'removeRole', 'removeRoles', 'palette', 'lock'] as const;
	if (keys.every((k) => body[k] === undefined)) bad('Nothing to update');
	if (body.replaceWith !== undefined && body.removeRole === undefined)
		bad('replaceWith needs removeRole');
	mutateBuild(db, buildId, userId, (tx, view) => {
		const filaments: FilamentRole[] = [...view.filaments];
		const payload: Obj = {};
		const roles = effectivePartRoles(view);
		const partOf = (slug: string) => view.allParts.find((p) => p.slug === slug);
		const locked = new Set(view.allParts.filter((p) => p.locked).map((p) => p.slug));
		const moves: Obj[] = [];
		const move = (slug: string, role: string, record = true) => {
			const part = partOf(slug)!;
			const f = filaments.find((x) => x.key === role)!;
			roles[slug] = role;
			const prior = moves.find((m) => m.slug === slug);
			if (prior) Object.assign(prior, { role, roleName: f.name });
			else if (record) moves.push({ slug, name: part.name, role, roleName: f.name });
		};

		const insertSlot = (key: string, name: string, material: string, hex: string) => {
			tx.insert(buildFilaments)
				.values({ buildId, roleKey: key, name, material, hex, spools: 0 })
				.run();
			filaments.push({
				key,
				name,
				material,
				hex,
				tpu: false,
				spools: 0,
				recommendedSpools: 1,
				spoolmanSpoolId: null,
				kit: false
			});
		};

		if (body.addRole !== undefined) {
			if (!isObj(body.addRole)) bad('addRole must be an object');
			const a = body.addRole;
			const name = str(a.name, 'name');
			const material = str(a.material, 'material');
			const hex = hexOf(a.hex);
			let key: string;
			if (a.key === undefined || a.key === null || a.key === '') {
				key = newRoleKey(
					filaments.map((f) => f.key),
					name
				);
			} else {
				if (typeof a.key !== 'string' || !ROLE_KEY_RE.test(a.key)) bad('Invalid color key');
				if (filaments.some((f) => f.key === a.key))
					throw new ApiError(409, 'That color key exists');
				key = a.key;
			}
			insertSlot(key, name, material, hex);
			payload.added = { key, name, material, hex };
		}

		const applyPalette = (raw: unknown) => {
			if (!isObj(raw)) bad('palette must be an object');
			if (!isObj(raw.slots)) bad('palette.slots must be an object');
			const entries = Object.entries(raw.slots);
			if (!entries.length || entries.length > 20) bad('palette.slots needs 1 to 20 colors');
			const label = raw.label === undefined ? 'new' : str(raw.label, 'label', 200);
			const reset = raw.reset === true;
			if (reset && view.started.started) {
				if (body.confirm !== true)
					throw new BuildStartedError(
						view.started,
						'This build has started printing. Applying a palette this way sends part colors back to the kit slots.'
					);
				payload.before = designSnapshot(view);
			}
			const before = new Map(filaments.map((f) => [f.key, { ...f }]));
			const changed = new Set<string>();
			for (const [key, v] of entries) {
				const f = filaments.find((x) => x.key === key);
				if (!f) bad(`Unknown color "${key}"`);
				if (!isObj(v)) bad('Each palette slot must be an object');
				const name = str(v.name, 'name');
				const material = str(v.material, 'material');
				const hex = hexOf(v.hex);
				if (!sameFilament(f, { name, material, hex })) changed.add(key);
				tx.update(buildFilaments)
					.set({ name, material, hex })
					.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, key)))
					.run();
				Object.assign(f, { name, material, hex });
			}
			const pal: Obj = { label };
			payload.palette = pal;
			if (!reset) return;

			// Locked parts on a slot whose filament changed keep their exact color on another slot.
			const byOld = new Map<string, string[]>();
			for (const p of view.allParts)
				if (locked.has(p.slug) && changed.has(roles[p.slug]))
					byOld.set(roles[p.slug], [...(byOld.get(roles[p.slug]) ?? []), p.slug]);
			const lockedAdded: Obj[] = [];
			for (const [oldKey, slugs] of byOld) {
				const old = before.get(oldKey)!;
				let target = filaments.find((f) => !f.kit && !changed.has(f.key) && sameFilament(f, old));
				if (!target) {
					const key = newRoleKey(
						filaments.map((f) => f.key),
						old.name
					);
					insertSlot(key, old.name, old.material, old.hex);
					target = filaments[filaments.length - 1];
					lockedAdded.push({
						key,
						name: old.name,
						material: old.material,
						parts: slugs.map((s) => partOf(s)!.name)
					});
				}
				for (const s of slugs) move(s, target.key);
			}
			if (lockedAdded.length) payload.lockedAdded = lockedAdded;

			// Everything else goes back to the kit slot (unless that slot's new material cannot take the part).
			let resetCount = 0;
			for (const p of view.allParts) {
				if (locked.has(p.slug) || roles[p.slug] === p.defaultRole) continue;
				const f = filaments.find((x) => x.key === p.defaultRole);
				if (!f || roleBlockedReason(p, f)) continue;
				move(p.slug, p.defaultRole);
				resetCount++;
			}
			pal.reset = resetCount;
			pal.kept = locked.size;
		};
		if (body.palette !== undefined) applyPalette(body.palette);

		if (body.partRoles !== undefined) {
			if (!isObj(body.partRoles)) bad('partRoles must be an object');
			const entries = Object.entries(body.partRoles);
			if (entries.length > 500) bad('Too many parts');
			for (const [slug, role] of entries) {
				const part = partOf(slug);
				if (!part) bad(`Unknown part "${slug}"`);
				if (typeof role !== 'string') bad('Role keys must be strings');
				const f = filaments.find((x) => x.key === role);
				if (!f) bad(`Unknown color "${role}"`);
				const why = roleBlockedReason(part, f);
				if (why) bad(`${why}, so it cannot use ${f.name} (${f.material})`);
				if (roles[slug] === role) continue;
				move(slug, role);
			}
		}

		if (body.lock !== undefined) {
			if (!isObj(body.lock)) bad('lock must be an object');
			const { slugs, locked: on } = body.lock;
			if (!Array.isArray(slugs) || !slugs.length || slugs.length > 500)
				bad('lock.slugs is required');
			if (typeof on !== 'boolean') bad('lock.locked must be true or false');
			const changedNames: string[] = [];
			for (const slug of slugs) {
				const part = typeof slug === 'string' ? partOf(slug) : undefined;
				if (!part) bad(`Unknown part "${String(slug)}"`);
				if (locked.has(part.slug) === on) continue;
				if (on) locked.add(part.slug);
				else locked.delete(part.slug);
				changedNames.push(part.name);
			}
			if (changedNames.length) payload[on ? 'locked' : 'unlocked'] = changedNames;
		}

		const removeSlot = (key: string, replaceWith?: string): Obj => {
			const f = filaments.find((x) => x.key === key);
			if (!f) throw new ApiError(404, 'Unknown color');
			if (f.kit) bad("The kit's own colors cannot be removed");
			const affected = view.allParts.filter((p) => roles[p.slug] === key);
			// Custom parts (never in `roles`) on this slot move too; skipped ones are not in the view, so read the rows.
			const customOn = tx
				.select({ parts: buildCustomPieces.parts })
				.from(buildCustomPieces)
				.where(eq(buildCustomPieces.buildId, buildId))
				.all()
				.reduce((n, r) => n + (r.parts ?? []).filter((cp) => cp.role === key).length, 0);
			if (affected.length || customOn) {
				if (!replaceWith)
					throw new ApiError(409, 'Choose the color that replaces it for its parts first');
				if (replaceWith === key) bad('A color cannot replace itself');
				const to = filaments.find((x) => x.key === replaceWith);
				if (!to) bad(`Unknown color "${replaceWith}"`);
				const blocked = affected.filter((p) => roleBlockedReason(p, to));
				if (blocked.length)
					bad(
						`${to.name} (${to.material}) cannot take ${blocked.map((p) => p.name).join(', ')}: ${roleBlockedReason(blocked[0], to)}`
					);
				// The removal sentence already says where they went, so these moves are not listed separately.
				for (const p of affected) move(p.slug, to.key, false);
			} else if (replaceWith !== undefined && !filaments.some((x) => x.key === replaceWith))
				bad(`Unknown color "${replaceWith}"`);
			if (replaceWith) remapRoleKey(tx, buildId, key, replaceWith);
			tx.delete(buildFilaments)
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, key)))
				.run();
			filaments.splice(filaments.indexOf(f), 1);
			return {
				key,
				name: f.name,
				material: f.material,
				hex: f.hex,
				spools: stockKg(f),
				...(f.spoolmanSpoolId !== null ? { spoolmanSpoolId: f.spoolmanSpoolId } : {}),
				parts: affected.length + customOn
			};
		};

		if (body.removeRole !== undefined) {
			const key = str(body.removeRole, 'removeRole');
			const rep = body.replaceWith === undefined ? undefined : str(body.replaceWith, 'replaceWith');
			const removed = removeSlot(key, rep);
			payload.removed = removed;
			const to = rep ? filaments.find((f) => f.key === rep) : undefined;
			if (to && removed.parts)
				payload.replacedBy = { key: to.key, name: to.name, material: to.material };
		}
		if (body.removeRoles !== undefined) {
			if (!Array.isArray(body.removeRoles) || body.removeRoles.length > 20)
				bad('removeRoles must be a list of color keys');
			for (const k of body.removeRoles) {
				const key = str(k, 'removeRoles');
				if (view.allParts.some((p) => roles[p.slug] === key))
					throw new ApiError(409, 'Move its parts to another color first');
				removeSlot(key);
			}
		}

		if (moves.length) payload.moves = moves;
		if (!Object.keys(payload).length) {
			if (body.lock !== undefined) return { kind: 'design.update', skip: true };
			bad('Nothing to update');
		}
		const row = tx
			.select({ design: builds.design })
			.from(builds)
			.where(eq(builds.id, buildId))
			.get();
		const { lockedParts: _drop, ...rest } = (row?.design ?? {}) as Obj;
		void _drop;
		// Slugs that no longer exist in the template are dropped; the rest keep their template order.
		const lockedParts = view.allParts.map((p) => p.slug).filter((s) => locked.has(s));
		tx.update(builds)
			.set({
				design: {
					...rest,
					roles: rolesOf(filaments),
					partRoles: roles,
					...(lockedParts.length ? { lockedParts } : {})
				}
			})
			.where(eq(builds.id, buildId))
			.run();
		return { kind: 'design.update', payload };
	});
}

export interface ApplyDesignOptions {
	/** `colors`: slot filaments only. `full`: also every part's slot. Required on a build that has started. */
	mode?: ApplyMode;
	/** `full` on a started build (not printing) needs this, else 409 `build-started`. */
	confirm?: boolean;
}

function visibleDesign(db: Db, designId: string, userId: string) {
	const d = db.select().from(colorDesigns).where(eq(colorDesigns.id, designId)).get();
	if (!d || !canSeeDesign(db, d, userId)) throw new ApiError(404, 'Not found');
	return d;
}

/**
 * Apply a saved design to a build (editors and owners of the build; the design must be visible to them and
 * be for the same template).
 *
 * - Build not started (nothing printed, nothing printing, no live job): replaces the colors and every part's
 *   slot, as always (`mode` `colors` recolors only).
 * - Build started: needs a `mode`, else 409 `build-started` (the UI then asks). `colors` changes the slots'
 *   filaments only (`recolorOnly`; returns what it did). `full` also moves parts; it is refused (409) while a
 *   plate is printing or a printer job is live, and needs `confirm: true` otherwise.
 */
export function applyDesignToBuild(
	db: Db,
	designId: string,
	buildId: string,
	userId: string,
	opts: ApplyDesignOptions = {}
): RecolorPlan | null {
	const d = visibleDesign(db, designId, userId);
	let result: RecolorPlan | null = null;
	mutateBuild(db, buildId, userId, (tx, view) => {
		if (view.build.templateId !== d.templateId)
			bad('That design is for a different kit than this build');
		if (opts.mode !== undefined && opts.mode !== 'colors' && opts.mode !== 'full')
			bad('mode must be colors or full');
		const mode: ApplyMode = opts.mode ?? 'full';
		if (view.started.started) {
			if (opts.mode === undefined)
				throw new BuildStartedError(
					view.started,
					'This build has started printing. Choose how to apply the design.'
				);
			if (mode === 'full') {
				const block = fullReplaceBlock(view.started);
				if (block)
					throw new BuildStartedError(
						view.started,
						`${block} Replacing print files is not possible now. Apply the colors only, or wait for the print to finish.`
					);
				if (opts.confirm !== true)
					throw new BuildStartedError(
						view.started,
						'This build has started printing. Confirm to replace its colors and print files.'
					);
			}
		}
		if (mode === 'colors') {
			result = recolorOnly(tx, view, d);
			if (!result.changes.length) return { kind: 'design.recolor', skip: true };
			return {
				kind: 'design.recolor',
				payload: {
					designId: d.id,
					designName: d.name,
					changed: result.changes.map((c) => c.key),
					...(result.skipped.length ? { skipped: result.skipped } : {}),
					before: designSnapshot(view)
				}
			};
		}
		const lockedAdded = replaceColors(tx, view, d);
		return {
			kind: 'design.apply',
			payload: {
				designId: d.id,
				designName: d.name,
				mode: 'full',
				...(lockedAdded.length ? { lockedAdded } : {}),
				before: designSnapshot(view)
			}
		};
	});
	return result;
}

/** Dry run of `applyDesignToBuild`: what "Colors only" would do and whether "full" is allowed. Writes nothing. */
export function previewApplyDesign(
	db: Db,
	designId: string,
	buildId: string,
	userId: string
): ApplyPreview {
	const d = visibleDesign(db, designId, userId);
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	const view = loadBuildView(db, buildId, userId);
	if (!view) throw new ApiError(404, 'Not found');
	if (view.build.templateId !== d.templateId)
		bad('That design is for a different kit than this build');
	return {
		...planRecolor(view, d),
		started: view.started,
		summary: startedSummary(view.started),
		fullBlocked: fullReplaceBlock(view.started)
	};
}

/**
 * "Colors only": write the target filament's `name`, `material` and `hex` on the slots `planRecolor` picked.
 * Part slots, locks, plates, files, runs, spools, `spool_adds` and the Spoolman link are not touched, and
 * the kind (`design.recolor`) is outside `REARRANGE_KINDS`, so no plate is rebuilt.
 */
function recolorOnly(tx: Db, view: BuildView, d: typeof colorDesigns.$inferSelect): RecolorPlan {
	const plan = planRecolor(view, d);
	if (!plan.changes.length) return plan;
	for (const c of plan.changes)
		tx.update(buildFilaments)
			.set({ name: c.name, material: c.material, hex: c.hex })
			.where(and(eq(buildFilaments.buildId, view.build.id), eq(buildFilaments.roleKey, c.key)))
			.run();
	const byKey = new Map(plan.changes.map((c) => [c.key, c]));
	const roles = view.filaments.map((f) => {
		const c = byKey.get(f.key);
		return {
			key: f.key,
			name: c?.name ?? f.name,
			material: c?.material ?? f.material,
			hex: c?.hex ?? f.hex
		};
	});
	const row = tx
		.select({ design: builds.design })
		.from(builds)
		.where(eq(builds.id, view.build.id))
		.get();
	tx.update(builds)
		.set({
			design: { ...((row?.design ?? {}) as Obj), roles, partRoles: effectivePartRoles(view) }
		})
		.where(eq(builds.id, view.build.id))
		.run();
	return plan;
}

/**
 * "Colors and print files": slot names, materials and hexes (spools on hand stay on the slot key) and every
 * part's slot. Locked parts keep their exact color: they stay on their slot, or, when that slot's filament
 * changes, move to a slot that holds the old filament (an existing non-kit one, else a new one; returned).
 */
function replaceColors(
	tx: Db,
	view: BuildView,
	d: typeof colorDesigns.$inferSelect
): { key: string; name: string; material: string; parts: string[] }[] {
	const have = new Map(view.filaments.map((f) => [f.key, f]));
	const changed = new Set<string>();
	for (const r of d.roles) {
		const cur = have.get(r.key);
		if (cur) {
			if (!sameFilament(cur, r)) changed.add(r.key);
			tx.update(buildFilaments)
				.set({ name: r.name, material: r.material, hex: r.hex.toLowerCase() })
				.where(and(eq(buildFilaments.buildId, view.build.id), eq(buildFilaments.roleKey, r.key)))
				.run();
		} else {
			tx.insert(buildFilaments)
				.values({
					buildId: view.build.id,
					roleKey: r.key,
					name: r.name,
					material: r.material,
					hex: r.hex.toLowerCase(),
					spools: 0
				})
				.run();
		}
	}
	const keys = new Set([...have.keys(), ...d.roles.map((r) => r.key)]);
	const partRoles: Record<string, string> = {};
	for (const p of view.allParts) {
		if (p.locked) continue;
		const r = d.partRoles[p.slug];
		partRoles[p.slug] =
			r &&
			keys.has(r) &&
			materialAllowed(
				p.allowedMaterials,
				(d.roles.find((x) => x.key === r) ?? have.get(r))?.material ?? ''
			)
				? r
				: p.role;
	}
	const roles = [
		...d.roles,
		...view.filaments.filter((f) => !d.roles.some((r) => r.key === f.key))
	].map((r) => ({ key: r.key, name: r.name, material: r.material, hex: r.hex.toLowerCase() }));

	// Locked parts: keep the exact color.
	const lockedAdded: { key: string; name: string; material: string; parts: string[] }[] = [];
	const byOld = new Map<string, string[]>();
	for (const p of view.allParts)
		if (p.locked && changed.has(p.role)) byOld.set(p.role, [...(byOld.get(p.role) ?? []), p.slug]);
	for (const p of view.allParts) if (p.locked) partRoles[p.slug] = p.role;
	for (const [oldKey, slugs] of byOld) {
		const old = have.get(oldKey)!;
		let target = roles.find(
			(r) =>
				!changed.has(r.key) &&
				!view.filaments.find((f) => f.key === r.key)?.kit &&
				sameFilament(r, old)
		);
		if (!target) {
			const key = newRoleKey(
				roles.map((r) => r.key),
				old.name
			);
			tx.insert(buildFilaments)
				.values({
					buildId: view.build.id,
					roleKey: key,
					name: old.name,
					material: old.material,
					hex: old.hex,
					spools: 0
				})
				.run();
			target = { key, name: old.name, material: old.material, hex: old.hex };
			roles.push(target);
			lockedAdded.push({
				key,
				name: old.name,
				material: old.material,
				parts: slugs.map((s) => view.allParts.find((p) => p.slug === s)!.name)
			});
		}
		for (const s of slugs) partRoles[s] = target.key;
	}
	const lockedParts = view.allParts.filter((p) => p.locked).map((p) => p.slug);
	tx.update(builds)
		.set({
			design: {
				id: d.id,
				slug: d.slug,
				name: d.name,
				roles,
				partRoles,
				...(lockedParts.length ? { lockedParts } : {})
			}
		})
		.where(eq(builds.id, view.build.id))
		.run();
	return lockedAdded;
}
