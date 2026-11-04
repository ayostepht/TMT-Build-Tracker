import { describe, expect, it } from 'vitest';
import { fileMentionsBuild, matchPlate, normalizeFileName } from './printer-match.ts';

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
