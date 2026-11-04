import { and, eq } from 'drizzle-orm';
import { resolveItem } from '#lib/domain/assembly.ts';
import { ApiError } from '../access';
import type { Db } from '../db';
import { buildAssembly } from '../db/schema';
import { mutateBuild } from './actions';

/**
 * Tick or untick one assembly item, or edit its note. `itemKey` is a step key, `<step>:check:<key>`
 * or `<step>:hw:<name>` of a step that applies to this build's variant choices. Editors and owners only.
 */
export function setAssemblyItem(
	db: Db,
	buildId: string,
	userId: string,
	itemKey: unknown,
	patch: { done?: unknown; note?: unknown }
): void {
	if (typeof itemKey !== 'string' || !itemKey) throw new ApiError(400, 'itemKey is required');
	if (patch.done !== undefined && typeof patch.done !== 'boolean')
		throw new ApiError(400, 'done must be true or false');
	if (patch.note !== undefined && (typeof patch.note !== 'string' || patch.note.length > 1000))
		throw new ApiError(400, 'note must be text of at most 1000 characters');
	if (patch.done === undefined && patch.note === undefined)
		throw new ApiError(400, 'Nothing to update');

	mutateBuild(db, buildId, userId, (tx, view, now) => {
		const hit = resolveItem(view.assembly.steps, itemKey);
		if (!hit) throw new ApiError(400, 'That item is not part of this build');
		const where = and(eq(buildAssembly.buildId, buildId), eq(buildAssembly.itemKey, itemKey));
		const cur = tx.select().from(buildAssembly).where(where).get();
		const note = typeof patch.note === 'string' ? patch.note.trim() : undefined;
		const done = patch.done as boolean | undefined;
		const set: Partial<typeof buildAssembly.$inferInsert> = {};
		if (note !== undefined) set.note = note;
		if (done !== undefined) {
			set.done = done;
			set.doneBy = done ? userId : null;
			set.doneAt = done ? now : null;
		}
		if (cur) tx.update(buildAssembly).set(set).where(where).run();
		else
			tx.insert(buildAssembly)
				.values({ buildId, itemKey, ...set })
				.run();
		const noteChanged = note !== undefined && note !== (cur?.note ?? '');
		return {
			kind: 'assembly.item',
			payload: {
				itemKey,
				stepKey: hit.step.key,
				step: hit.step.title,
				item: hit.kind,
				text: hit.text,
				...(done !== undefined ? { done } : {}),
				...(noteChanged ? { note: note ? 'set' : 'cleared' } : {})
			}
		};
	});
}
