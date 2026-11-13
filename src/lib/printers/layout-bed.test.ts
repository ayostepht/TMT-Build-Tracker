import { describe, expect, it } from 'vitest';
import { layoutBed, layoutBedLabel } from './layout-bed.ts';

describe('layoutBed', () => {
	it('maps the built-in MakeGood layouts to a bed preset', () => {
		const x = layoutBed('xpa')!;
		expect([x.bedX, x.bedY, x.mmSlots]).toEqual([256, 256, 4]);
		expect(layoutBedLabel(x)).toBe('Bambu X1 / P1 / A1 (256 × 256 mm)');
		const h = layoutBed('h2d')!;
		expect([h.bedX, h.bedY]).toEqual([350, 320]);
	});
	it('has none for arranged, upload, unknown or missing layouts', () => {
		for (const k of ['arranged', 'upload', 'custom', '', null, undefined])
			expect(layoutBed(k)).toBeNull();
	});
});
