import { describe, expect, it } from 'vitest';
import { makeView } from './fixtures.ts';
import { convertPrototype, importCounts, type PrototypeExport } from './import-prototype.ts';

const view = makeView();

const base = (over: Partial<PrototypeExport> = {}): PrototypeExport => ({
	format: 'tmt-prototype-v1',
	parts: {},
	plates: {},
	...over
});

describe('convertPrototype', () => {
	it('rejects a wrong format', () => {
		expect(() => convertPrototype(view, { ...base(), format: 'nope' } as never)).toThrow(/format/);
		expect(() => convertPrototype(view, null as never)).toThrow();
	});

	it('maps statuses, printed date, comps and ignores legacy runG', () => {
		const c = convertPrototype(
			view,
			base({
				parts: {
					'seat-center': {
						status: 'Printed',
						printed: '2026-02-03',
						comps: { '0': true, '1': false },
						runG: 12
					},
					'wing-right': { status: 'Reprint' },
					buckles: { status: 'To print', printed: '', comps: {} }
				}
			})
		);
		expect(c.warnings).toEqual([]);
		expect(c.patches).toHaveLength(2); // untouched parts produce no patch
		expect(c.patches.find((p) => p.slug === 'seat-center')).toEqual({
			slug: 'seat-center',
			status: 'Printed',
			startedAt: null,
			printedOn: '2026-02-03',
			runEstSeconds: null,
			comps: { '0': true, '1': false }
		});
		expect(c.patches.find((p) => p.slug === 'wing-right')?.status).toBe('Reprint');
	});

	it('keeps start and estimate only for a Printing part', () => {
		const c = convertPrototype(
			view,
			base({
				parts: {
					'seat-center': { status: 'Printing', started: '2026-03-01T10:00:00.000Z', runEst: 3600 },
					'wing-right': {
						status: 'Printed',
						printed: '2026-03-02',
						started: '2026-03-01T10:00:00.000Z',
						runEst: 99
					}
				}
			})
		);
		expect(c.patches[0]).toMatchObject({
			status: 'Printing',
			startedAt: '2026-03-01T10:00:00.000Z',
			runEstSeconds: 3600
		});
		expect(c.patches[1]).toMatchObject({ status: 'Printed', startedAt: null, runEstSeconds: null });
	});

	it('turns part logs into per-part runs', () => {
		const c = convertPrototype(
			view,
			base({
				parts: {
					buckles: {
						status: 'Printed',
						printed: '2026-02-01',
						log: [{ d: '2026-02-01', r: 'Success', g: 12.5, h: 1.5, note: 'ok' }]
					}
				}
			})
		);
		expect(c.runs).toEqual([
			{
				plateNumber: null,
				partSlug: 'buckles',
				partSlugs: null,
				date: '2026-02-01',
				result: 'Success',
				grams: 12.5,
				hours: 1.5,
				printer: null,
				note: 'ok'
			}
		]);
	});

	it('turns plate logs into runs, with part and parts narrowing, and slicer weights', () => {
		const c = convertPrototype(
			view,
			base({
				plates: {
					'13': {
						slicerByPart: { 'rims-1-4': 80, 'rims-2-3': 82 },
						log: [{ d: '2026-02-05', r: 'Success', g: 80, h: 9, note: '', part: 'rims-1-4' }]
					},
					'12': {
						slicerG: 150.5,
						log: [
							{
								d: '2026-02-04',
								r: 'Failed',
								g: null,
								h: null,
								note: 'spaghetti',
								parts: ['connectors', 'hub-caps']
							},
							{ d: '2026-02-06', r: 'Partial', g: 10, h: 1, note: '' }
						]
					}
				}
			})
		);
		expect(c.warnings).toEqual([]);
		expect(c.runs.map((r) => [r.plateNumber, r.partSlug, r.partSlugs, r.result])).toEqual([
			[12, null, ['connectors', 'hub-caps'], 'Failed'],
			[13, 'rims-1-4', null, 'Success'],
			[12, null, null, 'Partial']
		]);
		expect(c.plates).toEqual(
			expect.arrayContaining([
				{ number: 13, slicerGrams: null, slicerByPart: { 'rims-1-4': 80, 'rims-2-3': 82 } },
				{ number: 12, slicerGrams: 150.5, slicerByPart: {} }
			])
		);
		expect(importCounts(c)).toEqual({ parts: 0, runs: 3, plates: 2, spools: 0 });
	});

	it('maps prototype filament keys to roles', () => {
		const c = convertPrototype(
			view,
			base({ settings: { filament: { spools: { ob: 3, db: 1, tdb: 1, tbk: 2 } } } })
		);
		expect(c.spools).toEqual([
			{ role: 'primary', spools: 3 },
			{ role: 'accent', spools: 1 },
			{ role: 'soft', spools: 1 },
			{ role: 'tire', spools: 2 }
		]);
	});

	it('keeps fractional spools and warns about unknown keys', () => {
		const c = convertPrototype(
			view,
			base({ settings: { filament: { spools: { ob: 2.5, zz: 1 } } } })
		);
		expect(c.spools).toEqual([{ role: 'primary', spools: 2.5 }]);
		expect(c.warnings).toHaveLength(1);
	});

	it('warns about and skips unknown ids, bad results and bad dates', () => {
		const c = convertPrototype(
			view,
			base({
				parts: {
					ghost: { status: 'Printed' },
					buckles: {
						status: 'Weird',
						log: [
							{ d: '2026-13-40', r: 'Success' },
							{ d: '2026-02-01', r: 'Maybe' },
							{ d: '2026-02-01', r: 'Success', g: -4 }
						]
					}
				},
				plates: {
					'999': { slicerG: 5 },
					abc: {},
					'12': {
						log: [
							{ d: '2026-02-01', r: 'Success', part: 'ghost' },
							{ d: '2026-02-01', r: 'Success', parts: ['ghost'] }
						]
					}
				}
			})
		);
		expect(c.patches).toEqual([]);
		expect(c.runs).toHaveLength(1);
		expect(c.runs[0].grams).toBeNull();
		expect(c.plates).toEqual([]);
		expect(c.warnings.join('\n')).toMatch(/ghost/);
		expect(c.warnings.join('\n')).toMatch(/"999"/);
		expect(c.warnings.join('\n')).toMatch(/"abc"/);
		expect(c.warnings.length).toBeGreaterThanOrEqual(8);
	});
});
