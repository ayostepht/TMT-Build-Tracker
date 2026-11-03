import { describe, expect, it } from 'vitest';
import { isTap, resolvePick, TAP_MS, TAP_SLOP } from './picking.ts';

describe('isTap', () => {
	const down = { x: 100, y: 100, t: 1000 };
	it('a short, still press is a tap', () => {
		expect(isTap(down, { x: 102, y: 101, t: 1100 })).toBe(true);
		expect(isTap(down, { x: 100 + TAP_SLOP, y: 100, t: 1000 + TAP_MS })).toBe(true);
	});
	it('moving further than the slop is a drag', () => {
		expect(isTap(down, { x: 100 + TAP_SLOP + 1, y: 100, t: 1100 })).toBe(false);
		expect(isTap(down, { x: 100, y: 130, t: 1100 })).toBe(false);
	});
	it('a long press is not a tap', () => {
		expect(isTap(down, { x: 100, y: 100, t: 1000 + TAP_MS + 1 })).toBe(false);
	});
	it('an up without a down is ignored', () => {
		expect(isTap(null, { x: 1, y: 1, t: 1 })).toBe(false);
	});
});

describe('resolvePick', () => {
	it('hits the nearest part, even one that is dimmed', () => {
		expect(resolvePick([{ slug: 'wing-left' }, { slug: 'seat-center' }])).toEqual({
			kind: 'hit',
			slug: 'wing-left'
		});
	});
	it('skips hits that belong to no part', () => {
		expect(resolvePick([{}, { slug: null }, { slug: 'tires' }])).toEqual({
			kind: 'hit',
			slug: 'tires'
		});
	});
	it('no hit is a miss (the page deselects)', () => {
		expect(resolvePick([])).toEqual({ kind: 'miss' });
		expect(resolvePick([{}])).toEqual({ kind: 'miss' });
	});
});
