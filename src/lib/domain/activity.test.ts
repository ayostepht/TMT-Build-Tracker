import { describe, expect, it } from 'vitest';
import { describeActivity, describeActivitySegments, startedOnPrinter } from './activity.ts';
import { filamentLabel } from './labels.ts';
import { makeView } from './fixtures.ts';
import type { ActivityItem } from './types.ts';

const view = makeView();
view.members = [{ userId: 'u2', name: 'Sam', role: 'editor' }];
const part = view.parts[0];
const part2 = view.parts[1];

function act(
	kind: string,
	payload: Record<string, unknown> = {},
	userName: string | null = 'Steph'
): ActivityItem {
	return { id: 'a', userId: 'u1', userName, kind, payload, at: '2026-01-01T00:00:00.000Z' };
}
const say = (kind: string, payload?: Record<string, unknown>, name: string | null = 'Steph') =>
	describeActivity(act(kind, payload, name), view);

describe('filamentLabel', () => {
	it('shows only the name when it already contains the material', () => {
		expect(filamentLabel({ name: 'Primary PETG', material: 'PETG' })).toBe('Primary PETG');
		expect(filamentLabel({ name: 'Tire tpu 95a', material: 'TPU 95A' })).toBe('Tire tpu 95a');
		expect(filamentLabel({ name: 'Tire TPU', material: 'TPU 95A' })).toBe('Tire TPU');
		expect(filamentLabel({ name: 'Soft TPU', material: 'TPU 95A' })).toBe('Soft TPU');
	});
	it('prefixes the material when the name lacks it', () => {
		expect(filamentLabel({ name: 'Overture Blue', material: 'PETG' })).toBe('PETG Overture Blue');
	});
	it('handles missing pieces', () => {
		expect(filamentLabel(undefined, 'accent')).toBe('accent');
		expect(filamentLabel({ name: 'Blue', material: '' })).toBe('Blue');
	});
	it('labels the seeded roles without repeating the material', () => {
		for (const f of view.filaments) {
			const label = filamentLabel(f);
			expect(label.split(' ').filter((w) => w === 'PETG').length).toBeLessThanOrEqual(1);
		}
	});
});

describe('describeActivity', () => {
	it('keeps rendering the historical build.import kind', () => {
		expect(say('build.import', { parts: 3, runs: 2 }, 'Sam')).toBe(
			'Sam imported progress from the original prototype (3 parts and 2 prints)'
		);
	});

	it('build lifecycle', () => {
		expect(say('build.create', { name: 'x' })).toBe('Steph started this build');
		expect(say('build.update', { phase: 'printing', name: 'Mia' })).toBe(
			'Steph renamed it to "Mia" and moved it to the printing phase'
		);
		expect(say('build.update', {})).toBe('Steph edited the build details');
		expect(say('build.move', { toName: 'Chapter A' })).toBe('Steph moved this build to Chapter A');
		expect(say('build.move', {})).toBe('Steph moved this build to a chapter');
	});
	it('part status and update use part names, not slugs', () => {
		const s = say('part.status', { slug: part.slug, from: 'To print', to: 'Printing' });
		expect(s).toBe(`Steph set ${part.name} to Printing`);
		expect(s).not.toContain(part.slug === part.name ? '\u0000' : part.slug);
		expect(say('part.update', { slug: part.slug, assigneeUserId: 'u2' })).toBe(
			`Steph updated ${part.name} (assigned it to Sam)`
		);
		expect(say('part.update', { slug: part.slug, comps: true })).toContain('ticked off');
	});
	it('names the printer on a start and on a logged run', () => {
		expect(say('printing.start', { slugs: [part.slug], printer: 'Garage printer' })).toBe(
			`Steph put ${part.name} on Garage printer`
		);
		expect(
			say('run.add', { plateNumber: 3, result: 'Success', printer: 'Garage printer', grams: 10 })
		).toBe('Steph logged a successful print of plate 3 on Garage printer (10 g)');
	});
	it('startedOnPrinter reads the newest start that covers the parts', () => {
		const at = (kind: string, payload: Record<string, unknown>): ActivityItem => ({
			...act(kind, payload),
			id: kind + JSON.stringify(payload)
		});
		const v = (...rows: ActivityItem[]) => ({ activity: rows }); // newest first
		const s = [part.slug];
		expect(startedOnPrinter(v(at('printing.start', { slugs: s, printer: 'A' })), s)).toBe('A');
		expect(startedOnPrinter(v(at('printing.start', { slugs: s })), s)).toBeNull();
		expect(
			startedOnPrinter(v(at('printing.start', { slugs: [part2.slug], printer: 'A' })), s)
		).toBeNull();
		expect(
			startedOnPrinter(
				v(at('printing.stop', { slugs: s }), at('printing.start', { slugs: s, printer: 'A' })),
				s
			)
		).toBeNull();
		expect(
			startedOnPrinter(
				v(
					at('run.add', { plateNumber: 2, partSlug: null, partSlugs: null }),
					at('printing.start', { slugs: s, printer: 'A' })
				),
				s,
				2
			)
		).toBeNull();
		expect(
			startedOnPrinter(
				v(
					at('printing.start', { slugs: s, printer: 'B' }),
					at('printing.start', { slugs: s, printer: 'A' })
				),
				s
			)
		).toBe('B');
	});
	it('printing actions', () => {
		const slugs = [part.slug, part2.slug];
		expect(say('printing.start', { slugs })).toBe(
			`Steph put ${part.name} and ${part2.name} on the printer`
		);
		expect(say('printing.stop', { slugs: [part.slug] })).toBe(
			`Steph took ${part.name} off the printer`
		);
		expect(say('printing.setStart', { slugs: [part.slug] })).toContain('start time');
		expect(say('printing.setEstimate', { slugs: [part.slug], seconds: 7500 })).toContain('2h 05m');
		expect(say('printing.setEstimate', { slugs: [part.slug], seconds: null })).toContain('cleared');
	});
	it('runs', () => {
		expect(say('run.add', { plateNumber: 12, result: 'Success', grams: 431, partSlug: null })).toBe(
			'Steph logged a successful print of plate 12 (431 g)'
		);
		expect(say('run.add', { plateNumber: null, partSlug: part.slug, result: 'Failed' })).toBe(
			`Steph logged a failed print of ${part.name}`
		);
		expect(say('run.add', { plateNumber: 3, result: 'Partial' })).toBe(
			'Steph logged a partial print of plate 3'
		);
		expect(say('run.delete', { plateNumber: 3, result: 'Failed' })).toBe(
			'Steph deleted a failed print of plate 3 from the log'
		);
	});
	it('run edits and deletes mention recomputed parts', () => {
		expect(
			say('run.delete', {
				plateNumber: null,
				partSlug: part.slug,
				result: 'Success',
				recomputed: [{ slug: part.slug, from: 'Printed', to: 'To print' }]
			})
		).toBe(
			`Steph deleted a successful print of ${part.name} from the log and set ${part.name} back to To print`
		);
		expect(say('run.delete', { plateNumber: 3, result: 'Failed', recomputed: [] })).toBe(
			'Steph deleted a failed print of plate 3 from the log'
		);
		expect(
			say('run.update', {
				plateNumber: null,
				partSlug: part.slug,
				result: 'Failed',
				recomputed: [{ slug: part.slug, from: 'Printed', to: 'Reprint' }]
			})
		).toBe(
			`Steph edited a print log of ${part.name} (changed the result to failed) and set ${part.name} to Reprint`
		);
		expect(say('run.update', { plateNumber: 3, result: 'Success', note: 'x', grams: 2 })).toBe(
			'Steph edited a print log of plate 3 (changed the result to success, the grams and the note)'
		);
	});
	it('undo', () => {
		expect(say('run.undo', { plateNumber: 3, result: 'Failed' })).toBe(
			'Steph undid a failed print of plate 3'
		);
	});
	it('plates', () => {
		expect(say('plate.slicer', { number: 4, slicerGrams: 120 })).toBe(
			'Steph set the slicer weight of plate 4 to 120 g'
		);
		expect(say('plate.slicer', { number: 4, slicerByPart: { a: 1 } })).toContain('weights');
	});
	it('filaments use labels from the view', () => {
		const f = view.filaments[0];
		expect(say('filament.spools', { role: f.key, spools: 5 })).toBe(
			`Steph set ${filamentLabel(f)} spools to 5`
		);
		expect(say('filament.spools', { role: f.key, spools: 4.5 })).toBe(
			`Steph set ${filamentLabel(f)} spools to 4.5`
		);
		expect(say('filament.update', { role: f.key, hex: '#112233' })).toContain('#112233');
	});
	it('falls back gracefully', () => {
		expect(say('weird.kind', {}, null)).toBe('Someone made a change (weird.kind)');
		expect(say('part.status', { slug: 'gone', to: 'Printed' })).toBe('Steph set a part to Printed');
	});
});

describe('template role names', () => {
	it('never repeats a material word', () => {
		expect(filamentLabel({ name: 'Primary PETG', material: 'PETG' })).toBe('Primary PETG');
		expect(filamentLabel({ name: 'Tire TPU', material: 'TPU 95A' })).toBe('Tire TPU');
		expect(filamentLabel({ name: 'Overture Blue', material: 'PETG' })).toBe('PETG Overture Blue');
	});
});

describe('describeActivitySegments', () => {
	const segs = (kind: string, payload: Record<string, unknown> = {}) =>
		describeActivitySegments(act(kind, payload), view);

	it('joined text equals describeActivity for every kind', () => {
		const rows: [string, Record<string, unknown>][] = [
			['build.create', {}],
			['part.status', { slug: part.slug, to: 'Printing' }],
			['part.update', { slug: part.slug, assigneeUserId: 'u2' }],
			['printing.start', { slugs: [part.slug, part2.slug] }],
			['printing.stop', { slugs: [] }],
			['run.add', { plateNumber: 13, result: 'Success', grams: 40 }],
			['run.add', { partSlugs: [part.slug, 'nope'], result: 'Failed' }],
			['run.update', { partSlug: part.slug, newPartSlug: part2.slug, note: 'x' }],
			['run.delete', { plateNumber: 2, recomputed: [{ slug: part.slug, to: 'To print' }] }],
			['run.undo', { plateNumber: 2 }],
			['plate.slicer', { number: 4, slicerGrams: 12 }],
			['printer.job.start', { printer: 'CC', plateNumber: 5, fileName: 'a.3mf' }],
			['printer.job.done', { plateNumber: 5, auto: true, grams: 3 }],
			['printer.job.link', { plateNumber: 6 }],
			['printer.job.release', { plateNumber: 7 }],
			['printer.job.unstarted', { printer: 'CC', plateNumber: 8, result: 'cancelled' }],
			['design.update', { moves: [{ slug: part.slug, role: 'accent', roleName: 'Blue' }] }],
			['design.update', { palette: { label: 'Sunset', reset: 5, kept: 2 }, locked: ['Wing Left'] }],
			[
				'design.update',
				{
					removed: { key: 'x', name: 'Red', material: 'PETG', spools: 1, spoolmanSpoolId: 12 },
					replacedBy: { key: 'primary', name: 'Primary', material: 'PETG' }
				}
			],
			['something.new', {}]
		];
		for (const [kind, payload] of rows) {
			const a = act(kind, payload);
			expect(
				describeActivitySegments(a, view)
					.map((s) => s.text)
					.join('')
			).toBe(describeActivity(a, view));
		}
	});

	it('tags plate references in every kind that names a plate', () => {
		const plateOf = (kind: string, payload: Record<string, unknown>) =>
			segs(kind, payload).filter((s) => s.plate !== undefined);
		for (const kind of ['run.add', 'run.update', 'run.delete', 'run.undo']) {
			expect(plateOf(kind, { plateNumber: 13 })).toEqual([{ text: 'plate 13', plate: 13 }]);
		}
		for (const [kind, payload] of [
			['plate.slicer', { number: 13, slicerGrams: 5 }],
			['printer.job.start', { plateNumber: 13 }],
			['printer.job.done', { plateNumber: 13 }],
			['printer.job.link', { plateNumber: 13 }],
			['printer.job.release', { plateNumber: 13 }],
			['printer.job.unstarted', { plateNumber: 13 }]
		] as const) {
			expect(plateOf(kind, payload)).toEqual([{ text: 'plate 13', plate: 13 }]);
		}
		expect(plateOf('run.add', {})).toEqual([]);
	});

	it('tags known part names and leaves fallbacks and unknown slugs plain', () => {
		expect(segs('part.status', { slug: part.slug, to: 'Printing' })).toEqual([
			{ text: 'Steph set ' },
			{ text: part.name, part: part.slug },
			{ text: ' to Printing' }
		]);
		const multi = segs('printing.start', { slugs: [part.slug, part2.slug] });
		expect(multi.filter((s) => s.part).map((s) => s.part)).toEqual([part.slug, part2.slug]);
		const unknown = segs('part.status', { slug: 'no-such-part', to: 'Printed' });
		expect(unknown.some((s) => s.part)).toBe(false);
		expect(unknown.map((s) => s.text).join('')).toBe('Steph set a part to Printed');
		expect(segs('printing.start', {}).some((s) => s.part)).toBe(false);
	});

	it('never lets payload text forge a link', () => {
		const s = segs('build.update', { name: '\u0001plate:9\u0002fake\u0003' });
		expect(s.every((x) => x.plate === undefined && x.part === undefined)).toBe(true);
	});
});

describe('printer.job.unstarted', () => {
	it('says plainly that nothing was logged', () => {
		const text = (r: string) =>
			describeActivitySegments(
				act('printer.job.unstarted', { printer: 'Shop CC', plateNumber: 3, result: r }),
				view
			)
				.map((x) => x.text)
				.join('');
		expect(text('cancelled')).toBe(
			'Shop CC cancelled plate 3 before it started; nothing was logged'
		);
		expect(text('cancelled')).toContain('before it started; nothing was logged');
		expect(text('failed')).toContain('stopped');
	});
});

describe('design.update palette, lock and removal sentences', () => {
	const d = (payload: Record<string, unknown>) =>
		describeActivity(act('design.update', payload), view);
	const who = describeActivity(act('design.update', {}), view).replace(' changed the colors', '');

	it('describes a palette apply with resets and kept locks', () => {
		expect(d({ palette: { label: 'Sunset', reset: 5, kept: 2 } })).toBe(
			`${who} applied the Sunset palette; 5 parts back to their kit colors, 2 locked parts kept`
		);
		expect(d({ palette: { label: 'Sunset', reset: 1, kept: 1 } })).toContain(
			'1 part back to its kit color, 1 locked part kept'
		);
		expect(d({ palette: { label: 'Sunset', reset: 0, kept: 2 } })).toBe(
			`${who} applied the Sunset palette; 2 locked parts kept`
		);
		expect(d({ palette: { label: 'Sunset', reset: 0, kept: 0 } })).toBe(
			`${who} applied the Sunset palette`
		);
	});

	it('describes locks, unlocks and locked parts moved to a new slot', () => {
		expect(d({ locked: ['Wing Left'] })).toBe(`${who} locked the color of Wing Left`);
		expect(d({ unlocked: ['A', 'B'] })).toBe(`${who} unlocked the color of A and B`);
		expect(
			d({
				lockedAdded: [{ key: 'c1', name: 'Overture Red', material: 'PETG', parts: ['Wing Left'] }]
			})
		).toBe(`${who} kept Wing Left on a new color slot (Overture Red PETG)`);
		expect(d({ lockedAdded: [{ key: 'c1', name: 'Overture Red' }] })).toContain(
			'kept locked parts on a new color slot (Overture Red)'
		);
	});

	it('describes a removal with replacement, Spoolman link and dropped spools', () => {
		const base = {
			removed: { key: 'x', name: 'Overture Red', material: 'PETG', parts: 3 },
			replacedBy: { key: 'primary', name: 'Primary', material: 'PETG' }
		};
		expect(d(base)).toBe(`${who} removed Overture Red PETG; its 3 parts now use Primary PETG`);
		expect(d({ ...base, removed: { ...base.removed, spoolmanSpoolId: 12, spools: 2 } })).toContain(
			'and unlinked Spoolman spool #12 and dropped 2 spools of stock'
		);
		// old shape still reads
		expect(d({ removed: { key: 'x', name: 'Red' } })).toBe(`${who} removed a color: Red`);
	});

	it('does not repeat a material the name already contains', () => {
		const rep = { key: 'primary', name: 'Primary PETG', material: 'PETG' };
		expect(
			d({ removed: { key: 'x', name: 'Red PETG', material: 'PETG', parts: 2 }, replacedBy: rep })
		).toBe(`${who} removed Red PETG; its 2 parts now use Primary PETG`);
		expect(
			d({ removed: { key: 'x', name: 'red petg', material: 'PETG', parts: 1 }, replacedBy: rep })
		).toBe(`${who} removed red petg; its 1 part now uses Primary PETG`);
		// word boundary: "PETGX" does not contain PETG
		expect(d({ lockedAdded: [{ name: 'PETGX', material: 'PETG', parts: ['A'] }] })).toContain(
			'(PETGX PETG)'
		);
		expect(d({ lockedAdded: [{ name: 'Blue PETG', material: 'PETG', parts: ['A'] }] })).toContain(
			'on a new color slot (Blue PETG)'
		);
		expect(
			d({
				removed: { key: 'x', name: 'Black TPU', material: 'TPU 95A', parts: 2 },
				replacedBy: { key: 'p', name: 'Soft TPU 95A', material: 'TPU 95A' }
			})
		).toBe(`${who} removed Black TPU 95A; its 2 parts now use Soft TPU 95A`);
	});

	it('describes a palette undo, with removed slots singular and plural', () => {
		expect(d({ palette: { label: 'previous', slots: [] } })).toBe(
			`${who} undid the palette change`
		);
		expect(d({ palette: { label: 'Sunset', undo: true } })).toBe(`${who} undid the palette change`);
		expect(d({ palette: { undo: true, removeRoles: ['c1'] } })).toBe(
			`${who} undid the palette change; removed 1 color slot added for locked parts`
		);
		expect(d({ palette: { undo: true, removeRoles: ['c1', 'c2'] } })).toBe(
			`${who} undid the palette change; removed 2 color slots added for locked parts`
		);
	});

	it('strips control characters from names', () => {
		expect(d({ locked: ['A\u0001B'] })).toBe(`${who} locked the color of AB`);
	});
});
