import { describe, expect, it } from 'vitest';
import type { BuildView } from '#lib/domain/types.ts';
import { nextUpPlate } from './next-up.ts';

function view(plates: { n: number; parts: string[] }[], status: Record<string, string>) {
	return {
		plates: plates.map((p) => ({ number: p.n, parts: p.parts })),
		state: Object.fromEntries(Object.entries(status).map(([k, v]) => [k, { status: v }]))
	} as unknown as BuildView;
}

describe('nextUpPlate', () => {
	it('takes the lowest-numbered plate with a part still to do', () => {
		const v = view(
			[
				{ n: 2, parts: ['b'] },
				{ n: 1, parts: ['a'] },
				{ n: 3, parts: ['c'] }
			],
			{ a: 'Printed', b: 'Reprint', c: 'To print' }
		);
		expect(nextUpPlate(v)?.number).toBe(2);
	});
	it('skips plates on the printer', () => {
		const v = view(
			[
				{ n: 1, parts: ['a', 'b'] },
				{ n: 2, parts: ['c'] }
			],
			{ a: 'Printing', b: 'To print', c: 'To print' }
		);
		expect(nextUpPlate(v)?.number).toBe(2);
	});
	it('is null when everything is printed or printing', () => {
		const v = view([{ n: 1, parts: ['a'] }], { a: 'Printed' });
		expect(nextUpPlate(v)).toBeNull();
		expect(nextUpPlate(view([{ n: 1, parts: ['a'] }], { a: 'Printing' }))).toBeNull();
	});
});
