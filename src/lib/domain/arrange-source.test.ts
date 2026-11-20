import { describe, expect, it } from 'vitest';
import {
	arrange,
	SOLO_MARGIN,
	type ArrangedItem,
	type ArrangeInput,
	type ArrangePart,
	type ArrangePrinter,
	type ArrangeRole
} from './arrange.ts';
import {
	arrangeFromSource,
	isRunPlate,
	JOIN_MAX_UTILISATION,
	RULES_V2,
	soloParts,
	type SourcePlate
} from './arrange-source.ts';
import { pieceBrimMm } from './print-footprint.ts';

// The kit's own layout comes first; the arranger is the exception. Fixture: a "kit" of nine parts on
// five source plates, two of them alone on their plate (big1, big2).

const roles: ArrangeRole[] = [
	{ key: 'primary', name: 'Primary', material: 'PETG' },
	{ key: 'accent', name: 'Accent', material: 'PETG' },
	{ key: 'soft', name: 'Soft', material: 'TPU 95A', tpu: true }
];

const part = (
	slug: string,
	role: string,
	w: number,
	d: number,
	extra: Partial<ArrangePart> = {}
): ArrangePart => ({
	slug,
	name: slug[0].toUpperCase() + slug.slice(1),
	role,
	baseRole: role,
	units: 1,
	grams: 50,
	footprint: { slug, pieces: [{ name: slug, w, d, h: 20, copies: 1 }] },
	...extra
});

const printer = (extra: Partial<ArrangePrinter> = {}): ArrangePrinter => ({
	bedX: 256,
	bedY: 256,
	margin: 1,
	spacing: 8,
	mmSlots: 4,
	...extra
});

const kit = (): ArrangePart[] => [
	part('big1', 'primary', 230, 140),
	part('big2', 'primary', 240, 100),
	part('pa', 'primary', 100, 60),
	part('pb', 'primary', 100, 60),
	part('pc', 'accent', 60, 60),
	part('pd', 'accent', 60, 60),
	part('t1', 'soft', 80, 50),
	part('t2', 'soft', 80, 50),
	part('small', 'accent', 30, 30)
];
const source = (): SourcePlate[] => [
	{ number: 1, name: 'Big One', parts: ['big1'] },
	{ number: 2, name: 'Big Two', parts: ['big2'] },
	{ number: 3, name: 'Pair A B', parts: ['pa', 'pb'] },
	{ number: 4, name: 'Pair C D', parts: ['pc', 'pd'] },
	{ number: 5, name: 'Soft Pair', parts: ['t1', 't2'] },
	{ number: 6, name: 'Small', parts: ['small'] }
];
const input = (parts = kit(), p = printer()): ArrangeInput => ({ parts, roles, printer: p });
const withRole = (parts: ArrangePart[], slug: string, role: string) =>
	parts.map((p) => (p.slug === slug ? { ...p, role } : p));
const plateOf = (r: { plates: { number: number; name: string; parts: string[] }[] }, n: number) =>
	r.plates.find((p) => p.number === n);

describe('A. the source layout stays', () => {
	it('standard palette: every plate is the source plate, same parts, positions and rotations', () => {
		const r = arrangeFromSource(input(), source());
		expect(r.plates.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(r.plates.map((p) => p.parts)).toEqual(source().map((s) => s.parts));
		expect(r.plates.map((p) => p.name)).toEqual(source().map((s) => s.name));
		expect(r.kept).toEqual([1, 2, 3, 4, 5, 6]);
		expect(r.moves).toEqual([]);
		// a source that carries its own positions keeps them exactly
		const withPoses = source().map((s) => ({
			...s,
			items: r.plates.find((p) => p.number === s.number)!.items
		}));
		const again = arrangeFromSource(input(), withPoses);
		expect(again.plates).toEqual(r.plates);
		// and the plain arranger would have merged and re-packed: this is the point
		const plain = arrange(input());
		expect(plain.plates.length).not.toBe(r.plates.length);
	});

	it('a source plate that mixed two kit colors stays mixed while those colors stay', () => {
		const parts = kit().map((p) =>
			p.slug === 'pb' ? { ...p, role: 'accent', baseRole: 'accent' } : p
		);
		const r = arrangeFromSource(input(parts), source());
		expect(plateOf(r, 3)!.parts).toEqual(['pa', 'pb']);
		expect(r.moves).toEqual([]);
		// a printer with a single slot cannot print it: then the minority part leaves
		const one = arrangeFromSource(input(parts, printer({ mmSlots: 1 })), source());
		expect(plateOf(one, 3)!.parts.length).toBe(1);
		expect(one.moves.map((m) => m.slug)).toHaveLength(1);
	});

	it('uses source positions when the plate stays but does not trust ones that leave the bed', () => {
		const r = arrangeFromSource(input(), source());
		const bad = source().map((s) =>
			s.number === 3 ? { ...s, items: r.plates[2].items.map((i) => ({ ...i, x: i.x + 400 })) } : s
		);
		const again = arrangeFromSource(input(), bad);
		expect(plateOf(again, 3)!.parts).toEqual(['pa', 'pb']);
		expect(again.plates[2].items).toEqual(r.plates[2].items);
	});
});

describe('B. only what must move moves (planner 2 rules: movers get new plates)', () => {
	it('a design that splits a two-part plate moves only the minority part, to a new plate', () => {
		const standard = arrangeFromSource(input(), source(), RULES_V2);
		const parts = withRole(kit(), 'pb', 'accent');
		const r = arrangeFromSource(input(parts), source(), RULES_V2);
		// the same plates in the same places, plus one new plate
		expect(r.plates.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(plateOf(r, 3)!.parts).toEqual(['pa']);
		expect(plateOf(r, 7)!.parts).toEqual(['pb']);
		for (const n of [1, 2, 4, 5, 6]) expect(plateOf(r, n)).toEqual(plateOf(standard, n));
		// the stay part keeps the position it had on the two-part plate
		const was = standard.plates[2].items.find((i) => i.slug === 'pa')!;
		const now = r.plates[2].items.find((i) => i.slug === 'pa')!;
		expect({ x: now.x, y: now.y, rotation: now.rotation }).toEqual({
			x: was.x,
			y: was.y,
			rotation: was.rotation
		});
		expect(r.moves).toEqual([{ slug: 'pb', from: 3, to: 7, reason: 'filament' }]);
		expect(r.kept).toEqual([1, 2, 4, 5, 6]);
	});

	it('the largest same-filament group stays, the minority moves', () => {
		const parts = [
			...kit().filter((p) => !['pa', 'pb'].includes(p.slug)),
			part('x1', 'primary', 70, 50),
			part('x2', 'primary', 70, 50),
			part('x3', 'primary', 70, 50)
		];
		const src = source().map((s) => (s.number === 3 ? { ...s, parts: ['x1', 'x2', 'x3'] } : s));
		const r = arrangeFromSource(input(withRole(parts, 'x2', 'accent')), src, RULES_V2);
		expect(plateOf(r, 3)!.parts).toEqual(['x1', 'x3']);
		expect(plateOf(r, 7)!.parts).toEqual(['x2']);
	});

	it('parts the source does not know go to new plates, never onto an existing one', () => {
		const parts = [...kit(), part('extra', 'primary', 30, 30)];
		const r = arrangeFromSource(input(parts), source());
		expect(plateOf(r, 7)!.parts).toEqual(['extra']);
		expect(r.moves).toEqual([{ slug: 'extra', from: null, to: 7, reason: 'new' }]);
		for (let n = 1; n <= 6; n++) expect(plateOf(r, n)!.parts).not.toContain('extra');
	});

	it('a plate that does not fit this bed gives up the part that does not fit, keeping its number', () => {
		const tall = kit().map((p) => (p.slug === 'pb' ? part('pb', 'primary', 200, 200) : p));
		const r = arrangeFromSource(input(tall), source());
		expect(r.plates.filter((p) => p.parts.includes('pa') || p.parts.includes('pb'))).toHaveLength(
			2
		);
		expect(r.moves.map((m) => m.reason)).toEqual(['bed']);
		expect(plateOf(r, 3)).toBeTruthy();
	});

	it('plate numbers and names of untouched plates never change when another plate splits', () => {
		const r = arrangeFromSource(input(withRole(kit(), 'pc', 'primary')), source());
		expect(plateOf(r, 4)!.name).not.toBe('Pair C D'); // lost a part: named for what is on it
		expect(plateOf(r, 3)!.name).toBe('Pair A B');
	});
});

describe('C. single-part plates are sacred', () => {
	it('lists the parts alone on a plate of the source', () => {
		expect(soloParts(source())).toEqual(['big1', 'big2', 'small']);
	});

	it('never receives another part, even with room, even when others are re-arranged', () => {
		const parts = [...withRole(kit(), 'pb', 'accent'), part('extra', 'accent', 20, 20)];
		const r = arrangeFromSource(input(parts), source(), RULES_V2);
		expect(plateOf(r, 6)!.parts).toEqual(['small']); // 30 x 30 on an otherwise empty bed
		expect(plateOf(r, 1)!.parts).toEqual(['big1']);
		expect(plateOf(r, 2)!.parts).toEqual(['big2']);
		// the movers share their own new plate instead
		expect(plateOf(r, 7)!.parts.sort()).toEqual(['extra', 'pb']);
		// planner 3: the part that left may join the accent pair (plate 4); `extra` is new to the layout and never joins
		const v3 = arrangeFromSource(input(parts), source());
		expect(plateOf(v3, 6)!.parts).toEqual(['small']);
		expect(plateOf(v3, 1)!.parts).toEqual(['big1']);
		expect(plateOf(v3, 2)!.parts).toEqual(['big2']);
		expect(plateOf(v3, 4)!.parts.sort()).toEqual(['pb', 'pc', 'pd']);
		expect(plateOf(v3, 7)!.parts).toEqual(['extra']);
	});

	it('keeps the relaxed safe area: a part that only fits the bed with a thin edge margin', () => {
		const p = printer({ margin: 5 });
		const parts = [part('big1', 'primary', 250, 120), part('other', 'primary', 40, 40)];
		const r = arrangeFromSource(input(parts, p), [
			{ number: 1, name: 'Big One', parts: ['big1'] },
			{ number: 2, name: 'Other', parts: ['other'] }
		]);
		const big = plateOf(r, 1)!;
		expect(big.parts).toEqual(['big1']);
		const it = r.plates[0].items[0];
		const lo = Math.min(it.x - it.w / 2, it.y - it.d / 2);
		const hi = Math.max(it.x + it.w / 2 - 256, it.y + it.d / 2 - 256);
		expect(lo).toBeGreaterThanOrEqual(SOLO_MARGIN - 0.11);
		expect(lo).toBeLessThan(5); // inside the printer's 5 mm margin
		expect(hi).toBeLessThanOrEqual(-SOLO_MARGIN + 0.11);
		expect(r.warnings.filter((w) => w.code === 'oversize')).toEqual([]);
		// a part that is not alone in the source does not get the relaxed margin
		const shared = arrangeFromSource(input([part('big1', 'primary', 250, 120)], p), [
			{ number: 1, name: 'Big One', parts: ['big1', 'ghost'] }
		]);
		expect(shared.warnings.some((w) => w.code === 'oversize')).toBe(true);
	});

	it('keeps its source pose when the plate stays', () => {
		const r = arrangeFromSource(input(), source());
		const pose = r.plates[0].items.map((i) => ({ ...i, x: i.x + 3, y: i.y - 2 }));
		const src = source().map((s) => (s.number === 1 ? { ...s, items: pose } : s));
		const again = arrangeFromSource(input(withRole(kit(), 'pb', 'accent')), src);
		expect(again.plates[0].items).toEqual(pose);
	});
});

describe('D. brims count', () => {
	const two = (brim: number): ArrangePart[] => [
		part('h1', 'primary', 120, 120, { brims: brim ? [brim] : undefined }),
		part('h2', 'primary', 120, 120, { brims: brim ? [brim] : undefined })
	];
	const run = (parts: ArrangePart[]) => arrange({ parts, roles, printer: printer() });

	it('two parts that fit side by side without their brim are not placed together with it', () => {
		expect(run(two(0)).plates).toHaveLength(1);
		const withBrim = run(two(5));
		expect(withBrim.plates).toHaveLength(2);
		expect(withBrim.plates.every((p) => p.parts.length === 1)).toBe(true);
	});

	it('the brim counts at the bed edge and in the item box', () => {
		const r = run([part('h1', 'primary', 200, 100, { brims: [10] })]);
		const it = r.plates[0].items[0];
		expect(it.w).toBeCloseTo(220, 0);
		expect(it.d).toBeCloseTo(120, 0);
		expect(it.x - it.w / 2).toBeGreaterThanOrEqual(1 - 0.11);
	});

	it('a part that fits only without its brim is placed without it, with a warning', () => {
		const r = run([part('h1', 'primary', 250, 100, { brims: [10] })]);
		expect(r.plates).toHaveLength(1);
		expect(r.plates[0].oversize).toBeUndefined();
		expect(r.warnings.map((w) => w.code)).toEqual(['brim']);
	});

	it('brims of moved parts count; kept source plates are trusted as authored', () => {
		const parts = [
			part('a', 'primary', 120, 120, { brims: [5] }),
			part('b', 'primary', 120, 120, { brims: [5] })
		];
		// the source has both on one plate (the author's file): stays, no brim margin applied
		const kept = arrangeFromSource(input(parts), [{ number: 1, name: 'Both', parts: ['a', 'b'] }]);
		expect(kept.plates).toHaveLength(1);
		expect(kept.kept).toEqual([1]);
		// both leave their plates (new parts): brims count, they cannot share
		const moved = arrangeFromSource(input(parts), []);
		expect(moved.plates).toHaveLength(2);
	});

	it('reads brim width from the object settings, else the part text', () => {
		expect(pieceBrimMm({ settings: { brim_type: 'outer_only', brim_width: '10' } })).toBe(10);
		expect(pieceBrimMm({ settings: { brim_type: 'no_brim', brim_width: '10' } }, '10 mm')).toBe(0);
		expect(pieceBrimMm({ settings: { wall_loops: '2' } }, '10 mm')).toBe(10);
		expect(pieceBrimMm(undefined, null)).toBe(0);
		expect(pieceBrimMm(undefined, 'none')).toBe(0);
		expect(pieceBrimMm({ settings: { brim_type: 'outer_only', brim_width: '900' } })).toBe(20);
	});
});

describe('E. no layout for the bed', () => {
	it('the arranger runs fresh but parts alone in the kit stay alone', () => {
		const solo = soloParts(source());
		const free = arrange(input());
		const guarded = arrange({ ...input(), options: { solo } });
		const together = (r: typeof free, a: string) =>
			r.plates.find((p) => p.parts.includes(a))!.parts.length > 1;
		// without the rule the arranger packs the lone parts with others (or merges them)
		expect(['big1', 'big2', 'small'].some((s) => together(free, s))).toBe(true);
		for (const s of solo) {
			expect(guarded.plates.find((p) => p.parts.includes(s))!.parts).toEqual([s]);
		}
		// everything else is still packed fresh: the pairs share plates
		expect(guarded.plates.some((p) => p.parts.length > 1)).toBe(true);
	});
});

// ---- F. a moved part may join an existing multi-part plate; G. run plates stay one plate

type Box = { x: number; y: number; w: number; d: number };
/** Distance between two axis-aligned item boxes (0 when they touch or overlap). */
const boxGap = (a: Box, b: Box) =>
	Math.hypot(
		Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2),
		Math.max(0, Math.abs(a.y - b.y) - (a.d + b.d) / 2)
	);

describe('F. a moved part may join an existing multi-part plate', () => {
	const usable = 254 * 254;

	it('joins a plate that was a multi-part plate, in its own filament, and the others stay put', () => {
		const standard = arrangeFromSource(input(), source());
		const r = arrangeFromSource(input(withRole(kit(), 'pb', 'accent')), source());
		// no new plate: the accent pair (plate 4) took it
		expect(r.plates.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(plateOf(r, 3)!.parts).toEqual(['pa']);
		expect(plateOf(r, 4)!.parts.sort()).toEqual(['pb', 'pc', 'pd']);
		expect(r.moves).toEqual([{ slug: 'pb', from: 3, to: 4, reason: 'filament', joined: true }]);
		expect(r.kept).toEqual([1, 2, 5, 6]);
		// the receiving plate's own parts keep their exact positions and turns
		const was = standard.plates[3].items;
		const now = r.plates[3].items;
		for (const w of was) {
			const n = now.find((i) => i.slug === w.slug && i.piece === w.piece && i.copy === w.copy)!;
			expect(n).toEqual(w);
		}
		// the newcomer: inside the bed margin, the printer's normal gap to both neighbours, same filament
		const pb = now.find((i) => i.slug === 'pb')!;
		expect(pb.role).toBe('accent');
		expect(pb.x - pb.w / 2).toBeGreaterThanOrEqual(1 - 0.11);
		expect(pb.y - pb.d / 2).toBeGreaterThanOrEqual(1 - 0.11);
		expect(pb.x + pb.w / 2).toBeLessThanOrEqual(255 + 0.11);
		expect(pb.y + pb.d / 2).toBeLessThanOrEqual(255 + 0.11);
		for (const w of was) expect(boxGap(pb, w)).toBeGreaterThanOrEqual(8 - 0.11);
		// bookkeeping: parts in the build's order, utilisation includes the newcomer, grams add up
		expect(r.plates[3].roles).toEqual(['accent']);
		expect(r.plates[3].utilisation).toBeCloseTo(now.reduce((a, i) => a + i.w * i.d, 0) / usable, 2);
		expect(r.plates[3].estGrams.accent).toBe(150);
		// everything else is as before
		for (const n of [1, 2, 5, 6]) expect(plateOf(r, n)).toEqual(plateOf(standard, n));
	});

	it('never joins a plate that has a single part in the source', () => {
		// the accent pair is recolored primary: the only accent plate left is the single-part "Small"
		let parts = withRole(kit(), 'pc', 'primary');
		parts = withRole(parts, 'pd', 'primary');
		parts = withRole(parts, 'pb', 'accent');
		const r = arrangeFromSource(input(parts), source());
		expect(plateOf(r, 6)!.parts).toEqual(['small']);
		expect(plateOf(r, 7)!.parts).toEqual(['pb']);
		expect(r.moves.find((m) => m.slug === 'pb')).toEqual({
			slug: 'pb',
			from: 3,
			to: 7,
			reason: 'filament'
		});
	});

	it('never joins a plate of another filament or material', () => {
		// every multi-part plate is primary or accent PETG; the mover prints in TPU
		const parts = [
			...withRole(kit(), 't1', 'accent').map((p) =>
				p.slug === 't2' ? { ...p, role: 'accent' } : p
			)
		];
		const r = arrangeFromSource(input(withRole(parts, 'pb', 'soft')), source());
		expect(plateOf(r, 7)!.parts).toEqual(['pb']);
		for (const n of [3, 4, 5]) expect(plateOf(r, n)!.parts).not.toContain('pb');
	});

	it('does not join a plate that prints another number of times', () => {
		const parts = kit().map((p) =>
			p.slug === 'pb'
				? { ...p, role: 'accent', units: 2, footprint: { ...p.footprint, unitsPerPlate: 1 } }
				: p
		);
		const r = arrangeFromSource(input(parts), source());
		// pb needs 2 runs (one unit per plate), the accent pair prints once
		const withUpp = r.plates.find((p) => p.parts.includes('pb'))!;
		expect(withUpp.parts.includes('pc')).toBe(false);
	});

	/**
	 * A kit whose accent plate 4 holds a wall (full width, `wallD` deep, along the bottom edge) and a small
	 * part in the top right corner, at the source's own positions; pa (bigger than the mover) stays on plate 3
	 * and `pb`, recolored accent, is the part that leaves it.
	 */
	const walled = (wallD: number, pbW: number, pbD: number, p = printer()) => {
		const acc = (slug: string, x: number, y: number, w: number, d: number): ArrangedItem => ({
			slug,
			piece: 0,
			copy: 0,
			x,
			y,
			w,
			d,
			rotation: 0,
			role: 'accent'
		});
		const parts = kit().map((k) =>
			k.slug === 'pc'
				? part('pc', 'accent', 254, wallD)
				: k.slug === 'pd'
					? part('pd', 'accent', 30, 30)
					: k.slug === 'pa'
						? part('pa', 'primary', 130, 130)
						: k.slug === 'pb'
							? { ...part('pb', 'primary', pbW, pbD, { rotate: false }), role: 'accent' }
							: k
		);
		const src = source().map((s) =>
			s.number === 4
				? {
						...s,
						items: [acc('pc', 128, 1 + wallD / 2, 254, wallD), acc('pd', 240, 240, 30, 30)]
					}
				: s
		);
		return arrangeFromSource(input(parts, p), src);
	};

	it('does not join when the plate would be more crowded than the cap', () => {
		// a 254 x 100 wall and a 30 x 30 part use 40 % of the bed
		const ok = walled(100, 100, 100); // + 10 000 mm2: 56 %, room above the wall
		expect(plateOf(ok, 4)!.parts).toContain('pb');
		expect(ok.plates[3].utilisation).toBeLessThanOrEqual(JOIN_MAX_UTILISATION + 0.005);
		// the same room, a wider part: the boxes together pass the cap, so it gets a new plate
		const over = walled(100, 150, 100); // + 15 000 mm2: 63 %
		expect((25400 + 900 + 15000) / usable).toBeGreaterThan(JOIN_MAX_UTILISATION);
		expect(plateOf(over, 4)!.parts.sort()).toEqual(['pc', 'pd']);
		expect(plateOf(over, 7)!.parts).toEqual(['pb']);
		// the receiving plate's own parts did not move
		expect(over.plates[3].items.map((i) => [i.slug, i.x, i.y])).toEqual([
			['pc', 128, 51],
			['pd', 240, 240]
		]);
	});

	it('does not join when it does not fit with the normal gap (no step-down to 2 mm)', () => {
		// above a 254 x 80 wall (top edge 81) a 168 mm tall part needs 81 + gap + 168 <= 255: gap 5 yes, gap 8 no
		const tight = walled(80, 90, 168, printer({ spacing: 5 }));
		expect(plateOf(tight, 4)!.parts).toContain('pb');
		const normal = walled(80, 90, 168, printer({ spacing: 8 }));
		expect(plateOf(normal, 4)!.parts.sort()).toEqual(['pc', 'pd']);
		expect(plateOf(normal, 7)!.parts).toEqual(['pb']);
		// both are under the cap: only the gap decides
		expect((254 * 80 + 900 + 90 * 168) / usable).toBeLessThan(JOIN_MAX_UTILISATION);
		// and the joined part keeps the printer's gap to the wall
		const wall = tight.plates[3].items.find((i) => i.slug === 'pc')!;
		const pb = tight.plates[3].items.find((i) => i.slug === 'pb')!;
		expect(boxGap(pb, wall)).toBeGreaterThanOrEqual(5 - 0.11);
	});

	it('prefers the plate with most room left, ties go to the lowest plate number', () => {
		const src: SourcePlate[] = [...source(), { number: 7, name: 'Pair E F', parts: ['pe', 'pf'] }];
		const base = [...kit(), part('pe', 'accent', 60, 60), part('pf', 'accent', 60, 60)];
		const equal = arrangeFromSource(input(withRole(base, 'pb', 'accent')), src);
		expect(plateOf(equal, 4)!.parts).toContain('pb'); // same load: lowest number
		expect(plateOf(equal, 7)!.parts).not.toContain('pb');
		// plate 4 gets heavier: plate 7 has more room
		const heavier = base.map((p) => (p.slug === 'pc' ? part('pc', 'accent', 120, 120) : p));
		const r = arrangeFromSource(input(withRole(heavier, 'pb', 'accent')), src);
		expect(plateOf(r, 7)!.parts).toContain('pb');
		expect(plateOf(r, 4)!.parts).not.toContain('pb');
	});

	it('movers that join one plate and movers that do not are reported where each went', () => {
		let parts = withRole(kit(), 'pb', 'accent');
		parts = [...parts, part('extra', 'accent', 20, 20)];
		const r = arrangeFromSource(input(parts), source());
		expect(r.moves).toContainEqual({
			slug: 'pb',
			from: 3,
			to: 4,
			reason: 'filament',
			joined: true
		});
		expect(r.moves).toContainEqual({ slug: 'extra', from: null, to: 7, reason: 'new' });
	});

	it('planner 2 rules keep the old behavior (a new plate at the end)', () => {
		const r = arrangeFromSource(input(withRole(kit(), 'pb', 'accent')), source(), RULES_V2);
		expect(r.plates.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(plateOf(r, 7)!.parts).toEqual(['pb']);
		expect(r.moves).toEqual([{ slug: 'pb', from: 3, to: 7, reason: 'filament' }]);
	});

	it('a joined plate is deterministic: the same input gives the same plates', () => {
		const run = () => arrangeFromSource(input(withRole(kit(), 'pb', 'accent')), source());
		expect(run()).toEqual(run());
	});
});

describe('G. a plate printed in runs of its own is one plate, laid out for one print', () => {
	// two halves of one object, 150 x 150 each: two of them never share a 256 mm bed
	const rim = (slug: string, role: string, extra: Partial<ArrangePart> = {}) =>
		part(slug, role, 150, 150, { units: 2, ...extra });
	const rimFp = (slug: string, upp?: number) => ({
		slug,
		unitsPerPlate: upp ?? 1,
		pieces: [{ name: 'RIM.step', w: 150, d: 150, h: 40, copies: 1 }]
	});
	const rims = (upp = 1): ArrangePart[] => [
		{ ...rim('rimA', 'accent'), footprint: rimFp('rimA', upp), units: 2 },
		{ ...rim('rimB', 'primary'), footprint: rimFp('rimB', upp), units: 2 }
	];
	const rimSrc = (extra: Partial<SourcePlate> = {}): SourcePlate[] => [
		{ number: 1, name: 'Wheel Rim', runs: 2, perPartRuns: true, parts: ['rimA', 'rimB'], ...extra },
		{ number: 2, name: 'Other', parts: ['o1'] }
	];
	const other = part('o1', 'primary', 50, 50);

	it('is detected by the flag with identical geometry, never by chance or by runs alone', () => {
		const [a, b] = rims();
		expect(isRunPlate({ perPartRuns: true }, [a, b])).toBe(true);
		// no flag: the parts print together, however often the plate is printed
		expect(isRunPlate({}, [a, b])).toBe(false);
		expect(isRunPlate({ perPartRuns: false }, [a, b])).toBe(false);
		expect(isRunPlate({ perPartRuns: true }, [a])).toBe(false);
		expect(isRunPlate({ perPartRuns: true }, [a, part('x', 'primary', 150, 150)])).toBe(false); // different geometry
		// same box, another outline: not the same object
		const hulled = (hull: [number, number][]): ArrangePart => ({
			...a,
			footprint: { ...a.footprint, pieces: [{ ...a.footprint.pieces[0], hull }] }
		});
		const sq: [number, number][] = [
			[-75, -75],
			[75, -75],
			[75, 75],
			[-75, 75]
		];
		const cut: [number, number][] = [
			[-75, -75],
			[75, -75],
			[75, 40],
			[40, 75],
			[-75, 75]
		];
		expect(isRunPlate({ perPartRuns: true }, [hulled(sq), hulled(sq)])).toBe(true);
		expect(isRunPlate({ perPartRuns: true }, [hulled(sq), hulled(cut)])).toBe(false);
		// an outline against a plain box is not the same object either
		expect(isRunPlate({ perPartRuns: true }, [hulled(sq), a])).toBe(false);
		expect(isRunPlate({ perPartRuns: true }, [a, { ...a }])).toBe(true); // both plain boxes
	});

	it('stays one plate, as the source says, with one print on the bed', () => {
		const r = arrangeFromSource(input([...rims(), other]), rimSrc());
		expect(r.plates.map((p) => p.number)).toEqual([1, 2]);
		const p = plateOf(r, 1)! as (typeof r.plates)[number];
		expect(p.parts).toEqual(['rimA', 'rimB']);
		expect(p.name).toBe('Wheel Rim');
		expect(p.perPartRuns).toBe(true);
		expect(p.runs).toBe(2);
		expect(p.items).toHaveLength(1); // ONE print: one object on the bed
		expect(p.items[0].slug).toBe('rimA');
		expect(p.roles).toEqual(['accent']);
		expect(r.kept).toEqual([1, 2]);
		expect(r.moves).toEqual([]);
		expect(r.warnings).toEqual([]);
		// grams per run: one print is one half
		expect(p.estGrams).toEqual({ accent: 50 });
	});

	it('a plate printed more often than its part count implies shows the grams of one run (tires)', () => {
		// one part of 800 g that the source prints twice: the arranger counts one unit, one run
		const tires = part('tires', 'accent', 100, 100, { grams: 800 });
		const r = arrangeFromSource(input([tires, other]), [
			{ number: 1, name: 'Tires', runs: 2, parts: ['tires'] },
			{ number: 2, name: 'Other', parts: ['o1'] }
		]);
		const p = plateOf(r, 1)! as (typeof r.plates)[number];
		expect(p.runs).toBe(2);
		expect(p.estGrams).toEqual({ accent: 400 });
	});

	it('a plate printed several times but not flagged is not a run plate: its parts share the bed', () => {
		// two identical parts that print together, twice: not "print 4 times"; they do not fit one bed here, so one moves
		const r = arrangeFromSource(input([...rims(), other]), rimSrc({ perPartRuns: undefined }));
		expect(r.plates.length).toBeGreaterThan(2);
		expect(r.plates.some((p) => p.perPartRuns)).toBe(false);
		// two small identical parts that fit together keep one plate printed as often as the source says
		const small = [part('sA', 'primary', 40, 40), part('sB', 'primary', 40, 40)];
		const kept = arrangeFromSource(input(small), [
			{ number: 1, name: 'Pair', runs: 2, parts: ['sA', 'sB'] }
		]);
		expect(kept.plates).toHaveLength(1);
		expect(kept.plates[0].perPartRuns).toBeUndefined();
		expect(kept.plates[0].items).toHaveLength(2); // both on the bed in one print
	});

	it('a run plate keeps the source count when it also lists a part that is not in the build', () => {
		const r = arrangeFromSource(
			input([...rims(), other]),
			rimSrc({ runs: 3, parts: ['rimA', 'rimB', 'gone'] })
		);
		const p = plateOf(r, 1)! as (typeof r.plates)[number];
		expect(p.parts).toEqual(['rimA', 'rimB']);
		expect(p.runs).toBe(3); // the source's count, not the 2 the part's units imply
		expect(p.perPartRuns).toBe(true);
	});

	it('is not split for roles that cannot share a printer (separate runs, separate colors)', () => {
		const r = arrangeFromSource(input([...rims(), other], printer({ mmSlots: 1 })), rimSrc());
		expect(r.plates.map((p) => p.number)).toEqual([1, 2]);
		expect(plateOf(r, 1)!.parts).toEqual(['rimA', 'rimB']);
	});

	it('one print holds the units of one run (two halves per print)', () => {
		const r = arrangeFromSource(
			input([
				...rims(2).map((p) => ({
					...p,
					footprint: { ...p.footprint, pieces: [{ ...p.footprint.pieces[0], w: 100, d: 100 }] }
				})),
				other
			]),
			rimSrc({ runs: 1 })
		);
		const p = plateOf(r, 1)! as (typeof r.plates)[number];
		expect(p.parts).toEqual(['rimA', 'rimB']);
		expect(p.items).toHaveLength(2);
		expect(new Set(p.items.map((i) => i.slug))).toEqual(new Set(['rimA']));
		expect(p.runs).toBe(1);
	});

	it('a plate of the same parts printed once (no flag) still splits when they do not fit together', () => {
		const r = arrangeFromSource(input([...rims(), other]), rimSrc({ runs: 1, perPartRuns: false }));
		expect(r.plates.length).toBeGreaterThan(2);
	});

	it('planner 2 rules reproduce the old split', () => {
		const r = arrangeFromSource(input([...rims(), other]), rimSrc(), RULES_V2);
		expect(r.plates.length).toBe(3);
		expect(r.moves.map((m) => m.reason)).toEqual(['bed']);
	});

	it('a run plate never takes a moved part and a mover never joins it', () => {
		const parts = [...rims(), other, part('o2', 'primary', 40, 40)];
		const src = [...rimSrc(), { number: 3, name: 'Pair', parts: ['o2', 'o3'] }];
		const withO3 = [...parts, part('o3', 'primary', 40, 40)];
		const r = arrangeFromSource(input(withRole(withO3, 'o3', 'accent')), src);
		expect(plateOf(r, 1)!.parts).toEqual(['rimA', 'rimB']);
	});
});
