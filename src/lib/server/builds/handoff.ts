import { eq } from 'drizzle-orm';
import { ApiError } from '../access';
import type { Db } from '../db';
import { buildHandoff, builds } from '../db/schema';
import { mutateBuild } from './actions';

type Obj = Record<string, unknown>;

function text(v: unknown, field: string, max: number): string | null | undefined {
	if (v === undefined) return undefined;
	if (v === null) return null;
	if (typeof v !== 'string' || v.length > max) throw new ApiError(400, `${field} must be text`);
	return v.trim() || null;
}

function parse(body: unknown) {
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		throw new ApiError(400, 'Invalid body');
	const b = body as Obj;
	const set: Partial<typeof buildHandoff.$inferInsert> = {};
	const recipientName = text(b.recipientName, 'recipientName', 200);
	if (recipientName !== undefined) set.recipientName = recipientName;
	const organization = text(b.organization, 'organization', 200);
	if (organization !== undefined) set.organization = organization;
	const contact = text(b.contact, 'contact', 300);
	if (contact !== undefined) set.contact = contact;
	const location = text(b.location, 'location', 300);
	if (location !== undefined) set.location = location;
	const notes = text(b.notes, 'notes', 4000);
	if (notes !== undefined) set.notes = notes ?? '';
	if (b.handedOffOn !== undefined) {
		if (
			b.handedOffOn !== null &&
			(typeof b.handedOffOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.handedOffOn))
		)
			throw new ApiError(400, 'handedOffOn must be YYYY-MM-DD');
		set.handedOffOn = b.handedOffOn as string | null;
	}
	if (b.safetyChecked !== undefined) {
		if (typeof b.safetyChecked !== 'boolean')
			throw new ApiError(400, 'safetyChecked must be true or false');
		set.safetyChecked = b.safetyChecked;
	}
	return set;
}

function upsert(
	tx: Db,
	buildId: string,
	userId: string,
	now: Date,
	set: Partial<typeof buildHandoff.$inferInsert>
) {
	const values = { ...set, updatedBy: userId, updatedAt: now };
	const cur = tx
		.select({ id: buildHandoff.buildId })
		.from(buildHandoff)
		.where(eq(buildHandoff.buildId, buildId))
		.get();
	if (cur) tx.update(buildHandoff).set(values).where(eq(buildHandoff.buildId, buildId)).run();
	else
		tx.insert(buildHandoff)
			.values({ buildId, ...values })
			.run();
}

/** Save the handoff form (any subset of fields). Editors and owners only. */
export function updateHandoff(db: Db, buildId: string, userId: string, body: unknown): void {
	const set = parse(body);
	if (!Object.keys(set).length) throw new ApiError(400, 'Nothing to update');
	mutateBuild(db, buildId, userId, (tx, _view, now) => {
		upsert(tx, buildId, userId, now, set);
		return { kind: 'handoff.update', payload: { fields: Object.keys(set) } };
	});
}

/**
 * Mark the chair as handed off: saves any form fields sent along, fills the date with today when
 * none is set, and moves the build to the `done` phase.
 */
export function markHandedOff(db: Db, buildId: string, userId: string, body: unknown = {}): void {
	const set = parse(body ?? {});
	mutateBuild(db, buildId, userId, (tx, _view, now) => {
		const cur = tx.select().from(buildHandoff).where(eq(buildHandoff.buildId, buildId)).get();
		const date = set.handedOffOn ?? cur?.handedOffOn ?? now.toISOString().slice(0, 10);
		upsert(tx, buildId, userId, now, { ...set, handedOffOn: date });
		tx.update(builds).set({ phase: 'done' }).where(eq(builds.id, buildId)).run();
		return {
			kind: 'build.handoff',
			payload: {
				phase: 'done',
				handedOffOn: date,
				organization: set.organization ?? cur?.organization ?? null
			}
		};
	});
}
