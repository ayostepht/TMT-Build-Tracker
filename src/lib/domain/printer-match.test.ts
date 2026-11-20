import { describe, expect, it } from 'vitest';
import {
	fileMentionsBuild,
	matchPlate,
	normalizeFileName,
	plateRunGrams
} from './printer-match.ts';
import { plateGrams } from './accounting.ts';
import { makeView } from './fixtures.ts';

const plates = [
	{ number: 1, name: 'Handle Left' },
	{ number: 3, name: 'Wings (Accent)' },
	{ number: 12, name: 'Seat Base' }
];

describe('matchPlate', () => {
	it('reads the plate number from our export names', () => {
		expect(matchPlate('plate-03-wings-accent.3mf', plates)).toBe(3);
		expect(matchPlate('TMT-Columbus-Elegoo-Centauri-Carbon-plain-plate12.3mf', plates)).toBe(12);
		expect(matchPlate('/usb/Columbus_plate_1.gcode', plates)).toBe(1);
	});
	it('matches "Plate 3 - Wings (Accent)" and plate names', () => {
		expect(matchPlate('Plate 3 - Wings (Accent).gcode', plates)).toBe(3);
		expect(matchPlate('Columbus Handle Left v2.gcode', plates)).toBe(1);
		expect(matchPlate('seat base.gcode', plates)).toBe(12);
	});
	it('returns null when nothing matches or the plate does not exist', () => {
		expect(matchPlate('benchy.gcode', plates)).toBeNull();
		expect(matchPlate('plate-07.gcode', plates)).toBeNull();
		expect(matchPlate('', plates)).toBeNull();
	});
	it('does not match "plate" inside other words', () => {
		expect(matchPlate('templates2.gcode', plates)).toBeNull();
	});
});

describe('helpers', () => {
	it('normalizes names', () => {
		expect(normalizeFileName('a/b/My_File-Name.GCODE')).toBe('my file name');
		expect(normalizeFileName('x.gcode.3mf')).toBe('x');
	});
	it('spots the build name', () => {
		expect(fileMentionsBuild('TMT-Columbus-Elegoo-plain.3mf', 'Columbus')).toBe(true);
		expect(fileMentionsBuild('TMT-Other.3mf', 'Columbus')).toBe(false);
	});
});

describe('plateRunGrams', () => {
	it('uses the shared plate calculation and returns null when nothing is known', () => {
		const v = makeView();
		const plain = v.plates.find((p) => !p.perPartRuns)!;
		const typed = {
			...v,
			plates: v.plates.map((p) =>
				p === plain ? { ...p, slicerGrams: 42.5, gramsSource: 'user' as const } : p
			)
		};
		expect(plateRunGrams(typed, plain.number)).toBe(42.5);
		expect(plateRunGrams(v, 9999)).toBeNull();
		const empty = {
			...v,
			plates: v.plates.map((p) => (p === plain ? { ...p, slicerGrams: null, parts: [] } : p))
		};
		expect(plateRunGrams(empty, plain.number)).toBeNull();
	});
	it('falls back to the BOM like the rest of the app', () => {
		const v = makeView();
		const plain = v.plates.find((p) => !p.perPartRuns && p.parts.length)!;
		const g = plateRunGrams(
			{ ...v, plates: v.plates.map((p) => (p === plain ? { ...p, slicerGrams: null } : p)) },
			plain.number
		);
		const v2 = {
			...v,
			plates: v.plates.map((p) => (p === plain ? { ...p, slicerGrams: null } : p))
		};
		expect(g).toBe(
			plateGrams(
				v2,
				v2.plates.find((p) => p.number === plain.number)!
			).perRun || null
		);
	});
	it('sums only the printed parts of a per-part plate', () => {
		const v = makeView();
		const src = v.plates.find((p) => p.parts.length >= 3)!;
		const [a, b, c] = src.parts;
		const view = {
			...v,
			plates: v.plates.map((p) =>
				p === src
					? {
							...p,
							perPartRuns: true,
							runs: 1,
							slicerByPart: { [a]: 10, [b]: 20, [c]: 40 },
							gramsSource: 'file' as const
						}
					: p
			)
		};
		expect(plateRunGrams(view, src.number, [a, b])).toBe(30);
		expect(plateRunGrams(view, src.number, [c])).toBe(40);
		expect(plateRunGrams(view, src.number, [a, b])).not.toBe(70);
	});
	it('scales a single-run plate to the picked parts, and the whole plate is unchanged', () => {
		const v = makeView();
		const src = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 2)!;
		const view = {
			...v,
			plates: v.plates.map((p) =>
				p === src ? { ...p, runs: 1, slicerGrams: 100, gramsSource: 'user' as const } : p
			)
		};
		const some = plateRunGrams(view, src.number, [src.parts[0]]);
		expect(some).not.toBeNull();
		expect(some!).toBeLessThan(100);
		expect(some!).toBeGreaterThan(0);
		expect(plateRunGrams(view, src.number, src.parts)).toBe(100);
		expect(plateRunGrams(view, src.number)).toBe(100);
	});
});
