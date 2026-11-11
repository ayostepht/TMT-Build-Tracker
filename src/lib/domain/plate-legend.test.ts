import { describe, expect, it } from 'vitest';
import type { ArrangedItem } from './arrange.ts';
import { legendRows } from './plate-legend.ts';

const item = (slug: string, piece = 0, extra: Partial<ArrangedItem> = {}): ArrangedItem => ({
	slug,
	piece,
	copy: 0,
	x: 0,
	y: 0,
	w: 10,
	d: 10,
	rotation: 0,
	role: 'tire',
	...extra
});

describe('legendRows', () => {
	const names: Record<string, string> = {
		tires: 'Tires',
		harness: 'Harness and Straps',
		wing: 'Wing Left'
	};
	const nameOf = (s: string) => names[s] ?? s;

	it('groups copies and pieces and numbers parts by first appearance', () => {
		const rows = legendRows(
			{
				parts: ['harness', 'tires'],
				items: [
					item('harness', 0),
					item('harness', 1),
					item('harness', 2),
					...Array.from({ length: 8 }, () => item('tires'))
				]
			},
			nameOf
		);
		expect(rows.map((r) => [r.n, r.label])).toEqual([
			[1, 'Harness and Straps: 3 pieces'],
			[2, 'Tires ×8']
		]);
	});

	it('names a single object plainly and reports rotated parts', () => {
		const rows = legendRows(
			{
				parts: ['wing'],
				items: [
					item('wing', 0, {
						rotation: 33,
						sil: 'wing:0'
					})
				]
			},
			nameOf
		);
		expect(rows[0]).toMatchObject({
			label: 'Wing Left',
			rotated: 33,
			approx: false
		});
	});

	it('flags parts drawn as boxes', () => {
		const rows = legendRows({ parts: ['tires'], items: [item('tires')] }, nameOf);
		expect(rows[0].approx).toBe(true);
	});
});
