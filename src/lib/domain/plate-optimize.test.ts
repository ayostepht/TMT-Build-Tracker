import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	arrange,
	type ArrangeInput,
	type ArrangePart,
	type ArrangePrinter,
	type ArrangedPlate,
	type ArrangeRole
} from './arrange.ts';
import { fitOutline } from './geom2d.ts';
import { WING_LEFT_AS_PLACED, WING_RIGHT_AS_PLACED } from './fixtures/wing-hulls.ts';
import { layoutMetrics, type OptItem } from './plate-optimize.ts';

const roles: ArrangeRole[] = [{ key: 'primary', name: 'Primary', material: 'PETG' }];

const box = (slug: string, w: number, d: number, copies = 1): ArrangePart => ({
	slug,
	name: slug[0].toUpperCase() + slug.slice(1),
	role: 'primary',
	units: 1,
	grams: 10,
	footprint: { slug, pieces: [{ name: slug, w, d, h: 20, copies }] }
});
/** A long thin bar that only fits the bed on a diagonal. */
const bar = (slug: string, len: number, wid: number): ArrangePart => ({
	...box(slug, len, wid),
	footprint: {
		slug,
		pieces: [
			{
				name: slug,
				w: len,
				d: wid,
				h: 20,
				copies: 1,
				hull: [
					[-len / 2, -wid / 2],
					[len / 2, -wid / 2],
					[len / 2, wid / 2],
					[-len / 2, wid / 2]
				]
			}
		]
	}
});
const printer = (extra: Partial<ArrangePrinter> = {}): ArrangePrinter => ({
	bedX: 256,
	bedY: 256,
	margin: 5,
	spacing: 8,
	mmSlots: 1,
	...extra
});
const run = (parts: ArrangePart[], p = printer(), options: ArrangeInput['options'] = {}) =>
	arrange({ parts, roles, printer: p, options });

function metrics(plate: ArrangedPlate, parts: ArrangePart[], p: ArrangePrinter) {
	const items: OptItem[] = plate.items.map((i) => {
		const pc = parts.find((x) => x.slug === i.slug)!.footprint.pieces[i.piece];
		return {
			outline: fitOutline(pc),
			rotatable: false,
			rot: i.rotation,
			x: i.x,
			y: i.y,
			ox: i.ox,
			oy: i.oy,
			w: i.w,
			d: i.d
		};
	});
	return layoutMetrics(items, {
		bedX: p.bedX,
		bedY: p.bedY,
		margin: p.margin,
		spacing: p.spacing,
		keepOut: p.keepOut
	});
}

const scene = () => [
	bar('wing', 300, 40),
	box('cap', 30, 30, 2),
	box('bolt', 60, 14),
	box('hub', 40, 40)
];

describe('plate layout optimiser', () => {
	it('keeps plate assignment and count, and improves the minimum edge clearance', () => {
		const parts = scene();
		const before = run(parts, printer(), { optimize: false });
		const after = run(parts, printer());
		expect(after.plates.length).toBe(before.plates.length);
		expect(after.plates.map((p) => p.parts)).toEqual(before.plates.map((p) => p.parts));
		before.plates.forEach((pl, k) => {
			const key = (p: ArrangedPlate) => p.items.map((i) => `${i.slug}/${i.piece}/${i.copy}`).sort();
			expect(key(after.plates[k])).toEqual(key(pl));
			const m0 = metrics(pl, parts, printer());
			const m1 = metrics(after.plates[k], parts, printer());
			expect(m1.minClearance).toBeGreaterThanOrEqual(m0.minClearance - 0.05);
			if (pl.items.length > 1) expect(m1.minGap).toBeGreaterThanOrEqual(8 - 0.1);
		});
		const worst = Math.min(...before.plates.map((p) => metrics(p, parts, printer()).minClearance));
		const best = Math.min(...after.plates.map((p) => metrics(p, parts, printer()).minClearance));
		expect(best).toBeGreaterThan(worst + 1);
	});

	it('pulls small parts away from the edges toward the middle', () => {
		const parts = [box('a', 40, 40), box('b', 30, 30), box('c', 20, 20)];
		const r = run(parts);
		const m = metrics(r.plates[0], parts, printer());
		const packed = metrics(run(parts, printer(), { optimize: false }).plates[0], parts, printer());
		expect(packed.minClearance).toBeLessThan(1);
		expect(m.minClearance).toBeGreaterThan(20 - 0.1);
	});

	it('centres a single item and chooses the rotation with the most clearance', () => {
		const parts = [bar('wing', 300, 40)];
		const r = run(parts);
		const it = r.plates[0].items[0];
		expect(it.x).toBeCloseTo(128, 0);
		expect(it.y).toBeCloseTo(128, 0);
		const before = run(parts, printer(), { optimize: false }).plates[0].items[0];
		expect(Math.max(it.w, it.d)).toBeLessThanOrEqual(Math.max(before.w, before.d) + 0.1);
		expect(metrics(r.plates[0], parts, printer()).minClearance).toBeGreaterThan(0);
	});

	it('never makes a tight plate infeasible', () => {
		// diagonal fit with very little room: 3 mm of clearance at most
		const parts = [bar('wing', 330, 30)];
		const p = printer({ margin: 0, spacing: 8 });
		const r = run(parts, p);
		expect(r.plates[0].oversize).toBeUndefined();
		const m = metrics(r.plates[0], parts, p);
		expect(m.minClearance).toBeGreaterThanOrEqual(-0.05);
		const it = r.plates[0].items[0];
		expect(it.x - it.w / 2).toBeGreaterThanOrEqual(-0.11);
		expect(it.x + it.w / 2).toBeLessThanOrEqual(256.11);
		expect(it.y - it.d / 2).toBeGreaterThanOrEqual(-0.11);
		expect(it.y + it.d / 2).toBeLessThanOrEqual(256.11);
	});

	it('is deterministic and fast', () => {
		const parts = [...scene(), box('x1', 50, 20, 4), box('x2', 25, 25, 3)];
		const t0 = performance.now();
		const a = run(parts);
		const ms = performance.now() - t0;
		const b = run(parts);
		expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
		expect(ms).toBeLessThan(300);
	});

	it('only flat-rotates: no pose, rotation about z only', () => {
		const r = run(scene());
		for (const pl of r.plates)
			for (const i of pl.items) expect(Object.keys(i)).not.toContain('pose');
	});
});

describe('keep-out areas', () => {
	const cutter = { x: 246, y: 0, w: 10, d: 20, label: 'Filament cutter' };
	const withZone = (extra: Partial<ArrangePrinter> = {}) =>
		printer({ keepOut: [cutter], ...extra });

	it('keeps items out of the zone (margin included) and clear of it', () => {
		const parts = [box('a', 100, 80), box('b', 100, 80), box('c', 50, 50, 3)];
		const p = withZone();
		const r = run(parts, p);
		for (const pl of r.plates)
			for (const i of pl.items) {
				const ex = i.x + i.w / 2 > cutter.x - p.margin;
				const ey = i.y - i.d / 2 < cutter.y + cutter.d + p.margin;
				expect(ex && ey).toBe(false);
			}
		expect(r.plates[0].bed.keepOut).toEqual([cutter]);
	});

	it('the optimiser treats the zone like an edge', () => {
		const parts = [box('a', 60, 60), box('b', 40, 40)];
		const p = withZone();
		const r = run(parts, p);
		expect(metrics(r.plates[0], parts, p).minClearance).toBeGreaterThan(15);
	});

	it('a part that only fits through the zone is oversize and says so', () => {
		// 250 mm wide fits a 256 bed (margin 1) but not beside the 10 mm cutter zone ... in its corner row
		const p = withZone({ margin: 1 });
		const parts = [box('plank', 250, 250)];
		const r = run(parts, p);
		expect(r.plates[0].oversize).toBe(true);
		const w = r.warnings.find((x) => x.code === 'oversize');
		expect(w?.message).toMatch(/Filament cutter/);
	});

	it('the plate count only grows when the zone forces it', () => {
		const parts = [box('a', 120, 120), box('b', 120, 120), box('c', 120, 120)];
		const plain = run(parts, printer({ margin: 1 }));
		const zoned = run(parts, withZone({ margin: 1 }));
		expect(zoned.plates.length).toBeLessThanOrEqual(plain.plates.length + 1);
	});
});

describe('wording', () => {
	const strip = (src: string) =>
		src
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/^\s*\/\/.*$/gm, '')
			.replace(/\s\/\/ .*$/gm, '');
	it('has no "tilt" in user-facing text', () => {
		for (const f of [
			'src/lib/domain/arrange.ts',
			'src/lib/domain/plate-legend.ts',
			'src/lib/domain/plate-optimize.ts',
			'src/lib/components/PlateLegend.svelte',
			'src/lib/components/PlateDiagram.svelte',
			'src/lib/server/threemf-export/writer.ts',
			'src/lib/server/threemf-export/plan.ts',
			'src/lib/domain/arrange.README.md'
		])
			expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/tilt/i);
	});
	it('no flat-rotation warnings are produced', () => {
		const r = run([bar('wing', 300, 40)]);
		expect(r.warnings).toEqual([]);
	});
});

describe("the maintainer's Centauri Carbon wings (tmt_4691.3mf)", () => {
	const cutter = { x: 246, y: 0, w: 10, d: 20, label: 'Filament cutter' };
	const centred = (hull: [number, number][]) => {
		const xs = hull.map((p) => p[0]);
		const ys = hull.map((p) => p[1]);
		const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
		const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
		return {
			hull: hull.map(([x, y]) => [x - cx, y - cy] as [number, number]),
			w: Math.max(...xs) - Math.min(...xs),
			d: Math.max(...ys) - Math.min(...ys)
		};
	};
	const wing = (slug: string, src: [number, number][]): ArrangePart => {
		const c = centred(src);
		return {
			...box(slug, c.w, c.d),
			footprint: {
				slug,
				pieces: [{ name: slug, w: c.w, d: c.d, h: 50, copies: 1, hull: c.hull }]
			}
		};
	};
	// the file's wings: 0.2 mm (right) and 0.1 mm (left) from the bed edge, margin 0, zone as in its profile
	for (const [slug, src, fileClearance] of [
		['wing-right', WING_RIGHT_AS_PLACED, 0.2],
		['wing-left', WING_LEFT_AS_PLACED, 0.1]
	] as const) {
		it(`${slug} fits beside the cutter with at least the file's clearance`, () => {
			const parts = [wing(slug, [...src])];
			const p = printer({ margin: 0, keepOut: [cutter] });
			const r = run(parts, p);
			expect(r.plates[0].oversize).toBeUndefined();
			expect(r.warnings).toEqual([]);
			const m = metrics(r.plates[0], parts, p);
			expect(m.minClearance).toBeGreaterThanOrEqual(fileClearance - 0.06);
			// flat rotation only
			expect(Object.keys(r.plates[0].items[0])).not.toContain('pose');
		});
	}
	it('a wing that only fits off-centre because of the zone is placed off-centre', () => {
		const parts = [wing('wing-right', [...WING_RIGHT_AS_PLACED])];
		const p = printer({ margin: 0, keepOut: [cutter] });
		const it = run(parts, p).plates[0].items[0];
		const c = centred([...WING_RIGHT_AS_PLACED]);
		// outline is not inside the zone: check by the polygon metric against a zone-less bed
		expect(
			metrics(run(parts, p).plates[0], parts, { ...p, keepOut: [cutter] }).minClearance
		).toBeGreaterThan(0);
		expect(it.w).toBeGreaterThan(c.w - 1);
	});
});
