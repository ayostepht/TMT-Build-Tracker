import { describe, expect, it } from 'vitest';
import { describeActivity } from './activity.ts';
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
