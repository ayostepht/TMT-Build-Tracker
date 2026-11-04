import { describe, expect, it } from 'vitest';
import { arrange, type ArrangePart, type ArrangePrinter, type ArrangeRole } from './arrange.ts';
import { GROUP_VERSION, type SourceGroup } from './print-footprint.ts';

const roles: ArrangeRole[] = [{ key: 'primary', name: 'Primary', material: 'PETG' }];
const bed = (x: number, y = x): ArrangePrinter => ({
	bedX: x,
	bedY: y,
	margin: 5,
	spacing: 8,
	mmSlots: 1
});
const rect = (w: number, d: number, cx = 0, cy = 0) =>
	[
		[cx - w / 2, cy - d / 2],
		[cx + w / 2, cy - d / 2],
		[cx + w / 2, cy + d / 2],
		[cx - w / 2, cy + d / 2]
	] as [number, number][];

/**
 * Two 100 x 100 pieces as the source laid them out: a 100 x 150 block (they interlock, which the
 * per-piece boxes cannot express: two boxes need 208 mm of height), the second turned 90 degrees.
 */
function pair(): ArrangePart {
	const group: SourceGroup = {
		v: GROUP_VERSION,
		plate: 3,
		bed: { x: 256, y: 256 },
		items: [
			{ piece: 0, x: 0, y: -25, rot: 0 },
			{ piece: 0, x: 0, y: 25, rot: 90 }
		],
		w: 100,
		d: 150,
		outline: [rect(100, 150)],
		hull: rect(100, 150)
	};
	return {
		slug: 'pair',
		name: 'Pair',
		role: 'primary',
		units: 1,
		footprint: {
			slug: 'pair',
			pieces: [{ name: 'block', w: 100, d: 100, h: 10, copies: 2 }],
			groups: [group]
		}
	};
}

const run = (p: ArrangePart[], b = bed(256)) => arrange({ parts: p, roles, printer: b });

describe('rigid source groups', () => {
	it('packs piece by piece when that does not split the part (densest)', () => {
		const r = run([pair()]);
		expect(r.plates).toHaveLength(1);
		expect(r.plates[0].items.every((i) => i.group === undefined)).toBe(true);
		expect(r.warnings.filter((w) => w.code === 'split')).toEqual([]);
	});

	it('uses the source group when per-piece packing would split the part', () => {
		const r = run([pair()], bed(110, 160));
		expect(r.plates).toHaveLength(1);
		expect(r.warnings.filter((w) => w.code === 'split')).toEqual([]);
		const [a, b] = r.plates[0].items;
		expect(a.group).toBeDefined();
		expect(a.group).toBe(b.group);
		// the pieces keep their relative offset (0, 50) and the source's 90 degree turn
		expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(50, 0);
		expect((((b.rotation - a.rotation) % 360) + 360) % 360).toBeCloseTo(90, 1);
	});

	it('breaks the group up and notes the split when the bed is too small for it', () => {
		const r = run([pair()], bed(110, 110));
		expect(r.plates.length).toBe(2);
		expect(r.warnings.some((w) => w.code === 'split' && w.slug === 'pair')).toBe(true);
		expect(r.plates.flatMap((p) => p.items).every((i) => i.group === undefined)).toBe(true);
	});

	it('ignores group data that asks for more objects than the part has', () => {
		const p = pair();
		p.footprint.pieces[0].copies = 1;
		const r = run([p], bed(110, 160));
		expect(r.plates.flatMap((x) => x.items)).toHaveLength(1);
		expect(r.plates[0].items[0].group).toBeUndefined();
	});

	it('pieces from different source plates on different plates are not a split', () => {
		const p = pair();
		p.footprint.pieces.push({ name: 'lid', w: 240, d: 240, h: 5, copies: 1 });
		const r = run([p]);
		expect(r.plates.length).toBe(2);
		expect(r.warnings.filter((w) => w.code === 'split')).toEqual([]);
	});
});
