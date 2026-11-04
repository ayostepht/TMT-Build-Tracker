import { and, asc, eq } from 'drizzle-orm';
import {
	CUSTOM_LIMITS,
	FINISHES,
	customKey,
	type CustomFilament,
	type CustomFilamentInput
} from '#lib/domain/custom-filaments.ts';
import { isHex, normHex } from '#lib/domain/color.ts';
import { ApiError, requireEditor, requireMember } from '../access';
import type { Db } from '../db';
import { customFilaments } from '../db/schema';

/** 409 carrying the id of the filament that already has the same brand, material and color name. */
export class DuplicateFilamentError extends ApiError {
	constructor(public existingId: string) {
		super(409, 'You already have a filament with this brand, type and color name');
	}
}

type Row = typeof customFilaments.$inferSelect;

const toView = (r: Row): CustomFilament => ({
	id: r.id,
	organizationId: r.organizationId,
	brand: r.brand,
	material: r.material,
	colorName: r.colorName,
	hex: r.hex,
	finish: r.finish,
	hardness: r.hardness,
	url: r.url,
	notes: r.notes,
	createdAt: r.createdAt.getTime(),
	updatedAt: r.updatedAt ? r.updatedAt.getTime() : null
});

const text = (v: unknown, field: string, max: number, required: boolean): string => {
	if (v === undefined || v === null || v === '') {
		if (required) throw new ApiError(400, `${field} is required`);
		return '';
	}
	if (typeof v !== 'string') throw new ApiError(400, `${field} must be text`);
	const s = v.trim().replace(/\s+/g, ' ');
	if (!s && required) throw new ApiError(400, `${field} is required`);
	if (s.length > max) throw new ApiError(400, `${field} is too long (max ${max})`);
	return s;
};

/** Validate a request body into a normalized input. With `partial`, absent fields stay undefined. */
export function parseCustomInput(body: unknown): CustomFilamentInput {
	if (!body || typeof body !== 'object') throw new ApiError(400, 'Invalid body');
	const b = body as Record<string, unknown>;
	const hex = typeof b.hex === 'string' ? normHex(b.hex.trim()) : '';
	if (!/^#[0-9a-f]{6}$/i.test(hex) || !isHex(hex))
		throw new ApiError(400, 'Color must be a #rrggbb hex');
	const finish = text(b.finish, 'Finish', CUSTOM_LIMITS.finish, false).toLowerCase();
	if (finish && !(FINISHES as readonly string[]).includes(finish))
		throw new ApiError(400, `Finish must be one of ${FINISHES.join(', ')}`);
	const url = text(b.url, 'Link', CUSTOM_LIMITS.url, false);
	if (url && !/^https?:\/\/[^\s]+$/i.test(url))
		throw new ApiError(400, 'Link must start with http:// or https://');
	return {
		brand: text(b.brand, 'Brand', CUSTOM_LIMITS.brand, true),
		material: text(b.material, 'Type', CUSTOM_LIMITS.material, true),
		colorName: text(b.colorName, 'Color name', CUSTOM_LIMITS.colorName, true),
		hex: hex.toLowerCase(),
		finish: finish || null,
		hardness: text(b.hardness, 'Hardness', CUSTOM_LIMITS.hardness, false) || null,
		url: url || null,
		notes: text(b.notes, 'Notes', CUSTOM_LIMITS.notes, false)
	};
}

function findDuplicate(db: Db, orgId: string, input: CustomFilamentInput, exceptId?: string) {
	const key = customKey(input);
	return db
		.select()
		.from(customFilaments)
		.where(eq(customFilaments.organizationId, orgId))
		.all()
		.find((r) => r.id !== exceptId && customKey({ ...r }) === key);
}

/** Any member may read the workspace's filaments (non-members get 404). */
export function listCustomFilaments(db: Db, orgId: string, userId: string): CustomFilament[] {
	requireMember(db, orgId, userId);
	return db
		.select()
		.from(customFilaments)
		.where(eq(customFilaments.organizationId, orgId))
		.orderBy(asc(customFilaments.brand), asc(customFilaments.colorName))
		.all()
		.map(toView);
}

export function createCustomFilament(
	db: Db,
	orgId: string,
	userId: string,
	body: unknown
): CustomFilament {
	requireEditor(db, orgId, userId);
	const input = parseCustomInput(body);
	const dup = findDuplicate(db, orgId, input);
	if (dup) throw new DuplicateFilamentError(dup.id);
	const row = db
		.insert(customFilaments)
		.values({ organizationId: orgId, ...input, notes: input.notes ?? '', createdBy: userId })
		.returning()
		.get();
	return toView(row);
}

function load(db: Db, id: string, userId: string, edit: boolean): Row {
	const row = db.select().from(customFilaments).where(eq(customFilaments.id, id)).get();
	if (!row) throw new ApiError(404, 'Not found');
	if (edit) requireEditor(db, row.organizationId, userId);
	else requireMember(db, row.organizationId, userId);
	return row;
}

export function updateCustomFilament(
	db: Db,
	id: string,
	userId: string,
	body: unknown
): CustomFilament {
	const row = load(db, id, userId, true);
	const input = parseCustomInput(body);
	const dup = findDuplicate(db, row.organizationId, input, id);
	if (dup) throw new DuplicateFilamentError(dup.id);
	const out = db
		.update(customFilaments)
		.set({ ...input, notes: input.notes ?? '', updatedAt: new Date() })
		.where(and(eq(customFilaments.id, id)))
		.returning()
		.get();
	return toView(out);
}

/** Builds that already use the filament keep their own copy of name, color and material. */
export function deleteCustomFilament(db: Db, id: string, userId: string): void {
	load(db, id, userId, true);
	db.delete(customFilaments).where(eq(customFilaments.id, id)).run();
}
