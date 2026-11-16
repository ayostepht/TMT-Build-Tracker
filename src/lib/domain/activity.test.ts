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
	it('part.grams says what was entered or cleared', () => {
		expect(say('part.grams', { slug: part.slug, manualGrams: 251.5 })).toBe(
			`Steph set the weight of ${part.name} to 252 g`
		);
		expect(say('part.grams', { slug: part.slug, manualGrams: null, cleared: true })).toBe(
			`Steph cleared the entered weight of ${part.name}`
		);
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
			`Steph set ${filamentLabel(f)} starting spools to 5 kg`
		);
		expect(say('filament.spools', { role: f.key, spools: 4.5 })).toBe(
			`Steph set ${filamentLabel(f)} starting spools to 4.5 kg`
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
			['part.grams', { slug: part.slug, manualGrams: 90 }],
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
		expect(d({ locked: ['Wing Left'] })).toBe(`${who} locked the part color of Wing Left`);
		expect(d({ unlocked: ['A', 'B'] })).toBe(`${who} unlocked the part color of A and B`);
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
		expect(d({ locked: ['A\u0001B'] })).toBe(`${who} locked the part color of AB`);
	});
});

describe('Partial with per-part results and spool adds', () => {
	const f = view.filaments[0];
	it('describes a split run.add with both halves', () => {
		const t = say('run.add', {
			plateNumber: 3,
			split: true,
			result: 'Partial',
			kept: [part.slug],
			lost: [part2.slug],
			keptGrams: 162.4,
			lostGrams: 40
		});
		expect(t).toBe(
			`Steph logged a partial print of plate 3: ${part.name} printed (162 g), ${part2.name} flagged for reprint (40 g lost)`
		);
		const segs = describeActivitySegments(
			act('run.add', { plateNumber: 3, split: true, kept: [part.slug], lost: [part2.slug] }),
			view
		);
		expect(segs.filter((x) => x.part).map((x) => x.part)).toEqual([part.slug, part2.slug]);
		expect(segs.find((x) => x.plate === 3)).toBeTruthy();
	});
	it('describes the undo of a split', () => {
		expect(
			say('run.undo', { plateNumber: 3, split: true, result: 'Partial', runIds: ['a', 'b'] })
		).toBe('Steph undid a partial print of plate 3 (both of its logs)');
		expect(say('run.undo', { plateNumber: 3, result: 'Success' })).toBe(
			'Steph undid a successful print of plate 3'
		);
	});
	it('describes spool adds and removals', () => {
		expect(say('filament.stock.add', { role: f.key, kg: 1, note: 'restock' })).toBe(
			`Steph added 1 kg of ${filamentLabel(f)} (restock)`
		);
		expect(say('filament.stock.add', { role: f.key, kg: 0.5 })).toBe(
			`Steph added 0.5 kg of ${filamentLabel(f)}`
		);
		expect(say('filament.stock.remove', { role: f.key, kg: 2 })).toBe(
			`Steph removed an added spool of ${filamentLabel(f)} (2 kg)`
		);
		// a note cannot forge a link marker
		const forged = say('filament.stock.add', {
			role: f.key,
			kg: 1,
			note: '\u0001part:x\u0002y\u0003'
		});
		expect([...forged].some((ch) => ch.charCodeAt(0) <= 3)).toBe(false);
	});
});

describe('design.recolor and design.apply modes', () => {
	it('says colors only, plates and progress kept', () => {
		expect(say('design.recolor', { designName: 'Sunset' })).toBe(
			'Steph changed the colors to design "Sunset" (colors only; plates and progress kept)'
		);
	});
	it('lists skipped slots with the reason', () => {
		const text = say('design.recolor', {
			designName: 'Sunset',
			skipped: [
				{ role: 'tire', name: 'Tire', reason: 'material' },
				{ role: 'accent', reason: 'locked' }
			]
		});
		expect(text).toContain(
			'(colors only; plates and progress kept); left Tire (other material) and '
		);
		expect(text).toContain('(locked parts) as they were');
	});
	it('does not render the before snapshot and strips control characters', () => {
		const text = say('design.recolor', {
			designName: 'Sun\u0001set\u0003',
			before: { roles: [{ key: 'primary', hex: '#123456' }], partRoles: {}, lockedParts: [] }
		});
		expect(text).toBe(
			'Steph changed the colors to design "Sunset" (colors only; plates and progress kept)'
		);
		expect(text).not.toContain('123456');
	});
	it('marks a full apply', () => {
		expect(
			say('design.apply', {
				designName: 'Sunset',
				mode: 'full',
				before: { roles: [], partRoles: {}, lockedParts: [] }
			})
		).toBe('Steph applied the color design "Sunset" (colors and part colors replaced)');
		// Not started: no snapshot, so no suffix even if the server sends mode: 'full'.
		expect(say('design.apply', { designName: 'Sunset', mode: 'full' })).toBe(
			'Steph applied the color design "Sunset"'
		);
		expect(say('design.apply', { designName: 'Sunset' })).toBe(
			'Steph applied the color design "Sunset"'
		);
	});
});

describe('Spoolman activity sentences', () => {
	const f = view.filaments[0];
	const label = filamentLabel(f);
	it('link, relink and unlink', () => {
		expect(
			say('filament.spoolman.link', { role: f.key, filamentName: 'Overture Blue', filamentId: 7 })
		).toBe(`Steph linked ${label} to Spoolman filament "Overture Blue" (#7)`);
		expect(say('filament.spoolman.link', { role: f.key, filamentId: 8, relinked: true })).toBe(
			`Steph linked ${label} to Spoolman filament (#8) instead of the one it was linked to`
		);
		expect(say('filament.spoolman.unlink', { role: f.key, filamentName: 'Blue' })).toBe(
			`Steph unlinked ${label} from Spoolman filament "Blue"; its own spools count again`
		);
	});
	it('spool choice, auto-advance and clearing', () => {
		expect(say('filament.spoolman.spool', { role: f.key, spoolId: 4, spoolName: 'Roll B' })).toBe(
			`Steph set ${label} to Spoolman spool #4 (Roll B)`
		);
		expect(
			say('filament.spoolman.spool', { role: f.key, spoolId: 5, fromSpoolId: 4, auto: true })
		).toBe(`${label} moved on to Spoolman spool #5 because spool #4 ran out`);
		expect(say('filament.spoolman.spool', { role: f.key, spoolId: null })).toBe(
			`Steph cleared the Spoolman spool of ${label}`
		);
	});
	it('create and the one-off pre-link deduction (and its undo)', () => {
		expect(say('filament.spoolman.create', { what: 'vendor', name: 'Acme', id: 2 })).toBe(
			'Steph created Spoolman vendor "Acme" (#2)'
		);
		expect(
			say('filament.spoolman.create', { what: 'filament', name: 'Blue', id: 9, role: f.key })
		).toBe(`Steph created Spoolman filament "Blue" (#9) for ${label}`);
		expect(say('filament.spoolman.prelink', { role: f.key, grams: 1234 })).toBe(
			`Steph subtracted 1,234 g from Spoolman for ${label} (prints logged before it was linked)`
		);
		expect(say('filament.spoolman.prelink', { role: f.key, grams: 80, undone: true })).toBe(
			`Steph gave back 80 g to Spoolman for ${label} (prints logged before it was linked)`
		);
	});
	it('stock add and remove mention the Spoolman spool', () => {
		expect(say('filament.stock.add', { role: f.key, kg: 1, spoolmanSpoolId: 12 })).toBe(
			`Steph added 1 kg of ${label} and created Spoolman spool #12`
		);
		expect(
			say('filament.stock.remove', { role: f.key, kg: 1, spoolmanSpoolId: 12, archived: true })
		).toBe(`Steph removed an added spool of ${label} (1 kg) and archived Spoolman spool #12`);
		expect(
			say('filament.stock.remove', { role: f.key, spoolmanSpoolId: 12, archived: false })
		).toBe(`Steph removed an added spool of ${label}; Spoolman spool #12 was kept`);
	});
	it('strips link markers from user text', () => {
		const t = say('filament.spoolman.create', { what: 'filament', name: 'A\u0001b\u0003' });
		expect(t).toBe('Steph created Spoolman filament "Ab"');
	});
});
