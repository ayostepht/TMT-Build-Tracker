import { describe, expect, it } from 'vitest';
import {
	arrange,
	plateTitle,
	type ArrangeInput,
	type ArrangePart,
	type ArrangePrinter,
	type ArrangeRole,
	orientsOf,
	type ArrangedPlate
} from './arrange.ts';
import { computePoses } from './orient.ts';

const roles: ArrangeRole[] = [
	{ key: 'primary', name: 'Primary', material: 'PETG' },
	{ key: 'accent', name: 'Accent', material: 'PETG' },
	{ key: 'soft', name: 'Soft', material: 'TPU 95A', tpu: true },
	{ key: 'tire', name: 'Tire', material: 'TPU 95A', tpu: true }
];

const part = (
	slug: string,
	role: string,
	w: number,
	d: number,
	extra: Partial<ArrangePart> & { copies?: number } = {}
): ArrangePart => {
	const { copies, ...rest } = extra;
	return {
		slug,
		name: slug
			.split('-')
			.map((s) => s[0].toUpperCase() + s.slice(1))
			.join(' '),
		role,
		units: 1,
		grams: 100,
		footprint: { slug, pieces: [{ name: slug, w, d, h: 20, copies: copies ?? 1 }] },
		...rest
	};
};

const bed = (x: number, y = x, mmSlots = 1): ArrangePrinter => ({
	bedX: x,
	bedY: y,
	margin: 5,
	spacing: 8,
	mmSlots
});
const run = (parts: ArrangePart[], printer = bed(256), extra: Partial<ArrangeInput> = {}) =>
	arrange({ parts, roles, printer, ...extra });

/** No overlaps, inside the margin, spacing respected. */
function expectValid(plates: ArrangedPlate[], printer = bed(256)) {
	for (const p of plates) {
		if (p.oversize) continue;
		for (const i of p.items) {
			expect(i.x - i.w / 2).toBeGreaterThanOrEqual(printer.margin - 0.11);
			expect(i.y - i.d / 2).toBeGreaterThanOrEqual(printer.margin - 0.11);
			expect(i.x + i.w / 2).toBeLessThanOrEqual(printer.bedX - printer.margin + 0.11);
			expect(i.y + i.d / 2).toBeLessThanOrEqual(printer.bedY - printer.margin + 0.11);
		}
		for (let a = 0; a < p.items.length; a++)
			for (let b = a + 1; b < p.items.length; b++) {
				const A = p.items[a];
				const B = p.items[b];
				const gx = Math.abs(A.x - B.x) - (A.w + B.w) / 2;
				const gy = Math.abs(A.y - B.y) - (A.d + B.d) / 2;
				expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(printer.spacing - 0.3);
			}
	}
}

describe('arrange: fitting and rotation', () => {
	it('puts a small set on one plate with no overlap', () => {
		const r = run([
			part('a', 'primary', 100, 100),
			part('b', 'primary', 100, 100),
			part('c', 'primary', 60, 60)
		]);
		expect(r.plates).toHaveLength(1);
		expect(r.plates[0].items).toHaveLength(3);
		expect(r.warnings).toEqual([]);
		expectValid(r.plates);
	});

	it('opens a second plate when the first is full', () => {
		const r = run([part('a', 'primary', 200, 200), part('b', 'primary', 200, 200)]);
		expect(r.plates).toHaveLength(2);
		expectValid(r.plates);
	});

	it('rotates 90 degrees when that is the only way to fit', () => {
		const r = run([part('long', 'primary', 100, 240)], bed(256, 120));
		expect(r.plates[0].items[0].rotation).toBe(90);
		expect(r.plates[0].items[0].w).toBe(240);
		expect(r.warnings).toEqual([]);
	});

	it('does not rotate when rotation is disallowed and warns instead', () => {
		const r = run([part('long', 'primary', 100, 240, { rotate: false })], bed(256, 120));
		expect(r.warnings[0].code).toBe('oversize');
		expect(r.plates[0].oversize).toBe(true);
	});

	it('uses rotation to pack tighter', () => {
		// the upright bar has to be turned to stack with the flat one
		const r = run([part('a', 'primary', 240, 110), part('b', 'primary', 110, 240)], bed(256));
		expect(r.plates).toHaveLength(1);
		expect(r.plates[0].items.some((i) => i.rotation === 90)).toBe(true);
		expectValid(r.plates);
	});
});

describe('arrange: tilting to fit', () => {
	// a thin bar 300 x 20 does not fit a 256 bed at 0/90, but fits diagonally
	const bar = (rotate?: boolean): ArrangePart => ({
		...part('bar', 'primary', 300, 20),
		footprint: {
			slug: 'bar',
			pieces: [
				{
					name: 'bar',
					w: 300,
					d: 20,
					h: 20,
					copies: 1,
					hull: [
						[-150, -10],
						[150, -10],
						[150, 10],
						[-150, 10]
					]
				}
			]
		},
		rotate
	});

	it('turns a long part to a free angle when 0/90 cannot fit', () => {
		const r = run([bar()], bed(256));
		expect(r.plates[0].oversize).toBeUndefined();
		const it = r.plates[0].items[0];
		expect(it.rotation % 90).not.toBe(0);
		expect(it.w).toBeLessThanOrEqual(246);
		expect(it.d).toBeLessThanOrEqual(246);
		expect(r.warnings.map((w) => w.code)).toEqual(['tilted']);
		expectValid(r.plates);
	});

	it('does not tilt when rotation is off', () => {
		const r = run([bar(false)], bed(256));
		expect(r.warnings[0].code).toBe('oversize');
	});

	it('still reports oversize when even the diagonal is too short', () => {
		const r = run([part('huge', 'primary', 400, 300)], bed(256));
		expect(r.warnings[0].code).toBe('oversize');
	});

	it('orientsOf prefers 0/90 and only tilts as a last resort', () => {
		expect(orientsOf({ w: 100, d: 50 }, true, 246, 246).map((o) => o.rot)).toEqual([0, 90]);
		expect(orientsOf({ w: 100, d: 100 }, true, 246, 246)).toHaveLength(1);
		expect(orientsOf({ w: 100, d: 50 }, false, 246, 246)).toHaveLength(1);
	});
});

describe('arrange: oversize', () => {
	it('warns with the size and suggests the alternative', () => {
		const r = run(
			[
				part('wheel-mount-left', 'primary', 268, 251, {
					hint: 'Try the Two pieces footrest option.'
				})
			],
			bed(256)
		);
		expect(r.warnings).toHaveLength(1);
		expect(r.warnings[0]).toMatchObject({ code: 'oversize', slug: 'wheel-mount-left' });
		expect(r.warnings[0].message).toContain("268×251 mm doesn't fit a 256×256 mm bed even rotated");
		expect(r.warnings[0].message).toContain('Two pieces');
		// the part still appears on its own plate so it can be tracked
		expect(r.plates).toHaveLength(1);
		expect(r.plates[0].oversize).toBe(true);
		expect(r.plates[0].parts).toEqual(['wheel-mount-left']);
	});

	it('the same part fits a bigger bed', () => {
		const r = run([part('wheel-mount-left', 'primary', 268, 251)], bed(350, 320));
		expect(r.warnings).toEqual([]);
		expect(r.plates[0].oversize).toBeUndefined();
	});

	it('margin counts: 250 does not fit 256 with a 5 mm margin', () => {
		const r = run([part('x', 'primary', 250, 100)], bed(256));
		expect(r.warnings[0]?.code).toBe('oversize');
	});

	it('a 180 bed rejects what a 256 bed takes', () => {
		const parts = [part('a', 'primary', 200, 120), part('b', 'primary', 150, 150)];
		expect(run(parts, bed(256)).warnings).toEqual([]);
		const small = run(parts, bed(180));
		expect(small.warnings.map((w) => w.slug)).toEqual(['a']);
	});
});

describe('arrange: grouping by filament', () => {
	it('never mixes roles on a single-filament printer', () => {
		const r = run([
			part('a', 'primary', 50, 50),
			part('b', 'accent', 50, 50),
			part('c', 'soft', 50, 50)
		]);
		expect(r.plates).toHaveLength(3);
		for (const p of r.plates) expect(p.roles).toHaveLength(1);
	});

	it('orders plates by role order, then part order', () => {
		const r = run([part('z-soft', 'soft', 50, 50), part('a-prim', 'primary', 50, 50)]);
		expect(r.plates.map((p) => p.roles[0])).toEqual(['primary', 'soft']);
	});

	it('merges underfilled PETG plates on a multi-material printer', () => {
		const parts = [part('a', 'primary', 80, 80), part('b', 'accent', 80, 80)];
		const single = run(parts, bed(256, 256, 1));
		const multi = run(parts, bed(256, 256, 4));
		expect(single.plates).toHaveLength(2);
		expect(multi.plates).toHaveLength(1);
		expect(multi.plates[0].roles).toEqual(['primary', 'accent']);
	});

	it('respects the slot limit', () => {
		const rs: ArrangeRole[] = ['r1', 'r2', 'r3'].map((k) => ({
			key: k,
			name: k,
			material: 'PETG'
		}));
		const parts = rs.map((r) => part(`p-${r.key}`, r.key, 50, 50));
		const two = arrange({ parts, roles: rs, printer: bed(256, 256, 2) });
		expect(two.plates).toHaveLength(2);
		const three = arrange({ parts, roles: rs, printer: bed(256, 256, 3) });
		expect(three.plates).toHaveLength(1);
	});

	it('keeps PETG and TPU apart even with plenty of slots', () => {
		const r = run([part('a', 'primary', 50, 50), part('b', 'soft', 50, 50)], bed(256, 256, 8));
		expect(r.plates).toHaveLength(2);
	});

	it('lets TPU colors share a plate when slots allow', () => {
		const r = run([part('a', 'soft', 50, 50), part('b', 'tire', 50, 50)], bed(256, 256, 4));
		expect(r.plates).toHaveLength(1);
	});

	it('does not merge two well-filled plates', () => {
		const r = run(
			[part('a', 'primary', 230, 230), part('b', 'accent', 230, 230)],
			bed(256, 256, 4)
		);
		expect(r.plates).toHaveLength(2);
	});
});

describe('arrange: runs, copies and keep-together', () => {
	it('prints rims once per plate and twice in total', () => {
		const rim = (slug: string, role: string) =>
			part(slug, role, 200, 200, {
				units: 2,
				footprint: {
					slug,
					unitsPerPlate: 1,
					pieces: [{ name: slug, w: 200, d: 200, h: 30, copies: 1 }]
				}
			});
		const r = run([rim('rims-1-4', 'accent'), rim('rims-2-3', 'primary')], bed(256, 256, 1));
		expect(r.plates).toHaveLength(2);
		expect(r.plates.every((p) => p.runs === 2)).toBe(true);
		expect(r.plates.every((p) => p.items.length === 1)).toBe(true);
		expect(r.plates.find((p) => p.roles[0] === 'accent')!.estGrams.accent).toBe(100); // per run: one unit
	});

	it('merges both rim colors into one plate run twice with CANVAS', () => {
		const rim = (slug: string, role: string) =>
			part(slug, role, 110, 110, {
				units: 2,
				footprint: {
					slug,
					unitsPerPlate: 1,
					pieces: [{ name: slug, w: 110, d: 110, h: 30, copies: 1 }]
				}
			});
		const r = run([rim('rims-1-4', 'accent'), rim('rims-2-3', 'primary')], bed(256, 256, 4));
		expect(r.plates).toHaveLength(1);
		expect(r.plates[0].runs).toBe(2);
		expect(r.plates[0].items).toHaveLength(2);
	});

	it('keeps different run counts on different plates', () => {
		const a = part('once', 'primary', 50, 50);
		const b = part('twice', 'primary', 50, 50, {
			units: 2,
			footprint: {
				slug: 'twice',
				unitsPerPlate: 1,
				pieces: [{ name: 'twice', w: 50, d: 50, h: 5, copies: 1 }]
			}
		});
		const r = run([a, b], bed(256, 256, 4));
		expect(r.plates.map((p) => p.runs).sort()).toEqual([1, 2]);
	});

	it('places all copies of a part (16 tires) and splits when they do not fit', () => {
		const tires = part('tires', 'tire', 70, 70, { copies: 16 });
		const small = run([tires], bed(256));
		const n = small.plates.reduce((a, p) => a + p.items.length, 0);
		expect(n).toBe(16);
		expect(small.plates.length).toBeGreaterThan(1);
		expect(small.warnings.some((w) => w.code === 'split')).toBe(true);
		const big = run([part('tires', 'tire', 70, 70, { copies: 16 })], bed(350, 320));
		expect(big.plates).toHaveLength(1);
		expectValid(small.plates);
		expectValid(big.plates, bed(350, 320));
	});

	it('copy numbers are unique per part', () => {
		const r = run([part('tires', 'tire', 70, 70, { copies: 16 })], bed(350, 320));
		const copies = r.plates[0].items.map((i) => i.copy).sort((a, b) => a - b);
		expect(copies).toEqual([...Array(16).keys()]);
	});

	it('keeps a left/right group on one plate when it fits, and apart when it must', () => {
		const pair = [
			part('pair-left', 'primary', 110, 110, { group: 'pair' }),
			part('pair-right', 'primary', 110, 110, { group: 'pair' })
		];
		const filler = part('filler', 'primary', 200, 100);
		const r = run([filler, ...pair]);
		const plateOf = (s: string) => r.plates.find((p) => p.parts.includes(s))!.number;
		expect(plateOf('pair-left')).toBe(plateOf('pair-right'));
	});

	it('names pairs and sets', () => {
		expect(plateTitle(['Wing Left', 'Wing Right'])).toBe('Wings');
		expect(plateTitle(['Connectors', 'Hub Caps'])).toBe('Connectors + Hub Caps');
		expect(plateTitle(['A', 'B', 'C', 'D'])).toBe('A, B + 2 more');
		const r = run([part('wing-left', 'accent', 100, 100), part('wing-right', 'accent', 100, 100)]);
		expect(r.plates[0].name).toBe('Wings (Accent)');
	});

	it('numbers repeated names', () => {
		const r = run([
			part('a', 'primary', 200, 200, { name: 'Same' }),
			part('b', 'primary', 200, 200, { name: 'Same' })
		]);
		expect(r.plates.map((p) => p.name)).toEqual(['Same (Primary) 1/2', 'Same (Primary) 2/2']);
	});

	it('gives parts without geometry their own plate', () => {
		const r = run([part('a', 'primary', 50, 50)], bed(256), {
			unsized: [{ slug: 'mystery', name: 'Mystery', role: 'accent', grams: 12 }]
		});
		expect(r.plates).toHaveLength(2);
		expect(r.plates[1].items).toEqual([]);
		expect(r.plates[1].parts).toEqual(['mystery']);
		expect(r.warnings.some((w) => w.code === 'unsized')).toBe(true);
	});
});

describe('arrange: determinism and recolor', () => {
	const kit = () => [
		part('wing-left', 'accent', 240, 100),
		part('wing-right', 'accent', 240, 100),
		part('seat', 'primary', 200, 180),
		part('handle-left', 'primary', 220, 90),
		part('handle-right', 'primary', 220, 90),
		part('grip', 'soft', 120, 60),
		part('tires', 'tire', 60, 60, { copies: 16 })
	];

	it('is deterministic', () => {
		const a = JSON.stringify(run(kit()));
		for (let i = 0; i < 5; i++) expect(JSON.stringify(run(kit()))).toBe(a);
	});

	it('moving Wing Left to another color moves it to another plate', () => {
		const before = run(kit());
		const moved = kit().map((p) => (p.slug === 'wing-left' ? { ...p, role: 'primary' } : p));
		const after = run(moved);
		const roleOfPlate = (r: ReturnType<typeof run>, slug: string) =>
			r.plates.find((p) => p.parts.includes(slug))!.roles;
		expect(roleOfPlate(before, 'wing-left')).toEqual(['accent']);
		expect(roleOfPlate(after, 'wing-left')).toEqual(['primary']);
		const pb = before.plates.find((p) => p.parts.includes('wing-right'))!;
		const pa = after.plates.find((p) => p.parts.includes('wing-right'))!;
		expect(pb.parts).toContain('wing-left');
		expect(pa.parts).not.toContain('wing-left');
		expectValid(after.plates);
	});

	it('is fast enough for the whole kit', () => {
		const many: ArrangePart[] = [];
		for (let i = 0; i < 40; i++)
			many.push(
				part(`p${i}`, roles[i % 4].key, 40 + (i % 7) * 20, 30 + (i % 5) * 25, {
					copies: 1 + (i % 3)
				})
			);
		many.push(part('tires', 'tire', 70, 70, { copies: 16 }));
		const t0 = performance.now();
		const r = run(many, bed(256, 256, 4));
		expect(performance.now() - t0).toBeLessThan(50);
		expectValid(r.plates);
	});

	it('estimates grams per role', () => {
		const r = run([
			part('a', 'primary', 50, 50, { grams: 40 }),
			part('b', 'primary', 50, 50, { grams: 2.5 })
		]);
		expect(r.plates[0].estGrams).toEqual({ primary: 42.5 });
	});
});

describe('arrange: re-orientation', () => {
	// 320 x 190 x 20 slab: too big flat for a 256 bed (even tilted), fits standing on its long edge
	const slab = (withOrient: boolean): ArrangePart => {
		const mesh = {
			positions: [
				-160, -95, 0, 160, -95, 0, 160, 95, 0, -160, 95, 0, -160, -95, 20, 160, -95, 20, 160, 95,
				20, -160, 95, 20
			],
			indices: [
				0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
				0, 4, 3, 4, 7
			]
		};
		return {
			slug: 'wing-left',
			name: 'Wing Left',
			role: 'accent',
			units: 1,
			footprint: {
				slug: 'wing-left',
				pieces: [
					{
						name: 'wing',
						w: 320,
						d: 190,
						h: 20,
						copies: 1,
						mesh: 'wing-left.bin',
						...(withOrient ? { orient: computePoses(mesh) } : {})
					}
				]
			}
		};
	};
	const printer: ArrangePrinter = { ...bed(256), bedZ: 256 };

	// Hard rule (maintainer, 2026-11-04): never change which face is down; only flat rotations.
	it('never re-orients in 3D: a part that only fits stood up stays flat and is oversize', () => {
		const r = run([slab(true)], printer);
		expect(r.plates).toHaveLength(1);
		const it = r.plates[0].items[0];
		expect(it.pose).toBeUndefined();
		expect(r.plates[0].oversize).toBe(true);
		expect(r.warnings.some((x) => x.code === 'reoriented')).toBe(false);
		expect(r.warnings.some((x) => x.code === 'oversize')).toBe(true);
	});

	it('keeps the profile orientation whenever it fits', () => {
		const p = slab(true);
		p.footprint.pieces[0].w = 200;
		p.footprint.pieces[0].d = 100;
		const r = run([p], printer);
		expect(r.plates[0].items[0].pose).toBeUndefined();
		expect(r.warnings).toEqual([]);
	});

	it('seed footprints cannot be re-oriented: the oversize warning points to the import', () => {
		const r = run([slab(false)], printer);
		expect(r.plates[0].oversize).toBe(true);
		expect(r.warnings[0].code).toBe('oversize');
		expect(r.warnings[0].message).toContain('Importing the print geometry');
	});

	it('respects the build height', () => {
		const r = run([slab(true)], { ...bed(256), bedZ: 150 });
		expect(r.plates[0].oversize).toBe(true);
		expect(r.warnings[0].message).toContain('does not fit either');
	});

	it('is deterministic', () => {
		const a = run([slab(true), part('b', 'accent', 60, 60)], printer);
		const b = run([slab(true), part('b', 'accent', 60, 60)], printer);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
});
