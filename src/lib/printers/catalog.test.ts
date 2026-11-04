import { describe, expect, it } from 'vitest';
import { catalogPrinter, PRINTER_CATALOG, printerBrands, searchPrinters } from './catalog.ts';
import { parsePrinter, printerFromCatalog } from './printer.ts';

describe('printer catalog', () => {
	it('has a decent number of printers with unique ids', () => {
		expect(PRINTER_CATALOG.length).toBeGreaterThanOrEqual(60);
		const ids = PRINTER_CATALOG.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9.]+)*$/);
	});

	it('has sane sizes', () => {
		for (const p of PRINTER_CATALOG) {
			expect(p.bedX, p.id).toBeGreaterThanOrEqual(100);
			expect(p.bedX, p.id).toBeLessThanOrEqual(600);
			expect(p.bedY, p.id).toBeGreaterThanOrEqual(100);
			expect(p.bedY, p.id).toBeLessThanOrEqual(600);
			expect(p.bedZ, p.id).toBeGreaterThanOrEqual(100);
			expect(p.bedZ, p.id).toBeLessThanOrEqual(700);
			expect(p.nozzle).toBe(0.4);
			if (p.maxNozzleC !== null) {
				expect(p.maxNozzleC).toBeGreaterThanOrEqual(220);
				expect(p.maxNozzleC).toBeLessThanOrEqual(450);
			}
			for (const m of p.mm) {
				expect(m.slots).toBeGreaterThanOrEqual(2);
				expect(m.slots).toBeLessThanOrEqual(16);
			}
			if (p.mmBuiltIn) expect(p.mm.length).toBeGreaterThan(0);
			if (p.round) expect(Math.min(p.bedX, p.bedY)).toBeLessThan(p.round);
		}
	});

	it('includes the printers we promise', () => {
		const need = [
			'elegoo-centauri-carbon',
			'elegoo-neptune-4',
			'elegoo-neptune-4-pro',
			'elegoo-neptune-4-plus',
			'elegoo-neptune-4-max',
			'bambu-lab-x1-carbon',
			'bambu-lab-x1e',
			'bambu-lab-p1s',
			'bambu-lab-p1p',
			'bambu-lab-p2s',
			'bambu-lab-a1',
			'bambu-lab-a1-mini',
			'bambu-lab-h2d',
			'bambu-lab-h2s',
			'prusa-mk4',
			'prusa-mk4s',
			'prusa-core-one',
			'prusa-xl-5-tools',
			'prusa-mini',
			'creality-k1',
			'creality-k1c',
			'creality-k1-max',
			'creality-k2-plus',
			'creality-ender-3-v3',
			'creality-ender-3-v3-se',
			'creality-ender-3-v3-ke',
			'creality-hi',
			'anycubic-kobra-3',
			'anycubic-kobra-s1',
			'qidi-q1-pro',
			'qidi-plus4',
			'qidi-x-max-3',
			'sovol-sv06',
			'sovol-sv07',
			'sovol-sv08',
			'voron-2-4-250',
			'voron-2-4-300',
			'voron-2-4-350',
			'voron-trident-300',
			'voron-v0-2',
			'flsun-v400',
			'snapmaker-u1'
		];
		for (const id of need) expect(catalogPrinter(id), id).not.toBeNull();
	});

	it('knows the Centauri Carbon and its CANVAS', () => {
		const cc = catalogPrinter('elegoo-centauri-carbon')!;
		expect([cc.bedX, cc.bedY, cc.bedZ]).toEqual([256, 256, 256]);
		expect(cc.mm[0]).toMatchObject({ name: 'CANVAS', slots: 4 });
		const p = printerFromCatalog(cc, 0);
		expect(p).toMatchObject({ mmSlots: 4, margin: 1, spacing: 8, catalogId: cc.id });
		expect(printerFromCatalog(cc, null).mmSlots).toBe(1);
	});

	it('groups by brand and searches', () => {
		expect(printerBrands().map((b) => b.brand)).toContain('Bambu Lab');
		expect(searchPrinters('centauri').map((p) => p.id)).toEqual(['elegoo-centauri-carbon']);
		expect(searchPrinters('bambu p1').length).toBe(2);
		expect(searchPrinters('canvas').length).toBeGreaterThan(0);
		expect(searchPrinters('').length).toBe(PRINTER_CATALOG.length);
	});

	it('validates printers', () => {
		const ok = printerFromCatalog(catalogPrinter('bambu-lab-a1')!);
		expect(parsePrinter(ok)).toEqual(ok);
		expect(() => parsePrinter({ ...ok, bedX: 20 })).toThrow(/Bed X/);
		expect(() => parsePrinter({ ...ok, catalogId: 'nope' })).toThrow(/catalog/);
		expect(() => parsePrinter({ ...ok, mmSlots: 2.5 })).toThrow(/whole/);
		expect(parsePrinter({ name: 'My', bedX: 200, bedY: 200, bedZ: 200 })).toMatchObject({
			catalogId: null,
			mmSlots: 1,
			margin: 1,
			spacing: 8
		});
	});
});

describe('bed presets', () => {
	it('computes example printers from the catalog', async () => {
		const { BED_PRESETS, DEFAULT_BED_PRESET, bedExamples, printerFromBed } =
			await import('./printer.ts');
		expect(DEFAULT_BED_PRESET).toMatchObject({ x: 256, y: 256 });
		expect(bedExamples(256, 256)).toBe('Centauri Carbon, Bambu X1/P1/A1, SK1');
		expect(bedExamples(220, 220)).toContain('K1');
		for (const p of BED_PRESETS) expect(bedExamples(p.x, p.y), `${p.x}`).not.toBe('');
		const bed = parsePrinter(printerFromBed(256, 256, 256, 4));
		expect(bed).toMatchObject({ catalogId: null, name: '256 × 256 bed', mmSlots: 4 });
	});
});
