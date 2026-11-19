import { describe, expect, it } from 'vitest';
import { mergeSupplement, normalise } from '../../../../scripts/update-filaments.mjs';
import { colors, resolveSlotOrigin, search, toPublic } from './index.ts';
import { spoolmanDefaults, densityForMaterial } from './spoolman-defaults.ts';
import type { FilamentCatalog } from './types.ts';

const row = (o: Record<string, unknown>) => ({
	id: 'overture_petg_black_1000_175_n',
	manufacturer: 'Overture',
	material: 'PETG',
	name: 'Black',
	diameter: 1.75,
	weight: 1000,
	density: 1.27,
	spool_weight: 220,
	color_hex: '111111',
	...o
});

describe('normalise keeps Spoolman data', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cat: any = normalise(
		[
			row({}),
			row({ id: 'overture_petg_red', name: 'Red', color_hex: 'ff0000' }),
			row({ id: 'overture_petg_odd', name: 'Odd', color_hex: '00ff00', density: 1.3, weight: 750 }),
			row({
				id: undefined,
				name: 'No Id',
				color_hex: '0000ff',
				density: undefined,
				spool_weight: undefined
			})
		],
		{ fetchedAt: 'x' }
	);
	const mat = cat.brands[0].materials[0];
	const by = (n: string) => mat.colors.find((c: { name: string }) => c.name === n);
	it('hoists the most common density and spool weight to the material', () => {
		expect(mat.density).toBe(1.27);
		expect(mat.spoolWeightG).toBe(220);
		expect(by('Black').density).toBeUndefined();
		expect(by('Odd').density).toBe(1.3);
		expect(by('Odd').weightG).toBe(750);
	});
	it('keeps the SpoolmanDB id per color and tolerates rows without one', () => {
		expect(by('Black').sdbId).toBe('overture_petg_black_1000_175_n');
		expect(by('No Id').sdbId).toBeUndefined();
	});
	it('mergeSupplement keeps material-level fields and accepts supplements without them', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const merged: any = mergeSupplement(cat, {
			brands: [
				{
					name: 'Overture',
					sourceUrl: 'u',
					fetchedAt: 'x',
					materials: [{ material: 'petg', colors: [{ name: 'Teal', hex: '#008080' }] }]
				},
				{
					name: 'New',
					sourceUrl: 'u',
					fetchedAt: 'x',
					materials: [{ material: 'TPU 95A', colors: [{ name: 'Teal', hex: '#008080' }] }]
				}
			]
		});
		const o = merged.brands.find((b: { name: string }) => b.name === 'Overture').materials[0];
		expect(o.density).toBe(1.27);
		expect(o.colors.some((c: { name: string }) => c.name === 'Teal')).toBe(true);
		expect(
			merged.brands.find((b: { name: string }) => b.name === 'New').materials[0].density
		).toBeUndefined();
	});
});

const cat: FilamentCatalog = {
	source: 's',
	license: 'MIT',
	fetchedAt: 'x',
	brands: [
		{
			name: 'Overture',
			materials: [
				{
					material: 'PETG',
					density: 1.27,
					spoolWeightG: 220,
					colors: [
						{ name: 'Black', hex: '#111111', sdbId: 'o_petg_black' },
						{ name: 'Odd', hex: '#00ff00', sdbId: 'o_petg_odd', density: 1.3, weightG: 750 }
					]
				},
				{ material: 'TPU 95A', colors: [{ name: 'Black', hex: '#000000', hexSource: 'store' }] }
			]
		},
		{
			name: 'Acme',
			materials: [
				{ material: 'PETG', colors: [{ name: 'Blue', hex: '#0000ff', sdbId: 'a_petg_blue' }] },
				{ material: 'PCTG', colors: [{ name: 'Blue', hex: '#0000fe', sdbId: 'a_pctg_blue' }] }
			]
		}
	]
};

describe('resolveSlotOrigin', () => {
	it('matches the picker name, material and hex', () => {
		const o = resolveSlotOrigin({ name: 'Overture Black', material: 'PETG', hex: '#111111' }, cat);
		expect(o).toMatchObject({
			brand: 'Overture',
			material: 'PETG',
			sdbId: 'o_petg_black',
			density: 1.27,
			spoolWeightG: 220,
			netWeightG: 1000,
			confidence: 'exact'
		});
	});
	it('prefers the slot material when the name fits several', () => {
		expect(
			resolveSlotOrigin({ name: 'Overture Black', material: 'TPU 95A' }, cat)?.sdbId
		).toBeNull();
		expect(resolveSlotOrigin({ name: 'Overture Black', material: 'tpu' }, cat)?.material).toBe(
			'TPU 95A'
		);
	});
	it('uses a color override and net weight', () => {
		expect(resolveSlotOrigin({ name: 'Overture Odd', material: 'PETG' }, cat)).toMatchObject({
			density: 1.3,
			netWeightG: 750
		});
	});
	it('reports name-only confidence when the hex was edited', () => {
		expect(
			resolveSlotOrigin({ name: 'overture  black', material: 'PETG', hex: '#222222' }, cat)
				?.confidence
		).toBe('name');
	});
	it('breaks name ties by hex and refuses real guesses', () => {
		expect(resolveSlotOrigin({ name: 'Acme Blue', hex: '#0000fe' }, cat)?.sdbId).toBe(
			'a_pctg_blue'
		);
		expect(resolveSlotOrigin({ name: 'Acme Blue' }, cat)).toBeNull();
		expect(resolveSlotOrigin({ name: 'Acme Blue', material: 'PETG' }, cat)?.sdbId).toBe(
			'a_petg_blue'
		);
	});
	it('does not match a bare color name, a missing brand, another family or an empty name', () => {
		expect(resolveSlotOrigin({ name: 'Black' }, cat)).toBeNull();
		expect(resolveSlotOrigin({ name: 'Nobody Black' }, cat)).toBeNull();
		expect(resolveSlotOrigin({ name: 'Overture Black', material: 'PLA' }, cat)).toBeNull();
		expect(resolveSlotOrigin({ name: '  ' }, cat)).toBeNull();
	});
	it('works against the bundled catalog', () => {
		expect(resolveSlotOrigin({ name: 'Overture Black', material: 'PETG' })).not.toBeNull();
	});
});

describe('public responses', () => {
	it('toPublic drops the Spoolman-only fields', () => {
		expect(
			toPublic({ name: 'a', hex: '#000000', sdbId: 'x', density: 1, spoolWeightG: 2, weightG: 3 })
		).toEqual({ name: 'a', hex: '#000000', weightG: 3 });
	});
	it('colors() and search() never carry them', () => {
		const text = JSON.stringify([colors('Overture', 'PETG'), search('overture', 50)]);
		expect(text).not.toMatch(/sdbId|spoolWeightG|"density"/);
	});
});

describe('spoolmanDefaults', () => {
	it('uses the catalog entry when it has data', () => {
		const o = resolveSlotOrigin({ name: 'Overture Odd', material: 'PETG' }, cat);
		expect(spoolmanDefaults('PETG', o)).toEqual({
			density: 1.3,
			diameter: 1.75,
			weight: 750,
			spoolWeight: 220,
			source: 'catalog'
		});
	});
	it('falls back to the material table, then generic values', () => {
		expect(spoolmanDefaults('TPU 95A')).toMatchObject({
			density: 1.21,
			weight: 1000,
			spoolWeight: 200,
			source: 'material'
		});
		expect(spoolmanDefaults('PCTG').density).toBe(1.23);
		expect(spoolmanDefaults('Mystery')).toMatchObject({ density: 1.24, source: 'generic' });
		const noData = resolveSlotOrigin({ name: 'Acme Blue', material: 'PETG' }, cat);
		expect(spoolmanDefaults('PETG', noData)).toMatchObject({ density: 1.27, source: 'material' });
	});
	it('densityForMaterial handles family names', () => {
		expect(densityForMaterial('PETG-CF')).toBe(1.27);
		expect(densityForMaterial('Foo')).toBeNull();
	});
});
