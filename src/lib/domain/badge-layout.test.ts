import { describe, expect, it } from 'vitest';
import { inRings, layoutBadges, type BadgeItem } from './badge-layout.ts';
import type { Pt } from './geom2d.ts';

const box = (cx: number, cy: number, w: number, d = w): Pt[] => [
	[cx - w / 2, cy - d / 2],
	[cx + w / 2, cy - d / 2],
	[cx + w / 2, cy + d / 2],
	[cx - w / 2, cy + d / 2]
];
const item = (id: number, slug: string, cx: number, cy: number, w: number): BadgeItem => ({
	id,
	slug,
	pole: [cx, cy],
	inr: w / 2,
	rings: [box(cx, cy, w)]
});
const opts = { rMin: 5, rMax: 8.5, bounds: { x0: 0, y0: 0, x1: 256, y1: 256 } };

describe('layoutBadges', () => {
	it('keeps a badge inside a big part and scales it, capped at rMax', () => {
		const [b] = layoutBadges([item(0, 'a', 100, 100, 60), item(1, 'b', 30, 30, 24)], opts).filter(
			(p) => p.slug === 'a'
		);
		expect(b.outside).toBe(false);
		expect(b.r).toBe(8.5);
		const [m] = layoutBadges([item(0, 'b', 30, 30, 24)], opts);
		expect(m.outside).toBe(false);
		expect(m.r).toBeCloseTo(12 * 0.5, 5);
		expect(m.r).toBeGreaterThanOrEqual(5);
	});

	it('puts a badge outside, with a leader, when the part is too small', () => {
		const [b] = layoutBadges([item(0, 'pin', 100, 100, 6)], opts);
		expect(b.outside).toBe(true);
		expect(b.r).toBe(5);
		expect(b.leaders).toHaveLength(1);
		expect(b.leaders[0][1]).toEqual([100, 100]);
		expect(inRings([b.x, b.y], [box(100, 100, 6)])).toBe(false);
	});

	it('groups close copies under one badge and leaves far ones alone', () => {
		const pins = [0, 1, 2, 3].map((i) => item(i, 'pin', 100 + i * 9, 100, 5));
		const far = item(4, 'pin', 220, 220, 5);
		const res = layoutBadges([...pins, far], opts);
		expect(res).toHaveLength(2);
		expect(res.find((b) => b.ids.length === 4)?.leaders).toHaveLength(4);
		expect(res.find((b) => b.ids.length === 1)?.ids).toEqual([4]);
	});

	it('never groups different parts', () => {
		const res = layoutBadges([item(0, 'a', 100, 100, 5), item(1, 'b', 108, 100, 5)], opts);
		expect(res).toHaveLength(2);
	});

	it('never overlaps badges, parts or the bounds on a crowded plate', () => {
		const items: BadgeItem[] = [];
		let id = 0;
		// a grid of tiny parts of three kinds, plus two big ones
		for (let gx = 0; gx < 8; gx++)
			for (let gy = 0; gy < 4; gy++)
				items.push(item(id++, ['p', 'q', 'r'][(gx + gy) % 3], 20 + gx * 12, 20 + gy * 12, 7));
		items.push(item(id++, 'big', 160, 60, 70));
		items.push(item(id, 'big2', 160, 170, 60));
		const res = layoutBadges(items, opts);
		for (let i = 0; i < res.length; i++) {
			const a = res[i];
			expect(a.x - a.r).toBeGreaterThanOrEqual(0);
			expect(a.x + a.r).toBeLessThanOrEqual(256);
			expect(a.y - a.r).toBeGreaterThanOrEqual(0);
			expect(a.y + a.r).toBeLessThanOrEqual(256);
			for (let j = i + 1; j < res.length; j++) {
				const b = res[j];
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
			}
			if (a.outside) for (const it of items) expect(inRings([a.x, a.y], it.rings)).toBe(false);
		}
		// every item is covered exactly once
		expect(res.flatMap((b) => b.ids).sort((x, y) => x - y)).toEqual(items.map((i) => i.id));
		expect(res.some((b) => b.outside)).toBe(true);
	});

	it('respects the group size cap', () => {
		const pins = Array.from({ length: 10 }, (_, i) => item(i, 'pin', 100 + i * 4, 100, 3));
		const res = layoutBadges(pins, { ...opts, maxGroup: 4 });
		expect(Math.max(...res.map((b) => b.ids.length))).toBeLessThanOrEqual(4);
		expect(res.reduce((n, b) => n + b.ids.length, 0)).toBe(10);
	});
});
