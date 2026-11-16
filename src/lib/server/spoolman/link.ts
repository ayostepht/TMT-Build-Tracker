/**
 * Build-facing Spoolman operations (issue #59): link a filament slot to a Spoolman filament,
 * choose its current spool, the one-off "subtract what was logged before linking" deduction and
 * its undo, ranked suggestions, and the housekeeping that keeps `spoolman_cache` fresh. Routes
 * are thin wrappers over these so the permission rules sit in one place: viewers read, editors
 * change, non-members get a 404.
 */
import { and, eq } from 'drizzle-orm';
import { isObj } from '#lib/domain/guards.ts';
import { ApiError, buildAccess } from '../access';
import { mutateBuild } from '../builds/actions';
import { loadBuildView } from '../builds/view';
import type { Db } from '../db';
import { buildFilaments } from '../db/schema';
import { resolveSlotOrigin } from '../filaments/index';
import {
	getDeductions,
	getOrgSettings,
	prelinkLedgerKey,
	setDeduction,
	type DeductionEntry
} from '../org-settings';
import {
	openSpools,
	readAllCached,
	readCached,
	refreshFilament,
	refreshFilaments,
	writeCache
} from './cache';
import { SpoolmanClient, SpoolmanError, type FilamentWithSpools } from './client';
import { EPS, giveBack, recordAdvances, round1, takeGrams } from './engine';
import { withSpoolmanLock } from './lock';
import { rankFilaments, type Suggestion } from './suggest';

export type ClientFactory = (url: string) => SpoolmanClient;
const defaultFactory: ClientFactory = (url) => new SpoolmanClient(url);

function spoolmanError(e: unknown): ApiError {
	if (e instanceof ApiError) return e;
	return new ApiError(
		e instanceof SpoolmanError ? e.status : 502,
		e instanceof Error ? e.message : 'Spoolman failed'
	);
}

function ctxFor(db: Db, buildId: string, userId: string, edit: boolean) {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (edit && !access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	const cfg = getOrgSettings(db, access.organizationId);
	return { access, org: access.organizationId, cfg };
}

function clientFor(url: string | null, factory: ClientFactory): SpoolmanClient {
	if (!url) throw new ApiError(400, 'Spoolman is not set up for this chapter');
	try {
		return factory(url);
	} catch (e) {
		throw spoolmanError(e);
	}
}

function wholeId(v: unknown, field: string): number {
	if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
		throw new ApiError(400, `${field} must be a whole number`);
	return v;
}

function slotOf(db: Db, buildId: string, role: string) {
	const row = db
		.select()
		.from(buildFilaments)
		.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
		.get();
	if (!row) throw new ApiError(404, 'Unknown filament');
	return row;
}

// ---- Suggestions -------------------------------------------------------------------------------

export interface SuggestionsResult {
	configured: boolean;
	/** Spoolman could not be reached: the list is what the app last saw (linked filaments only). */
	offline: boolean;
	error?: string;
	suggestions: Suggestion[];
}

/** Every Spoolman filament ranked for a slot (members may read). */
export async function suggestFilaments(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	factory: ClientFactory = defaultFactory
): Promise<SuggestionsResult> {
	const { org, cfg } = ctxFor(db, buildId, userId, false);
	const slot = slotOf(db, buildId, role);
	if (!cfg.spoolmanUrl) return { configured: false, offline: false, suggestions: [] };
	const q = { name: slot.name, material: slot.material, hex: slot.hex };
	const origin = resolveSlotOrigin(q);
	try {
		const all = await clientFor(cfg.spoolmanUrl, factory).listFilamentsWithSpools();
		return { configured: true, offline: false, suggestions: rankFilaments(all, q, origin) };
	} catch (e) {
		const err = spoolmanError(e);
		return {
			configured: true,
			offline: true,
			error: err.message,
			suggestions: rankFilaments(readAllCached(db, org), q, origin)
		};
	}
}

// ---- Link / unlink -----------------------------------------------------------------------------

export interface LinkResult {
	linked: boolean;
	filamentId: number | null;
	filamentName: string | null;
	spoolId: number | null;
	/** Grams logged on this build for the slot before the link that Spoolman has not been told about. */
	preLinkLoggedG: number;
}

/**
 * Link a slot to a Spoolman filament (`{ filamentId }`) or unlink it (`{ filamentId: null }`).
 * Linking stamps `spoolman_linked_at` (runs before it are never deducted), keeps the current spool
 * when it belongs to the filament, else picks the filament's first open spool, and stores the
 * filament in the cache. Relinking the same filament keeps the stamp. A legacy spool-only link whose
 * spool belongs to this filament keeps "link time unknown" so nothing already deducted is skipped.
 */
export async function setFilamentLink(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	body: unknown,
	factory: ClientFactory = defaultFactory
): Promise<LinkResult> {
	const { org, cfg } = ctxFor(db, buildId, userId, true);
	if (!isObj(body) || !('filamentId' in body))
		throw new ApiError(400, 'filamentId is required (a number, or null to unlink)');
	const slot = slotOf(db, buildId, role);

	if (body.filamentId === null) {
		const name =
			slot.spoolmanFilamentId != null ? readCached(db, org, slot.spoolmanFilamentId)?.name : null;
		mutateBuild(db, buildId, userId, (tx) => {
			if (slot.spoolmanFilamentId == null && slot.spoolmanSpoolId == null)
				return { kind: 'noop', skip: true };
			tx.update(buildFilaments)
				.set({ spoolmanFilamentId: null, spoolmanSpoolId: null, spoolmanLinkedAt: null })
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
				.run();
			return {
				kind: 'filament.spoolman.unlink',
				payload: { role, ...(name ? { filamentName: name } : {}) }
			};
		});
		return {
			linked: false,
			filamentId: null,
			filamentName: null,
			spoolId: null,
			preLinkLoggedG: 0
		};
	}

	const id = wholeId(body.filamentId, 'filamentId');
	const client = clientFor(cfg.spoolmanUrl, factory);
	let f: FilamentWithSpools;
	try {
		f = await client.getFilamentWithSpools(id);
	} catch (e) {
		if (e instanceof SpoolmanError && e.remoteStatus === 404)
			throw new ApiError(404, 'That filament is not in Spoolman (it may have been deleted)');
		throw spoolmanError(e);
	}
	writeCache(db, org, f);
	const open = openSpools(f);
	const keep = slot.spoolmanSpoolId != null && f.spools.some((s) => s.id === slot.spoolmanSpoolId);
	const spoolId = keep ? slot.spoolmanSpoolId : (open[0]?.id ?? null);
	const same = slot.spoolmanFilamentId === id;
	const legacyKeep =
		!same && slot.spoolmanFilamentId == null && keep && slot.spoolmanLinkedAt == null;

	mutateBuild(db, buildId, userId, (tx, _view, now) => {
		tx.update(buildFilaments)
			.set({
				spoolmanFilamentId: id,
				spoolmanSpoolId: spoolId,
				spoolmanLinkedAt: same ? (slot.spoolmanLinkedAt ?? now) : legacyKeep ? null : now
			})
			.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
			.run();
		return {
			kind: 'filament.spoolman.link',
			payload: {
				role,
				filamentId: id,
				filamentName: f.name,
				...(slot.spoolmanFilamentId != null && !same ? { relinked: true } : {})
			}
		};
	});
	const sp = loadBuildView(db, buildId, userId)?.filaments.find((x) => x.key === role)?.spoolman;
	return {
		linked: true,
		filamentId: id,
		filamentName: f.name,
		spoolId,
		preLinkLoggedG: sp?.preLinkLoggedG ?? 0
	};
}

/** Set (or with null clear) the spool of a linked slot that the next deduction starts on. */
export async function setCurrentSpool(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	body: unknown,
	factory: ClientFactory = defaultFactory
): Promise<{ spoolId: number | null }> {
	const { org, cfg } = ctxFor(db, buildId, userId, true);
	if (!isObj(body) || !('spoolId' in body))
		throw new ApiError(400, 'spoolId is required (a number, or null)');
	const slot = slotOf(db, buildId, role);
	if (slot.spoolmanFilamentId == null)
		throw new ApiError(400, 'Link this filament to Spoolman first');
	const spoolId = body.spoolId === null ? null : wholeId(body.spoolId, 'spoolId');
	if (spoolId !== null) {
		let f: FilamentWithSpools | null;
		try {
			f =
				(
					await refreshFilament(
						db,
						org,
						clientFor(cfg.spoolmanUrl, factory),
						slot.spoolmanFilamentId
					)
				).filament ?? null;
		} catch (e) {
			throw spoolmanError(e);
		}
		f ??= readCached(db, org, slot.spoolmanFilamentId);
		if (!f) throw new ApiError(502, 'Spoolman could not be reached');
		if (!f.spools.some((s) => s.id === spoolId))
			throw new ApiError(400, 'That spool belongs to a different Spoolman filament');
	}
	mutateBuild(db, buildId, userId, (tx) => {
		if (slot.spoolmanSpoolId === spoolId) return { kind: 'noop', skip: true };
		tx.update(buildFilaments)
			.set({ spoolmanSpoolId: spoolId })
			.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
			.run();
		return {
			kind: 'filament.spoolman.spool',
			payload: {
				role,
				spoolId,
				...(slot.spoolmanSpoolId != null ? { fromSpoolId: slot.spoolmanSpoolId } : {})
			}
		};
	});
	return { spoolId };
}

// ---- Pre-link deduction ------------------------------------------------------------------------

/**
 * Subtract the grams logged on this build for the slot before it was linked, once: the ledger key
 * `prelink:<build>:<role>` holds it, so it is read, undone and given back like any run.
 * Only when the app keeps Spoolman up to date (otherwise the app never writes weights).
 */
export async function applyPrelinkDeduction(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	factory: ClientFactory = defaultFactory
): Promise<{ grams: number; warning?: string }> {
	const { org, cfg } = ctxFor(db, buildId, userId, true);
	const view = loadBuildView(db, buildId, userId);
	const sp = view?.filaments.find((f) => f.key === role)?.spoolman;
	if (!sp || sp.filamentId == null || sp.linkedAt == null)
		throw new ApiError(400, 'Link this filament to Spoolman first');
	if (cfg.spoolmanKeptBy !== 'app')
		throw new ApiError(
			400,
			'Spoolman is kept up to date by something else; the app does not change its weights'
		);
	const grams = sp.preLinkLoggedG;
	if (grams <= EPS) throw new ApiError(400, 'Nothing was logged before linking');
	const client = clientFor(cfg.spoolmanUrl, factory);
	const key = prelinkLedgerKey(buildId, role);
	return withSpoolmanLock(org, async () => {
		if ((getDeductions(db, org)[key] ?? []).length) throw new ApiError(409, 'Already subtracted');
		const slot = slotOf(db, buildId, role);
		const t = await takeGrams(
			client,
			{ filamentId: slot.spoolmanFilamentId, spoolId: slot.spoolmanSpoolId },
			role,
			grams
		);
		const taken = round1(t.entries.reduce((a, e) => a + e[1], 0));
		if (t.entries.length) setDeduction(db, org, key, t.entries);
		if (t.advances.length)
			recordAdvances(
				db,
				buildId,
				org,
				role,
				t.advances,
				() => readCached(db, org, slot.spoolmanFilamentId!)?.name ?? null
			);
		if (taken > EPS)
			mutateBuild(db, buildId, userId, () => ({
				kind: 'filament.spoolman.prelink',
				payload: { role, grams: taken }
			}));
		if (slot.spoolmanFilamentId != null)
			await refreshFilaments(db, org, client, [slot.spoolmanFilamentId]);
		if (taken <= EPS) throw new ApiError(502, t.warning ?? 'Spoolman did not take the grams');
		return { grams: taken, warning: t.warning };
	});
}

/** Give the one-off pre-link grams back (newest spool first). */
export async function undoPrelinkDeduction(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	factory: ClientFactory = defaultFactory
): Promise<{ grams: number; warning?: string }> {
	const { org, cfg } = ctxFor(db, buildId, userId, true);
	const key = prelinkLedgerKey(buildId, role);
	const client = clientFor(cfg.spoolmanUrl, factory);
	return withSpoolmanLock(org, async () => {
		const entries: DeductionEntry[] = getDeductions(db, org)[key] ?? [];
		if (!entries.length) throw new ApiError(404, 'Nothing to give back');
		const total = round1(entries.reduce((a, e) => a + e[1], 0));
		const back = await giveBack(client, entries, () => role, role, total);
		setDeduction(db, org, key, back.entries);
		if (back.given > EPS)
			mutateBuild(db, buildId, userId, () => ({
				kind: 'filament.spoolman.prelink',
				payload: { role, grams: back.given, undone: true }
			}));
		const slot = slotOf(db, buildId, role);
		if (slot.spoolmanFilamentId != null)
			await refreshFilaments(db, org, client, [slot.spoolmanFilamentId]);
		if (back.given <= EPS)
			throw new ApiError(502, back.warning ?? 'Spoolman did not take the grams back');
		return { grams: back.given, warning: back.warning };
	});
}

// ---- Stock and housekeeping --------------------------------------------------------------------

/**
 * Legacy spool-only links (`spoolman_spool_id` set, no filament): read the spool's filament from
 * Spoolman and store it. `spoolman_linked_at` stays null, so no run is skipped. No activity row:
 * it changes nothing the maker chose. Returns an error text when Spoolman could not be asked.
 */
export async function backfillFilamentIds(
	db: Db,
	buildId: string,
	client: SpoolmanClient
): Promise<string | undefined> {
	const rows = db.select().from(buildFilaments).where(eq(buildFilaments.buildId, buildId)).all();
	for (const r of rows) {
		if (r.spoolmanSpoolId == null || r.spoolmanFilamentId != null) continue;
		try {
			const fid = (await client.getSpool(r.spoolmanSpoolId)).filamentId;
			if (fid != null)
				db.update(buildFilaments)
					.set({ spoolmanFilamentId: fid })
					.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, r.roleKey)))
					.run();
		} catch (e) {
			return spoolmanError(e).message;
		}
	}
	return undefined;
}

/**
 * Refresh what the app shows for a build's linked slots: back-fill the filament of legacy
 * spool-only links (the spool's filament is read from Spoolman; `spoolman_linked_at` stays null,
 * so nothing is skipped), then re-fetch each linked filament into `spoolman_cache`. Members may
 * call it (it only reads Spoolman and updates the app's own cache). Unreachable Spoolman is
 * reported as `error`; the last good numbers stay as stale.
 */
export async function refreshBuildSpoolman(
	db: Db,
	buildId: string,
	userId: string,
	factory: ClientFactory = defaultFactory
): Promise<{ configured: boolean; error?: string }> {
	const { org, cfg } = ctxFor(db, buildId, userId, false);
	if (!cfg.spoolmanUrl) return { configured: false };
	const client = clientFor(cfg.spoolmanUrl, factory);
	let error = await backfillFilamentIds(db, buildId, client);
	const ids = db
		.select({ id: buildFilaments.spoolmanFilamentId })
		.from(buildFilaments)
		.where(eq(buildFilaments.buildId, buildId))
		.all()
		.map((r) => r.id)
		.filter((x): x is number => x != null);
	if (!error) error = await refreshFilaments(db, org, client, ids);
	return { configured: true, error };
}
