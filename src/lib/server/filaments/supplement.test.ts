import { describe, expect, it } from 'vitest';
import { swatches, swatchesOf } from './index.ts';
import type { FilamentCatalog, FilamentSupplement } from './types.ts';
import { mergeSupplement, normalise } from '../../../../scripts/update-filaments.mjs';
import {
	buildSupplementBrand,
	classifyProduct,
	convertPages,
	parseProductPage,
	sampleImageHex,
	fetchProducts,
	mergeBrands
} from '../../../../scripts/fetch-vendor-filaments.mjs';
import { pickerSwatches } from '../../domain/swatch-picker.ts';
import { materialFamily } from '../../filament-catalog.ts';
import supplementFile from './supplement.json' with { type: 'json' };

const row = (o: Record<string, unknown>) => ({
	manufacturer: 'Overture',
	material: 'PETG',
	name: 'Black',
	diameter: 1.75,
	weight: 1000,
	color_hex: '111111',
	...o
});

const product = (title: string, colors: string[], extra: Record<string, unknown> = {}) => ({
	title,
	handle: title.toLowerCase().replace(/\W+/g, '-'),
	options: [{ name: 'Color' }],
	variants: colors.map((c) => ({ option1: c })),
	images: [{ src: 'https://cdn.example/x.png' }],
	...extra
});

const fetchedAt = '2026-11-09T00:00:00.000Z';

describe('mergeSupplement', () => {
	const sup: FilamentSupplement = {
		brands: [
			{
				name: 'Overture',
				sourceUrl: 'https://overture3d.com',
				fetchedAt,
				materials: [
					{
						material: 'petg',
						colors: [
							{ name: 'black', hex: '#222222', hexSource: 'store' },
							{ name: 'HS Black', hex: '#101010', hexSource: 'store' }
						]
					}
				]
			},
			{
				name: 'Schoolhouse Spools',
				sourceUrl: 'https://schoolhousespools.com',
				fetchedAt,
				materials: [
					{ material: 'PETG', colors: [{ name: 'Brick', hex: '#aa3322', hexSource: 'image' }] }
				]
			}
		]
	};

	it('survives a catalog regeneration: SpoolmanDB rebuilt, supplement colors still there', () => {
		const regenerated = normalise([row({}), row({ name: 'Red', color_hex: 'ff0000' })], {
			fetchedAt
		});
		const merged = mergeSupplement(regenerated, sup) as FilamentCatalog;
		const overture = merged.brands.find((b) => b.name === 'Overture')!;
		const petg = overture.materials.find((m) => m.material === 'PETG')!;
		expect(petg.colors.map((c) => c.name)).toEqual(['Black', 'HS Black', 'Red']);
		expect(merged.brands.map((b) => b.name)).toEqual(['Overture', 'Schoolhouse Spools']);
		expect(merged.source).toContain('SpoolmanDB');
		expect(merged.source).toContain('Schoolhouse Spools (https://schoolhousespools.com)');
		expect(merged.source).toContain('Overture (https://overture3d.com)');
	});
	it('lets SpoolmanDB win an exact duplicate (case-insensitive) and keeps the estimate flag', () => {
		const merged = mergeSupplement(normalise([row({})], { fetchedAt }), sup);
		const petg = merged.brands[0].materials[0];
		expect(petg.colors.find((c) => c.name === 'Black')!.hex).toBe('#111111');
		expect(merged.brands[1].materials[0].colors[0].hexSource).toBe('image');
	});
	it('does not mutate its inputs and ignores an empty supplement', () => {
		const base = normalise([row({})], { fetchedAt });
		const copy = JSON.stringify(base);
		mergeSupplement(base, sup);
		expect(JSON.stringify(base)).toBe(copy);
		expect(mergeSupplement(base, { brands: [] })).toEqual(base);
		expect(mergeSupplement(base, null)).toEqual(base);
	});
	it('drops supplement colors without a valid hex', () => {
		const bad: FilamentSupplement = {
			brands: [
				{
					name: 'X',
					sourceUrl: 'u',
					fetchedAt,
					materials: [{ material: 'PETG', colors: [{ name: 'A', hex: 'nope' }] }]
				}
			]
		};
		expect(
			mergeSupplement(normalise([], { fetchedAt }), bad).brands[0].materials[0].colors
		).toEqual([]);
	});
	it('the committed supplement merges cleanly', () => {
		const merged = mergeSupplement(
			normalise([row({})], { fetchedAt }),
			supplementFile as FilamentSupplement
		);
		expect(merged.brands.length).toBeGreaterThanOrEqual(1);
	});
});

describe('classifyProduct', () => {
	it('keeps high-speed lines as plain PETG / TPU with an HS label', () => {
		expect(
			classifyProduct(product('High Speed PETG Filament 1.75mm', ['Black']), 'Overture')
		).toMatchObject({
			material: 'PETG',
			highSpeed: true,
			label: 'HS'
		});
		expect(classifyProduct(product('Overture Rapid PETG', []), 'Overture')).toMatchObject({
			material: 'PETG',
			label: 'HS'
		});
	});
	it('reads TPU hardness and refuses to guess it', () => {
		expect(classifyProduct(product('High Speed TPU 95A', []), 'Overture')).toMatchObject({
			material: 'TPU',
			label: 'HS 95A'
		});
		expect(classifyProduct(product('TPU Filament', []), 'Overture')).toHaveProperty('skip');
	});
	it('skips non-filament and unused materials', () => {
		expect(classifyProduct(product('PETG Gift Card', []), 'X')).toHaveProperty('skip');
		expect(classifyProduct(product('Filament Dryer for PLA', []), 'X')).toHaveProperty('skip');
		expect(classifyProduct(product('ABS Filament', []), 'X')).toHaveProperty('skip');
		expect(classifyProduct(product('High Speed PLA+', []), 'X')).toHaveProperty('skip');
	});
});

describe('buildSupplementBrand', () => {
	const products = [
		product('High Speed PETG Filament', ['Black #101010', 'Sky Blue', 'Transparent #eeeeee']),
		product('High Speed TPU 95A', ['Red #cc0000']),
		product('Silk PLA', ['Gold #d4af37']),
		product('Matte PETG', ['Olive #556b2f']),
		product('Dryer', ['White'])
	];
	it('takes store hexes, uses overrides for the rest and reports what it could not place', () => {
		const skipped: { product: string; reason: string }[] = [];
		const b = buildSupplementBrand('overture', products, {
			fetchedAt,
			skipped,
			hexOverrides: { 'high-speed-petg-filament|Sky Blue': { hex: '5aa0e0', hexSource: 'image' } }
		});
		const petg = b.materials.find((m) => m.material === 'PETG')!.colors;
		expect(petg.map((c) => [c.name, c.hex, c.hexSource])).toEqual([
			['HS Black', '#101010', 'store'],
			['HS Sky Blue', '#5aa0e0', 'image'],
			['HS Transparent', '#eeeeee', 'store'],
			['Matte PETG Olive', '#556b2f', 'store']
		]);
		expect(petg.find((c) => c.name === 'HS Transparent')!.translucent).toBe(true);
		expect(b.materials.map((m) => m.material)).toEqual(['PETG', 'TPU']);
		expect(petg.find((c) => c.name === 'Matte PETG Olive')).toMatchObject({ finish: 'matte' });
		expect(skipped.map((s) => s.product)).toEqual(['Silk PLA', 'Dryer']);

		const noOverride: { product: string; color?: string; reason: string }[] = [];
		buildSupplementBrand('overture', products, { fetchedAt, skipped: noOverride });
		expect(noOverride.find((s) => s.color === 'Sky Blue')!.reason).toMatch(/no hex/);
	});
	it('mergeBrands replaces a store and keeps the others', () => {
		const a = buildSupplementBrand('overture', products.slice(0, 1), { fetchedAt });
		const s = buildSupplementBrand('schoolhouse', products.slice(0, 1), { fetchedAt });
		const first = mergeBrands({ brands: [] }, [a, s]);
		const second = mergeBrands(first, [{ ...a, fetchedAt: 'later' }]);
		expect(second.brands.map((x: { name: string }) => x.name)).toEqual([
			'Overture',
			'Schoolhouse Spools'
		]);
		expect(second.brands[0].fetchedAt).toBe('later');
	});
});

describe('fetchProducts', () => {
	const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
		status,
		ok: status < 300,
		headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
		json: async () => body
	});
	it('backs off by Retry-After on 429 and sends a descriptive user agent', async () => {
		const waits: number[] = [];
		const seen: unknown[] = [];
		const queue = [
			res(429, null, { 'retry-after': '7' }),
			res(200, { products: [{ title: 'a' }] })
		];
		const out = await fetchProducts('https://s.example', {
			wait: async (ms: number) => void waits.push(ms),
			fetchFn: async (url: string, init?: unknown) => {
				seen.push([url, init]);
				return queue.shift()!;
			}
		});
		expect(out).toEqual([{ title: 'a' }]);
		expect(waits).toEqual([7000]);
		expect(String(seen[0])).toContain('/products.json?limit=250&page=1');
		expect(JSON.stringify(seen[0])).toContain('TMT-Build-Tracker');
	});
	it('gives up after the retry budget', async () => {
		await expect(
			fetchProducts('https://s.example', {
				maxRetries: 2,
				wait: async () => {},
				fetchFn: async () => res(429, null)
			})
		).rejects.toThrow(/rate limited/);
	});
});

describe('merged catalog in the swatch picker', () => {
	const sup: FilamentSupplement = {
		brands: [
			buildSupplementBrand(
				'overture',
				[
					product('High Speed PETG Filament', ['Black #101010', 'Fire Red #d02020']),
					product('High Speed TPU 95A', ['Lime #88cc22']),
					product('High Speed TPU 85A', ['Pink #ee88aa'])
				],
				{ fetchedAt }
			),
			buildSupplementBrand('schoolhouse', [product('PETG Filament', ['Schoolbus #f5b800'])], {
				fetchedAt
			})
		]
	};
	const cat = mergeSupplement(normalise([], { fetchedAt }), sup) as FilamentCatalog;
	const listed = (family: 'petg' | 'tpu') =>
		pickerSwatches(swatchesOf(cat, family), { showAll: true });
	const all = (r: ReturnType<typeof listed>) => [...r.neutrals, ...r.colorful];

	it('offers Overture high-speed PETG and Schoolhouse Spools for the PETG slots', () => {
		expect(materialFamily('PETG')).toBe('petg');
		const r = pickerSwatches(swatchesOf(cat, 'petg'));
		const names = all(r).map((e) => `${e.t[0]}|${e.t[1]}`);
		expect(names).toEqual(
			expect.arrayContaining([
				'Overture|HS Black',
				'Overture|HS Fire Red',
				'Schoolhouse Spools|Schoolbus'
			])
		);
		expect(r.hidden).toBe(0);
	});
	it('offers a new Overture 95A TPU for the Primary and Accent TPU slots, but not 85A', () => {
		const r = pickerSwatches(swatchesOf(cat, 'tpu'));
		expect(all(r).map((e) => e.t[1])).toEqual(['HS 95A Lime']);
		expect(r.hidden).toBe(1);
		expect(all(listed('tpu')).find((e) => e.t[1] === 'HS 85A Pink')!.reason).toMatch(/85A/);
	});
});

describe('product pages', () => {
	const overturePage = `
		<script>
		options: [ { name: "Color", values: [
			{ name: "Black", colorHex: "#000000", swatchImageUrl: "https://x/a.png" },
			{ name: "Digital Blue", colorHex: "#0378D0", swatchImageUrl: "https://x/b.png" } ] } ]
		variants: [{"id":"1","image":{"src":"\\/\\/x\\/black.jpg"},"sku":null,"title":"Black \\/ 1.75mm \\/ 1 kg"},{"id":"2","sku":null,"title":"Digital Blue \\/ 1.75mm \\/ 1 kg"},{"id":"3","sku":null,"title":"Clear"}]
		</script>`;
	const shopPage = `{"id":"1","image":{"src":"\\/\\/s.example\\/cdn\\/Spool_-_Red.jpg?v=1"},"sku":null,"title":"Red"},{"id":"2","image":{"src":"\\/\\/s.example\\/cdn\\/Spool_-_Red.jpg?v=1"},"sku":null,"title":"Black"},{"id":"3","sku":null,"title":"Teal"}`;

	it('reads store hexes and variant photos, and does not mix up variants without a photo', () => {
		const c = parseProductPage(overturePage);
		expect(c.find((x) => x.name === 'Digital Blue')).toMatchObject({ hex: '#0378d0' });
		expect(c.find((x) => x.name === 'Black')).toMatchObject({
			hex: '#000000',
			image: 'https://x/black.jpg'
		});
		expect(c.find((x) => x.name === 'Clear')!.hex).toBeUndefined();
	});
	it('drops a photo several colors share unless its file name mentions the color', () => {
		const c = parseProductPage(shopPage);
		expect(c.find((x) => x.name === 'Red')!.image).toContain('Spool_-_Red.jpg');
		expect(c.find((x) => x.name === 'Black')!.image).toBeUndefined();
		expect(c.find((x) => x.name === 'Teal')!.image).toBeUndefined();
	});
	it('marks store hexes "store", overrides by their source, and lists colors without a hex', () => {
		const skipped: { product: string; color?: string; reason: string }[] = [];
		const mats = convertPages(
			[
				{
					cfg: { handle: 'hs-tpu', material: 'TPU', label: 'High Speed 95A' },
					colors: [
						{ name: 'Black', hex: '#000000' },
						{ name: 'Matte Gray', hex: '#cccccc' },
						{ name: 'Luminous Pink', hex: '#dcdce4' },
						{ name: 'Clear' }
					]
				},
				{ cfg: { handle: 'p', material: 'PETG' }, colors: [{ name: 'Teal', image: 'u' }] }
			],
			{ skipped, hexOverrides: { 'p|Teal': { hex: '038a89', hexSource: 'image' } } }
		);
		const tpu = mats.find((m) => m.material === 'TPU')!.colors;
		expect(tpu.map((c) => c.name)).toEqual([
			'High Speed 95A Black',
			'High Speed 95A Luminous Pink',
			'High Speed 95A Matte Gray'
		]);
		expect(tpu[0].hexSource).toBe('store');
		expect(tpu[1].glow).toBe(true);
		expect(tpu[2].finish).toBe('matte');
		expect(mats.find((m) => m.material === 'PETG')!.colors[0]).toMatchObject({
			name: 'Teal',
			hex: '#038a89',
			hexSource: 'image'
		});
		expect(skipped.map((s) => s.color)).toEqual(['Clear']);
	});
	it('estimates a colored filament from its saturated pixels and a neutral one from the lighter half', async () => {
		const img = (rgb: number[][]) => ({
			resize: () => ({
				removeAlpha: () => ({
					raw: () => ({
						toBuffer: async () => ({
							data: Buffer.from(rgb.flat()),
							info: { width: 2, height: 2 }
						})
					})
				})
			})
		});
		const sharp = (b: number[][]) => img(b);
		const box: [number, number, number, number] = [0, 0, 1, 1];
		const red = await sampleImageHex(
			[
				[200, 30, 30],
				[40, 40, 40],
				[210, 40, 40],
				[200, 200, 200]
			] as never,
			sharp as never,
			box
		);
		expect(red).toBe('#d22828');
		const white = await sampleImageHex(
			[
				[30, 30, 30],
				[250, 250, 250],
				[20, 20, 20],
				[240, 240, 240]
			] as never,
			sharp as never,
			box
		);
		expect(white).toBe('#fafafa');
	});
});

describe('bundled catalog', () => {
	const hasBrand = (family: 'petg' | 'tpu', brand: string) =>
		swatches(family).filter((t) => t[0] === brand);
	const chosen = (family: 'petg' | 'tpu', brand: string) => {
		const r = pickerSwatches(swatches(family), { brands: [brand] });
		return [...r.neutrals, ...r.colorful].map((e) => e.t[1]);
	};
	it('lists Schoolhouse Spools PETG, PCTG and TPU colors', () => {
		expect(hasBrand('petg', 'Schoolhouse Spools').length).toBeGreaterThan(15);
		expect(hasBrand('tpu', 'Schoolhouse Spools').length).toBeGreaterThan(5);
		expect(chosen('petg', 'Schoolhouse Spools')).toEqual(
			expect.arrayContaining(['Baby Pink', 'Pearl Gold'])
		);
		expect(chosen('tpu', 'Schoolhouse Spools')).toEqual(
			expect.arrayContaining(['95A Make Good Purple'])
		);
	});
	it('offers the new Overture 95A TPU colors as Primary/Accent TPU choices, not glow or matte ones', () => {
		const tpu = chosen('tpu', 'Overture');
		expect(tpu).toEqual(
			expect.arrayContaining(['High Speed 95A Neon Magenta', '95A Red', '95A Purple'])
		);
		expect(tpu).not.toContain('High Speed 95A Luminous Pink');
		expect(tpu).not.toContain('95A Matte White');
	});
	it('keeps the store hex of every supplement color and marks estimates', () => {
		const sup = supplementFile as FilamentSupplement;
		for (const b of sup.brands)
			for (const m of b.materials)
				for (const c of m.colors) {
					expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
					expect(['store', 'image', 'filascope']).toContain(c.hexSource);
				}
		expect(
			sup.brands
				.find((b) => b.name === 'Schoolhouse Spools')!
				.materials[0].colors.every((c) => c.hexSource === 'image')
		).toBe(true);
	});
});
