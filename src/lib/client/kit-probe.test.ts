import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '#lib/domain/kit-import.ts';
import { mergeStepSources, probeBytes } from './kit-probe.ts';

describe('probeBytes', () => {
	const step = strToU8('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n');
	it('sniffs zips, 3MFs, nested zips, PDFs and STEP text', () => {
		const mf = zipSync({
			'[Content_Types].xml': strToU8('<x/>'),
			'3D/3dmodel.model': strToU8('<model/>'),
			'Auxiliaries/Assembly Guide/g.pdf': strToU8('%PDF-1.4')
		});
		const inner = zipSync({ 'a.step': step });
		const outer = zipSync({ 'in/inner.zip': inner, 'seat.3mf': mf, 'notes.txt': strToU8('hi') });
		const p = probeBytes('outer.zip', outer);
		expect(p.kind).toBe('zip');
		expect(p.children?.map((c) => [c.name, c.kind])).toEqual([
			['inner.zip', 'zip'],
			['seat.3mf', '3mf']
		]);
		const built = buildPlan([{ fileId: 1, probe: p }]);
		expect(built.items.map((i) => i.status)).toEqual(['ok', 'ok']);
		expect(probeBytes('seat.3mf', mf).kind).toBe('3mf');
		expect(probeBytes('g.pdf', strToU8('%PDF-1.7 x')).kind).toBe('pdf');
		expect(probeBytes('cube.step', step).kind).toBe('step');
		expect(probeBytes('cube.step', strToU8('hello')).kind).toBe('unknown');
		expect(probeBytes('broken.zip', Uint8Array.from([0x50, 0x4b, 1, 2, 3])).kind).toBe('unknown');
	});

	it('merges loose STEP files and zips into one zip, first name wins', () => {
		const z = zipSync({ 'f/a.step': step, 'f/readme.txt': strToU8('x') });
		const r = mergeStepSources([
			{ name: 'z.zip', bytes: z, loose: false },
			{ name: 'b.step', bytes: step, loose: true },
			{ name: 'b.step', bytes: step, loose: true }
		]);
		expect(r.files).toBe(2);
		expect(r.skipped).toEqual(['b.step']);
	});
});
