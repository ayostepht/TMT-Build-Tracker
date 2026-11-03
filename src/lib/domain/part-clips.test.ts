import { describe, expect, it } from 'vitest';
import { keepBodiesIndex } from './part-clips.ts';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const clip = { normal: [0, 1, 0] as [number, number, number], constant: -30 };

// Two separate triangles (unshared vertices): one at y 40..45, one at y 20..35 (straddles the cut).
const positions = [0, 40, 0, 1, 45, 0, 0, 45, 1, 0, 20, 0, 1, 35, 0, 0, 35, 1];

describe('keepBodiesIndex', () => {
	it('drops whole bodies by bbox centre instead of slicing them', () => {
		const idx = keepBodiesIndex(positions, null, I, clip);
		expect([...idx!]).toEqual([0, 1, 2]);
	});
	it('applies the placement matrix before testing', () => {
		// Lift everything by 20: the second body (centre y 27.5 + 20) now stays too.
		const lift = [...I];
		lift[13] = 20;
		expect(keepBodiesIndex(positions, null, lift, clip)).toBeNull();
	});
	it('welds shared vertices so an indexed body is one body', () => {
		const pos = [0, 40, 0, 1, 20, 0, 0, 20, 1, 1, 20, 1];
		// Two triangles sharing an edge; centre y = 30 keeps the whole body.
		const idx = [0, 1, 2, 1, 3, 2];
		expect(keepBodiesIndex(pos, idx, I, clip)).toBeNull();
	});
});
