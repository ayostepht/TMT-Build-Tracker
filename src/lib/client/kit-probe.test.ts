import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '#lib/domain/kit-import.ts';
import { findGuidePdfInBlob, mergeStepSources, probeBlob, probeBytes } from './kit-probe.ts';

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

describe('sliced projects and big files', () => {
	const model = {
		'[Content_Types].xml': strToU8('<x/>'),
		'3D/3dmodel.model': strToU8('<model/>')
	};
	const header = '<config><header><header_item key="a" value="b"/></header></config>';
	it('probeBytes flags G-code and listed plates, not a bare slice_info header', () => {
		const sliced = zipSync({ ...model, 'Metadata/plate_1.gcode': strToU8('G1') });
		expect(probeBytes('a.gcode.3mf', sliced).sliced).toEqual({ plates: 1 });
		const listed = zipSync({
			...model,
			'Metadata/slice_info.config': strToU8('<config><plate/><plate/></config>')
		});
		expect(probeBytes('b.3mf', listed).sliced).toEqual({ plates: 2 });
		const bare = zipSync({ ...model, 'Metadata/slice_info.config': strToU8(header) });
		expect(probeBytes('c.3mf', bare).sliced).toBeUndefined();
		expect(probeBytes('d.3mf', zipSync(model)).sliced).toBeUndefined();
	});

	it('probeBlob reads only the directory and the entries it needs (same answer as probeBytes)', async () => {
		const zip = zipSync({
			...model,
			'Metadata/plate_1.gcode': new Uint8Array(3_000_000).fill(71),
			'Metadata/slice_info.config': strToU8('<config><plate/></config>'),
			'Auxiliaries/g.pdf': strToU8('%PDF-1.4 x')
		});
		const slices: number[] = [];
		const blob = new Blob([zip as BlobPart]);
		const spy = Object.assign(blob, {
			name: 'big.gcode.3mf',
			slice: (a?: number, b?: number) => {
				slices.push((b ?? blob.size) - (a ?? 0));
				return Blob.prototype.slice.call(blob, a, b);
			}
		});
		const p = await probeBlob(spy);
		expect(p.kind).toBe('3mf');
		expect(p.sliced).toEqual({ plates: 1 });
		expect(p.entries).toContain('Metadata/plate_1.gcode');
		expect(Math.max(...slices)).toBeLessThan(100_000); // never the 3 MB G-code, never the whole file
		const g = await findGuidePdfInBlob(spy);
		expect(g?.name).toBe('g.pdf');
	});

	it('opens a zip with a 500 MB entry without reading it', { timeout: 120_000 }, async () => {
		const { openAsBlob } = await import('node:fs');
		const { mkdirSync } = await import('node:fs');
		const dir = `data/scratch/probe-${Date.now()}`;
		mkdirSync(dir, { recursive: true });
		const path = `${dir}/big.gcode.3mf`;
		const { createWriteStream, unlinkSync } = await import('node:fs');
		const { Zip, ZipPassThrough } = await import('fflate');
		const out = createWriteStream(path);
		const done = new Promise<void>((r) => out.on('finish', () => r()));
		const z = new Zip((e, c, final) => {
			if (e) throw e;
			out.write(c);
			if (final) out.end();
		});
		const g = new ZipPassThrough('Metadata/plate_1.gcode');
		z.add(g);
		const mb = new Uint8Array(1 << 20).fill(71);
		for (let i = 0; i < 500; i++) {
			g.push(mb, false);
			await new Promise((r) => setImmediate(r));
		}
		g.push(new Uint8Array(0), true);
		for (const [n, d] of Object.entries(model)) {
			const f = new ZipPassThrough(n);
			z.add(f);
			f.push(d, true);
		}
		z.end();
		await done;
		try {
			const blob = Object.assign(await openAsBlob(path), { name: 'big.gcode.3mf' });
			const before = process.memoryUsage().rss;
			const p = await probeBlob(blob);
			const grew = (process.memoryUsage().rss - before) / 1048576;
			expect(blob.size).toBeGreaterThan(500 * 1048576);
			expect(p.kind).toBe('3mf');
			expect(p.sliced).toEqual({ plates: 1 });
			expect(grew).toBeLessThan(60);
		} finally {
			unlinkSync(path);
		}
	});
});
