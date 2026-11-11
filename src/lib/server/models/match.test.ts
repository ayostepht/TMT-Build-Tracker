import { describe, expect, it } from 'vitest';
import { matchParts, normalizeStepName, wantedFiles, type MatchPart } from './match';

const part = (slug: string, sourceFile: string, files: string[] = []): MatchPart => ({
	slug,
	sourceFile,
	components: files.map((file) => ({ file }))
});

describe('normalizeStepName', () => {
	it('ignores folders, case, extension and spacing', () => {
		expect(normalizeStepName('STEP FILES/3DTMT  H Seat Center REV A.STEP')).toBe(
			'3dtmt h seat center rev a'
		);
		expect(normalizeStepName('x/y/Foo.stp')).toBe('foo');
		expect(normalizeStepName('MG_HEADREST SCREW REV B')).toBe('mg_headrest screw rev b');
	});
	it('keeps dots that are not an extension', () => {
		expect(normalizeStepName('TMT 3D Seat 280, With Slots REV 05.1.STEP')).toBe(
			'tmt 3d seat 280, with slots rev 05.1'
		);
	});
});

describe('matchParts', () => {
	const entries = [
		'STEP FILES/',
		'STEP FILES/3DTMT H SEAT CENTER REV A.STEP',
		'STEP FILES/mg_2 part cushion top.STEP',
		'STEP FILES/MG_HEADREST SCREW REV B',
		'STEP FILES/3DTMT J FRAME PIN REV A.STEP',
		'STEP FILES/3DTMT 4MM WASHER.step',
		'STEP FILES/3DTMT O WHEEL RIM REV B.STEP',
		'STEP FILES/OBSOLETE/3DTMT H SEAT CENTER REV A.STEP',
		'STEP FILES/OBSOLETE/OLD THING.step',
		'STEP FILES/TMT 3D TOP ASSEMBLY - RENDERING ONLY.step',
		'STEP FILES/readme.txt',
		'__MACOSX/STEP FILES/._3DTMT H SEAT CENTER REV A.STEP'
	];
	const parts = [
		part('seat-center', '3DTMT H SEAT CENTER REV A.STEP'),
		part('cushion-top', 'MG_2 PART CUSHION TOP.step'),
		part('headrest-bolt', 'MG_HEADREST SCREW REV B'),
		part('connectors', 'Multiple files, see checklist', [
			'3DTMT J FRAME PIN REV A.STEP',
			'3DTMT 4MM WASHER.step',
			'3DTMT N WHEEL BLOCK REV A.STEP'
		]),
		part('rims-1-4', '3DTMT O WHEEL RIM REV B.STEP'),
		part('rims-2-3', '3DTMT O WHEEL RIM REV B.STEP'),
		part('lid', 'MakerWorld 3mf only (not in STEP pack)')
	];
	const plan = matchParts(parts, entries);
	const byslug = (s: string) => plan.parts.find((p) => p.slug === s)!;

	it('matches case- and extension-insensitively, including files without extension', () => {
		expect(byslug('seat-center').entries).toEqual(['STEP FILES/3DTMT H SEAT CENTER REV A.STEP']);
		expect(byslug('cushion-top').entries).toEqual(['STEP FILES/mg_2 part cushion top.STEP']);
		expect(byslug('headrest-bolt').entries).toEqual(['STEP FILES/MG_HEADREST SCREW REV B']);
	});
	it('ignores the OBSOLETE folder even when the name is identical', () => {
		expect(plan.files.some((f) => f.entry.includes('OBSOLETE'))).toBe(false);
		expect(plan.obsolete).toEqual([
			'STEP FILES/OBSOLETE/3DTMT H SEAT CENTER REV A.STEP',
			'STEP FILES/OBSOLETE/OLD THING.step'
		]);
	});
	it('merges the component files of connectors and reports the missing one', () => {
		expect(byslug('connectors').entries).toEqual([
			'STEP FILES/3DTMT J FRAME PIN REV A.STEP',
			'STEP FILES/3DTMT 4MM WASHER.step'
		]);
		expect(byslug('connectors').missing).toEqual(['3DTMT N WHEEL BLOCK REV A.STEP']);
	});
	it('lets two parts share one file', () => {
		const rim = plan.files.find((f) => f.entry.includes('WHEEL RIM'))!;
		expect(rim.slugs).toEqual(['rims-1-4', 'rims-2-3']);
	});
	it('skips the assembly and reports unknown files and unmatched parts', () => {
		expect(plan.assemblies).toEqual(['STEP FILES/TMT 3D TOP ASSEMBLY - RENDERING ONLY.step']);
		expect(plan.unknown).toEqual(['STEP FILES/readme.txt']);
		expect(byslug('lid').entries).toEqual([]);
		expect(byslug('lid').missing).toHaveLength(1);
	});
	it('prefers the shallowest entry when names repeat', () => {
		const p = matchParts([part('a', 'Foo.step')], ['x/y/Foo.step', 'Foo.STEP']);
		expect(p.parts[0].entries).toEqual(['Foo.STEP']);
	});
});

describe('wantedFiles', () => {
	it('uses component files when present, else sourceFile', () => {
		expect(wantedFiles(part('a', 'A.step'))).toEqual(['A.step']);
		expect(wantedFiles(part('c', 'Multiple files', ['x.step', 'x.step', 'y.step']))).toEqual([
			'x.step',
			'y.step'
		]);
	});
});

describe('STEP zip entry caps', () => {
	it('refuses an entry that declares a huge size without allocating it', async () => {
		const { entryFilter, MAX_ENTRY_BYTES } = await import('./convert-core');
		const f = entryFilter('a.step', { used: 0 });
		expect(f({ name: 'other.step', originalSize: 2 ** 40 })).toBe(false);
		expect(f({ name: 'a.step', originalSize: 10 })).toBe(true);
		expect(() =>
			entryFilter('a.step', { used: 0 })({ name: 'a.step', originalSize: MAX_ENTRY_BYTES + 1 })
		).toThrow(/over the 512 MB limit/);
	});

	it('refuses once the cumulative size passes the cap', async () => {
		const { entryFilter } = await import('./convert-core');
		const budget = { used: 0 };
		expect(entryFilter('a', budget, 100, 150)({ name: 'a', originalSize: 100 })).toBe(true);
		expect(() => entryFilter('b', budget, 100, 150)({ name: 'b', originalSize: 100 })).toThrow(
			/uncompressed/
		);
	});

	it('stops a crafted zip declaring 4 GB before fflate allocates', async () => {
		const { zipSync, unzipSync } = await import('fflate');
		const { entryFilter } = await import('./convert-core');
		const z = zipSync({ 'big.step': new Uint8Array(10) }, { level: 0 });
		// Patch the declared uncompressed size (central directory + local header) to 4 GB - 1.
		const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
		for (let i = 0; i < z.length - 4; i++) {
			const sig = dv.getUint32(i, true);
			if (sig === 0x02014b50) dv.setUint32(i + 24, 0xfffffffe, true);
			if (sig === 0x04034b50) dv.setUint32(i + 22, 0xfffffffe, true);
		}
		expect(() => unzipSync(z, { filter: entryFilter('big.step', { used: 0 }) })).toThrow(
			/over the 512 MB limit/
		);
	});
});
