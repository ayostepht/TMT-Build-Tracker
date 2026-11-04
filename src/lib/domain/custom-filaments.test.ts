import { describe, expect, it } from 'vitest';
import { materialFamily } from '../filament-catalog.ts';
import {
	customBrands,
	customFamily,
	customKey,
	customMaterialLabel,
	customToTuple,
	type CustomFilament
} from './custom-filaments.ts';
import { exclusionReason, nearest, resolvePalette, type CatalogSwatches } from './palettes.ts';

const mk = (o: Partial<CustomFilament>): CustomFilament => ({
	id: 'x',
	organizationId: 'o',
	brand: 'TestBrand',
	material: 'PETG',
	colorName: 'Team Red',
	hex: '#d31f26',
	finish: null,
	hardness: null,
	url: null,
	notes: '',
	createdAt: 0,
	updatedAt: null,
	...o
});

describe('material family of custom materials', () => {
	it.each([
		['PETG HF', 'petg'],
		['petg-cf', 'petg'],
		['Hyper PETG', 'petg'],
		['PCTG', 'petg'],
		['TPU 95A', 'tpu'],
		['TPU', 'tpu'],
		['Flexible TPU 90A', 'tpu'],
		['PLA+', 'other'],
		['ABS', 'other'],
		['ASA', 'other']
	])('%s is %s', (m, fam) => expect(materialFamily(m)).toBe(fam));

	it('classifies a custom filament and labels TPU hardness', () => {
		expect(customFamily(mk({ material: 'PETG HF' }))).toBe('petg');
		expect(customMaterialLabel(mk({ material: 'TPU', hardness: '90A' }))).toBe('TPU 90A');
		expect(customMaterialLabel(mk({ material: 'TPU 95A', hardness: '95A' }))).toBe('TPU 95A');
		expect(customMaterialLabel(mk({ material: 'PETG', hardness: '95A' }))).toBe('PETG');
	});
});

describe('helpers', () => {
	it('duplicate key ignores case and spacing', () => {
		expect(customKey({ brand: ' TestBrand', material: 'petg  hf', colorName: 'Red' })).toBe(
			customKey({ brand: 'testbrand', material: 'PETG HF', colorName: 'red' })
		);
	});
	it('lists brands once, sorted', () => {
		expect(customBrands([{ brand: 'b' }, { brand: 'A' }, { brand: 'B' }])).toEqual(['A', 'b']);
	});
});

describe('palette matcher with custom filaments', () => {
	it('a custom filament competes like a catalog one (brand preference honored)', () => {
		const items = [
			...[mk({ hex: '#d31f26' })].map(customToTuple),
			['Overture', 'Red', '#c0281e', 'PETG'] as const
		].map((t) => [...t]) as CatalogSwatches['petg'];
		const m = nearest('#d31f26', items, { brand: 'TestBrand' });
		expect(m?.brand).toBe('TestBrand');
		expect(m?.name).toBe('TestBrand Team Red');
	});

	it('applies the exclusion rules to finish, material and hardness', () => {
		expect(exclusionReason(customToTuple(mk({})))).toBe('');
		expect(exclusionReason(customToTuple(mk({ finish: 'silk' })))).not.toBe('');
		expect(exclusionReason(customToTuple(mk({ finish: 'translucent' })))).not.toBe('');
		expect(exclusionReason(customToTuple(mk({ finish: 'sparkle' })))).not.toBe('');
		expect(exclusionReason(customToTuple(mk({ finish: 'glossy' })))).toBe('');
		expect(exclusionReason(customToTuple(mk({ finish: 'matte' })))).not.toBe('');
		expect(exclusionReason(customToTuple(mk({ finish: 'matte' })), true)).toBe('');
		expect(exclusionReason(customToTuple(mk({ material: 'PETG-CF' })))).not.toBe('');
		expect(exclusionReason(customToTuple(mk({ material: 'PETG HF' })))).toBe('');
		expect(exclusionReason(customToTuple(mk({ material: 'TPU', hardness: '90A' })))).not.toBe('');
		expect(exclusionReason(customToTuple(mk({ material: 'TPU', hardness: '95A' })))).toBe('');
		expect(exclusionReason(customToTuple(mk({ material: 'TPU 95A' })))).toBe('');
	});

	it('an excluded custom filament is never picked while a standard one exists', () => {
		const catalog: CatalogSwatches = {
			petg: [
				customToTuple(mk({ hex: '#d31f26', finish: 'silk' })),
				['Overture', 'Red', '#c0281e', 'PETG']
			],
			tpu: [
				customToTuple(mk({ material: 'TPU', hardness: '85A', hex: '#111111', colorName: 'Black' })),
				['Overture', 'Black', '#1c1c20', 'TPU-95A']
			]
		};
		const r = resolvePalette(
			{ primary: '#d31f26', accent: '#ffffff', soft: '#111111', tire: '#000000' },
			catalog
		);
		expect(r.primary?.brand).toBe('Overture');
		expect(r.soft?.material).toBe('TPU-95A');
	});
});
