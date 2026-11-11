import { describe, expect, it } from 'vitest';
import { applyPatches, setStatus, startPrinting, stopPrinting } from './actions.ts';
import { makeView } from './fixtures.ts';

describe('applyPatches (optimistic updates)', () => {
	const view = makeView();
	const slug = view.parts[0].slug;
	const now = new Date('2026-02-03T10:00:00Z');

	it('applies a status change without touching the input view', () => {
		const next = applyPatches(view, setStatus(view, slug, 'Printed', now));
		expect(next.state[slug].status).toBe('Printed');
		expect(next.state[slug].printedOn).toBe('2026-02-03');
		expect(view.state[slug].status).toBe('To print');
	});

	it('matches the domain rules for start and take-off', () => {
		const started = applyPatches(view, startPrinting(view, [slug], now));
		expect(started.state[slug].status).toBe('Printing');
		expect(started.state[slug].startedAt).toBe(now.toISOString());
		const off = applyPatches(started, stopPrinting(started, [slug]));
		expect(off.state[slug].status).toBe('To print');
		expect(off.state[slug].startedAt).toBeNull();
	});

	it('keeps fields a patch does not set, ignores unknown slugs, and no-ops on empty', () => {
		const withNote = applyPatches(view, [{ slug, startedAt: '2026-02-03T09:00:00.000Z' }]);
		expect(withNote.state[slug].status).toBe('To print');
		expect(withNote.state[slug].startedAt).toBe('2026-02-03T09:00:00.000Z');
		expect(applyPatches(view, [{ slug: 'nope', status: 'Printed' }]).state).toEqual(view.state);
		expect(applyPatches(view, [])).toBe(view);
	});
});
