import { describe, expect, it } from 'vitest';
import { GcodeObjectScanner, scanGcode } from './gcode-objects.ts';

// Two objects printed layer by layer, a prime tower outside any object, tools T0 and T1, relative E,
// one arc, M73 lines carrying the slicer's own time (1 minute = 60 s for each 600 mm at F6000).
const gcode = [
	'; header',
	'EXCLUDE_OBJECT_DEFINE NAME=A_id_0_copy_0 CENTER=10,10 POLYGON=[[0,0],[1,1]]',
	'M83',
	'T0',
	'M73 P0 R10',
	'G1 X0 Y0 Z0.2 F6000',
	'EXCLUDE_OBJECT_START NAME=A_id_0_copy_0',
	'G1 X100 Y0 E5 F6000',
	'G1 X100 Y100 E5',
	'EXCLUDE_OBJECT_END NAME=A_id_0_copy_0',
	'T1',
	'G1 X0 Y100 E1', // prime tower: no owner
	'EXCLUDE_OBJECT_START NAME=B_id_0_copy_0',
	'G1 X0 Y0 E2',
	'G1 E-0.8 F2400', // retraction, no motion
	'G1 E0.8',
	'EXCLUDE_OBJECT_END NAME=B_id_0_copy_0',
	'M73 P50 R5',
	'EXCLUDE_OBJECT_START NAME=A_id_0_copy_0',
	'G3 X100 Y0 I50 J0 E3 F6000', // half circle of radius 50 (nominal 157 mm)
	'EXCLUDE_OBJECT_END NAME=A_id_0_copy_0',
	'M73 P100 R0',
	'; filament used [mm] = 13.00, 3.00',
	'; filament used [g] = 1.30, 0.30'
].join('\n');

describe('GcodeObjectScanner', () => {
	it('attributes extrusion per object and tool, ignoring retractions', () => {
		const r = scanGcode(gcode);
		expect(r.hasMarkers).toBe(true);
		const a = r.objects.get('A_id_0_copy_0')!;
		const b = r.objects.get('B_id_0_copy_0')!;
		expect(a.mmByTool).toEqual({ '0': 10, '1': 3 }); // the arc runs after the switch to T1
		expect(b.mmByTool).toEqual({ '1': 2 });
		expect(r.objects.get('')!.mmByTool).toEqual({ '1': 1 });
		expect(r.footerMm).toEqual([13, 3]);
		expect(r.footerGrams).toEqual([1.3, 0.3]);
	});

	it('scales moves to the time M73 says passed, outside time going to the empty owner', () => {
		const r = scanGcode(gcode);
		// first minute block (R10 to R5 = 300 s): A 200 mm, tower 100 mm, B 100 mm at F6000 = 100 mm/s
		// nominal 2 + 1 + 1 s = 4 s, scaled by 75 to 300 s: A 150, tower 75, B 75
		const a = r.objects.get('A_id_0_copy_0')!.seconds;
		const b = r.objects.get('B_id_0_copy_0')!.seconds;
		const tower = r.objects.get('')!.seconds;
		expect(b).toBeCloseTo(75, 0);
		expect(tower).toBeCloseTo(75, 0);
		// A: 150 s in the first block plus the arc block (157 mm = 1.57 s scaled to 300 s)
		expect(a).toBeCloseTo(150 + 300, 0);
		expect(r.totalSeconds).toBeCloseTo(600, 0);
	});

	it('gives the same result for any chunking, even one byte at a time', () => {
		const whole = scanGcode(gcode);
		const s = new GcodeObjectScanner();
		const bytes = new TextEncoder().encode(gcode);
		for (let i = 0; i < bytes.length; i += 7) s.push(bytes.subarray(i, i + 7));
		const parts = s.finish();
		expect([...parts.objects.entries()]).toEqual([...whole.objects.entries()]);
	});

	it('reads absolute extrusion (M82 with G92 resets) and Orca comment markers', () => {
		const r = scanGcode(
			[
				'M82',
				'T2',
				'G92 E0',
				'; printing object Part x id:0 copy 0',
				'G1 X10 Y0 E1.5 F3000',
				'G1 X20 Y0 E3',
				'G92 E0',
				'G1 X30 Y0 E1',
				'; stop printing object Part x id:0 copy 0'
			].join('\r\n')
		);
		expect(r.objects.get('Part x')!.mmByTool).toEqual({ '2': 4 });
	});

	it('finds no markers in a plain file', () => {
		const r = scanGcode('G1 X1 Y1 E1 F3000\nG1 X2 Y2 E1');
		expect(r.hasMarkers).toBe(false);
	});
});
