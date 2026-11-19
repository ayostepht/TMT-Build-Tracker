/**
 * Writing to Spoolman from a build (issue #59, parts 2 and 3): create a vendor and filament for a
 * slot and link it, add a spool of the linked filament (kept in the colour's spool history with
 * its Spoolman id), and remove that history entry with an optional archive in Spoolman.
 * Editors only (a viewer gets 403, a non-member 404). Every write runs under the workspace's
 * Spoolman lock, goes through the guarded client, and refreshes `spoolman_cache` afterwards.
 */
import { and, eq } from 'drizzle-orm';
import { isObj } from '#lib/domain/guards.ts';
import { suggestName } from '#lib/filament-catalog.ts';
import { ApiError, buildAccess } from '../access';
import { MAX_SPOOL_ADDS, mutateBuild } from '../builds/actions';
import type { Db } from '../db';
import { buildFilaments } from '../db/schema';
import { resolveSlotOrigin } from '../filaments/index';
import { spoolmanDefaults } from '../filaments/spoolman-defaults';
import { getOrgSettings } from '../org-settings';
import { openSpools, refreshFilament } from './cache';
import {
	SpoolmanClient,
	SpoolmanError,
	type SpoolmanFilament,
	type SpoolmanVendor
} from './client';
import { setFilamentLink, type ClientFactory, type LinkResult } from './link';
import { isSpoolmanLocked, withSpoolmanLock } from './lock';

const defaultFactory: ClientFactory = (url) => new SpoolmanClient(url);
const BUSY = 'Spoolman is busy with another update; try again in a moment';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]+/g;

function spoolmanError(e: unknown): ApiError {
	if (e instanceof ApiError) return e;
	return new ApiError(
		e instanceof SpoolmanError ? e.status : 502,
		e instanceof Error ? e.message : 'Spoolman failed'
	);
}

/** Editors only, real builds only (drafts have no tracking), Spoolman set up. */
function writeCtx(db: Db, buildId: string, userId: string) {
	const access = buildAccess(db, buildId, userId);
	if (!access) throw new ApiError(404, 'Not found');
	if (!access.canEdit) throw new ApiError(403, 'Your role cannot edit');
	if (access.kind === 'draft')
		throw new ApiError(400, 'Drafts have no build tracking. Make it a build first.');
	const cfg = getOrgSettings(db, access.organizationId);
	if (!cfg.spoolmanUrl) throw new ApiError(400, 'Spoolman is not set up for this chapter');
	return { org: access.organizationId, url: cfg.spoolmanUrl };
}

function clientFor(url: string, factory: ClientFactory): SpoolmanClient {
	try {
		return factory(url);
	} catch (e) {
		throw spoolmanError(e);
	}
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

function cleanText(v: unknown, field: string, max: number, required = true): string {
	if (v === undefined || v === null || v === '') {
		if (required) throw new ApiError(400, `${field} is required`);
		return '';
	}
	if (typeof v !== 'string') throw new ApiError(400, `${field} must be text`);
	const t = v.replace(CONTROL, ' ').trim();
	if (!t && required) throw new ApiError(400, `${field} is required`);
	if (t.length > max) throw new ApiError(400, `${field} must be at most ${max} characters`);
	return t;
}

function num(v: unknown, field: string, min: number, max: number): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
		throw new ApiError(400, `${field} must be a number from ${min} to ${max}`);
	return v;
}

// ---- Defaults for the "Create in Spoolman" form ------------------------------------------------

export interface CreateDefaults {
	vendorName: string;
	name: string;
	material: string;
	colorHex: string;
	density: number;
	diameter: number;
	weightG: number;
	spoolWeightG: number;
	/** SpoolmanDB id when the catalog knows the filament; sent as `external_id`. */
	externalId: string | null;
	source: 'catalog' | 'material' | 'generic';
}

export interface CreateForm {
	defaults: CreateDefaults;
	/** Vendors already in Spoolman (empty when it could not be asked, see `error`). */
	vendors: SpoolmanVendor[];
	error?: string;
}

/** Prefill for the create form: catalog match (`resolveSlotOrigin`) + `spoolmanDefaults`, plus Spoolman's vendors. */
export async function createFormFor(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	factory: ClientFactory = defaultFactory
): Promise<CreateForm> {
	const { url } = writeCtx(db, buildId, userId);
	const slot = slotOf(db, buildId, role);
	const origin = resolveSlotOrigin({ name: slot.name, material: slot.material, hex: slot.hex });
	const material = slot.material || origin?.material || 'PETG';
	const d = spoolmanDefaults(material, origin);
	const hex = slot.hex ?? origin?.color.hex ?? '#808080';
	const defaults: CreateDefaults = {
		vendorName: origin?.brand ?? '',
		name: origin ? suggestName(origin.brand, origin.color.name) : slot.name,
		material,
		colorHex: /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#808080',
		density: d.density,
		diameter: d.diameter,
		weightG: d.weight,
		spoolWeightG: d.spoolWeight,
		externalId: origin?.sdbId ?? null,
		source: d.source
	};
	try {
		return { defaults, vendors: await clientFor(url, factory).listVendors() };
	} catch (e) {
		return { defaults, vendors: [], error: spoolmanError(e).message };
	}
}

// ---- Create vendor + filament, then link -------------------------------------------------------

export interface CreateResult extends LinkResult {
	vendorId: number;
	vendorCreated: boolean;
	/** The same filament already existed in Spoolman (a double click, a second editor): it was linked, not created again. */
	reused: boolean;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Create the vendor (when no vendor of that name exists) and the filament in Spoolman, then link
 * the slot to it exactly like a normal link. Body: `{ vendorName, name, material, colorHex,
 * density, weightG, spoolWeightG?, diameter?, externalId? }`. A filament that already exists with
 * the same vendor, name, material and colour is reused, never duplicated.
 */
export async function createAndLinkFilament(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	body: unknown,
	factory: ClientFactory = defaultFactory
): Promise<CreateResult> {
	const { org, url } = writeCtx(db, buildId, userId);
	slotOf(db, buildId, role);
	if (!isObj(body)) throw new ApiError(400, 'Invalid body');
	const vendorName = cleanText(body.vendorName, 'vendorName', 200);
	const name = cleanText(body.name, 'name', 200);
	const material = cleanText(body.material, 'material', 60);
	const hex = typeof body.colorHex === 'string' ? body.colorHex.trim().replace(/^#/, '') : '';
	if (!/^[0-9a-f]{6}$/i.test(hex)) throw new ApiError(400, 'colorHex must be a color like #2b3f9e');
	const density = num(body.density, 'density', 0.1, 10);
	const weightG = num(body.weightG, 'weightG', 1, 20000);
	const diameter = body.diameter === undefined ? 1.75 : num(body.diameter, 'diameter', 0.5, 5);
	const spoolWeightG =
		body.spoolWeightG === undefined || body.spoolWeightG === null
			? null
			: num(body.spoolWeightG, 'spoolWeightG', 0, 5000);
	const externalId = cleanText(body.externalId, 'externalId', 120, false) || null;
	const client = clientFor(url, factory);
	if (isSpoolmanLocked(org)) throw new ApiError(409, BUSY);

	const made = await withSpoolmanLock(org, async () => {
		let vendor: SpoolmanVendor | undefined;
		let vendorCreated = false;
		let filament: SpoolmanFilament | undefined;
		let reused = false;
		try {
			vendor = (await client.listVendors()).find((v) => sameName(v.name, vendorName));
			if (!vendor) {
				vendor = await client.createVendor(vendorName);
				vendorCreated = true;
				const v = vendor;
				mutateBuild(db, buildId, userId, () => ({
					kind: 'filament.spoolman.create',
					payload: { what: 'vendor', name: v.name, id: v.id, role }
				}));
			} else {
				filament = (await client.listFilaments()).find(
					(f) =>
						f.vendor != null &&
						sameName(f.vendor, vendor!.name) &&
						sameName(f.name, name) &&
						sameName(f.material ?? '', material) &&
						f.colorHex === `#${hex.toLowerCase()}`
				);
				reused = !!filament;
			}
			filament ??= await client.createFilament({
				name,
				vendorId: vendor.id,
				material,
				colorHex: `#${hex.toLowerCase()}`,
				density,
				diameter,
				weightG,
				spoolWeightG,
				externalId
			});
		} catch (e) {
			throw spoolmanError(e);
		}
		if (!reused) {
			const f = filament;
			mutateBuild(db, buildId, userId, () => ({
				kind: 'filament.spoolman.create',
				payload: { what: 'filament', name: f.name, id: f.id, role }
			}));
		}
		return { vendor, vendorCreated, filament, reused };
	});

	const link = await setFilamentLink(
		db,
		buildId,
		userId,
		role,
		{ filamentId: made.filament.id },
		factory
	);
	return {
		...link,
		vendorId: made.vendor.id,
		vendorCreated: made.vendorCreated,
		reused: made.reused
	};
}

// ---- Add / remove a spool in Spoolman ----------------------------------------------------------

export interface AddSpoolResult {
	/** The history entry's id (the app's own id). */
	id: string;
	spoolmanSpoolId: number;
	/** The new spool became the one deductions start on. */
	current: boolean;
}

/**
 * Add a spool of the linked filament to Spoolman: `{ kg, note? }`. The weight is the net filament
 * weight (`initial_weight`, kg x 1000), the note goes to the spool's `comment`, the empty-spool
 * weight is the filament's own, else the catalog/default. The spool is recorded in the colour's
 * spool history (with its Spoolman id) and becomes the current spool when there is none open.
 * Stock still comes from Spoolman.
 */
export async function addSpoolmanSpool(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	body: unknown,
	factory: ClientFactory = defaultFactory
): Promise<AddSpoolResult> {
	const { org, url } = writeCtx(db, buildId, userId);
	const slot = slotOf(db, buildId, role);
	if (slot.spoolmanFilamentId == null)
		throw new ApiError(400, 'Link this filament to Spoolman first');
	if (!isObj(body)) throw new ApiError(400, 'Invalid body');
	const kg = Math.round(num(body.kg, 'kg', 0.01, 99) * 100) / 100;
	const note = cleanText(body.note, 'note', 200, false) || null;
	if (slot.spoolAdds.length >= MAX_SPOOL_ADDS)
		throw new ApiError(400, `A color can hold at most ${MAX_SPOOL_ADDS} added spools`);
	const filamentId = slot.spoolmanFilamentId;
	const client = clientFor(url, factory);
	if (isSpoolmanLocked(org)) throw new ApiError(409, BUSY);

	return withSpoolmanLock(org, async () => {
		let created;
		try {
			const f = await client.getFilament(filamentId);
			const origin = resolveSlotOrigin({ name: slot.name, material: slot.material, hex: slot.hex });
			created = await client.createSpool({
				filamentId,
				initialG: Math.round(kg * 1000),
				spoolWeightG:
					f.spoolWeightG ?? spoolmanDefaults(f.material ?? slot.material ?? '', origin).spoolWeight,
				comment: note
			});
		} catch (e) {
			if (e instanceof SpoolmanError && e.remoteStatus === 404)
				throw new ApiError(404, 'That filament is not in Spoolman (it may have been deleted)');
			throw spoolmanError(e);
		}
		const spoolId = created.stock.id;
		if (created.filamentId != null && created.filamentId !== filamentId)
			throw new ApiError(502, 'Spoolman sent something unexpected.');
		const fresh = (await refreshFilament(db, org, client, filamentId)).filament;
		const openIds = fresh ? openSpools(fresh).map((s) => s.id) : [];
		const cur = slot.spoolmanSpoolId;
		const becomeCurrent = openIds.includes(spoolId) && (cur == null || !openIds.includes(cur));
		const id = crypto.randomUUID();
		try {
			mutateBuild(db, buildId, userId, (tx, _view, now) => {
				const row = tx
					.select({ adds: buildFilaments.spoolAdds })
					.from(buildFilaments)
					.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
					.get();
				const adds = row?.adds ?? [];
				if (adds.length >= MAX_SPOOL_ADDS)
					throw new ApiError(400, `A color can hold at most ${MAX_SPOOL_ADDS} added spools`);
				tx.update(buildFilaments)
					.set({
						spoolAdds: [
							...adds,
							{
								id,
								kg,
								at: now.getTime(),
								userId,
								...(note ? { note } : {}),
								spoolmanSpoolId: spoolId
							}
						]
					})
					.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
					.run();
				return {
					kind: 'filament.stock.add',
					payload: { role, addId: id, kg, ...(note ? { note } : {}), spoolmanSpoolId: spoolId }
				};
			});
		} catch (e) {
			// The spool exists in Spoolman but the app could not record it: do not leave it behind unseen.
			await client.setArchived(spoolId, true).catch(() => {});
			await refreshFilament(db, org, client, filamentId);
			throw e;
		}
		if (becomeCurrent) {
			mutateBuild(db, buildId, userId, (tx) => {
				tx.update(buildFilaments)
					.set({ spoolmanSpoolId: spoolId })
					.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
					.run();
				return {
					kind: 'filament.spoolman.spool',
					payload: { role, spoolId, ...(cur != null ? { fromSpoolId: cur } : {}) }
				};
			});
		}
		return { id, spoolmanSpoolId: spoolId, current: becomeCurrent };
	});
}

export interface RemoveSpoolResult {
	/** True when the spool was archived in Spoolman; absent when the entry had no Spoolman spool or it was left alone. */
	archived?: boolean;
	warning?: string;
}

/**
 * Remove one entry from the colour's spool history. With `archive` and an entry that has a
 * Spoolman spool, the spool is archived in Spoolman first (its weight and history stay there); when
 * Spoolman cannot be reached nothing changes, so the maker can retry or keep the spool. A spool
 * Spoolman no longer has counts as gone. If the archived spool was the current one, the next open
 * spool takes over (or none).
 */
export async function removeSpoolmanSpoolAdd(
	db: Db,
	buildId: string,
	userId: string,
	role: string,
	addId: string,
	archive: boolean,
	factory: ClientFactory = defaultFactory
): Promise<RemoveSpoolResult> {
	const { org, url } = writeCtx(db, buildId, userId);
	const slot = slotOf(db, buildId, role);
	const entry = slot.spoolAdds.find((a) => a.id === addId);
	if (!entry) throw new ApiError(404, 'Unknown spool add');
	const spoolId = entry.spoolmanSpoolId;
	const wantArchive = archive && spoolId != null;
	const client = clientFor(url, factory);
	if (wantArchive && isSpoolmanLocked(org)) throw new ApiError(409, BUSY);

	return withSpoolmanLock(org, async () => {
		let archived: boolean | undefined = spoolId != null ? false : undefined;
		let warning: string | undefined;
		if (wantArchive) {
			try {
				await client.setArchived(spoolId!, true);
				archived = true;
			} catch (e) {
				if (e instanceof SpoolmanError && e.remoteStatus === 404) {
					archived = undefined;
					warning = 'That spool is no longer in Spoolman.';
				} else throw spoolmanError(e);
			}
		}
		const fid = slot.spoolmanFilamentId;
		const fresh =
			fid != null && wantArchive ? (await refreshFilament(db, org, client, fid)).filament : null;
		mutateBuild(db, buildId, userId, (tx, view) => {
			const cur = view.filaments.find((f) => f.key === role)?.spoolmanSpoolId ?? null;
			const row = tx
				.select({ adds: buildFilaments.spoolAdds })
				.from(buildFilaments)
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
				.get();
			const adds = row?.adds ?? [];
			const gone = adds.find((a) => a.id === addId);
			if (!gone) throw new ApiError(404, 'Unknown spool add');
			const set: { spoolAdds: typeof adds; spoolmanSpoolId?: number | null } = {
				spoolAdds: adds.filter((a) => a.id !== addId)
			};
			if (spoolId != null && cur === spoolId && (archived === true || archived === undefined))
				set.spoolmanSpoolId = fresh ? (openSpools(fresh)[0]?.id ?? null) : null;
			tx.update(buildFilaments)
				.set(set)
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
				.run();
			return {
				kind: 'filament.stock.remove',
				payload: {
					role,
					addId,
					kg: gone.kg,
					at: gone.at,
					...(spoolId != null ? { spoolmanSpoolId: spoolId } : {}),
					...(archived !== undefined ? { archived } : {})
				}
			};
		});
		return { ...(archived !== undefined ? { archived } : {}), ...(warning ? { warning } : {}) };
	});
}
