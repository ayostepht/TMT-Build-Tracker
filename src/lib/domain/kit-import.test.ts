import { describe, expect, it } from 'vitest';
import {
	buildPlan,
	guessOffset,
	makeSteps,
	plateCount,
	type FileKind,
	type Probe
} from '#lib/domain/kit-import.ts';

const probe = (name: string, kind: FileKind, entries?: string[], extra: Partial<Probe> = {}) =>
	({ name, kind, size: 1000, entries, ...extra }) as Probe;
const MF = [
	'[Content_Types].xml',
	'3D/3dmodel.model',
	'Metadata/plate_1.json',
	'Metadata/plate_2.png'
];
const plan = (...ps: Probe[]) => buildPlan(ps.map((probe, i) => ({ fileId: i + 1, probe })));
const labels = (p: ReturnType<typeof plan>) =>
	p.items.map((i) => i.feeds.filter((f) => f.enabled).map((f) => f.label));

describe('buildPlan', () => {
	it('sends a STEP zip to the 3D chair and counts the STEP files', () => {
		const p = plan(
			probe('STEP FILES.zip', 'zip', ['STEP/a.step', 'STEP/b.STP', '__MACOSX/._a.step', 'STEP/'])
		);
		expect(labels(p)).toEqual([['3D chair (2 STEP files)']]);
		expect(makeSteps(p).map((s) => s.title)).toEqual(['3D chair (2 STEP files)']);
	});

	it('reads a 3MF profile: print geometry with plates, guide when it holds a PDF', () => {
		const p = plan(
			probe('profile.3mf', '3mf', MF),
			probe('seat.3mf', '3mf', [...MF, 'Auxiliaries/Assembly Guide/guide.pdf'], { pdfPages: 28 })
		);
		expect(labels(p)).toEqual([
			['Print geometry (profile with 2 plates)'],
			['Print geometry (profile with 2 plates)', 'Guide (28-page PDF inside this 3MF)']
		]);
	});

	it('plain 3MF without plate data', () => {
		expect(plateCount(['3D/3dmodel.model'])).toBe(0);
		expect(labels(plan(probe('x.3mf', '3mf', ['3D/3dmodel.model'])))[0][0]).toMatch(
			/no plate data/
		);
	});

	it('handles a mixed drop and orders the steps', () => {
		const p = plan(
			probe('guide.pdf', 'pdf', undefined, { pdfPages: 12 }),
			probe('harness.zip', 'zip', ['a.3mf', 'b.3mf'], { size: 500 }),
			probe('chair.zip', 'zip', ['x.step']),
			probe('profile.3mf', '3mf', MF, { size: 9000 }),
			probe('hw.glb', 'glb'),
			probe('loose.step', 'step'),
			probe('notes.txt', 'unknown')
		);
		expect(p.items.find((i) => i.name === 'notes.txt')?.status).toBe('unknown');
		expect(makeSteps(p).map((s) => s.id)).toEqual([
			'model',
			'print:4',
			'print:2',
			'hardware',
			'guide'
		]);
		expect(makeSteps(p)[0].title).toBe('3D chair (2 STEP files)');
		expect(makeSteps(p)[0].itemIds).toEqual(['3', '6']);
	});

	it('flags a zip with a mix of STEP and 3MF files for both targets', () => {
		const p = plan(probe('kit.zip', 'zip', ['a.step', 'b.3mf']));
		expect(labels(p)[0]).toEqual(['3D chair (1 STEP file)', 'Print geometry (zip of 1 3MF file)']);
	});

	it('looks one level into nested zips', () => {
		const inner = probe('steps.zip', 'zip', ['p.step', 'q.step'], { entry: 'sub/steps.zip' });
		const outer = probe('outer.zip', 'zip', ['sub/steps.zip', 'readme.txt'], { children: [inner] });
		const p = plan(outer);
		expect(p.items.map((i) => [i.id, i.status, i.name])).toEqual([
			['1', 'container', 'outer.zip'],
			['1/sub/steps.zip', 'ok', 'outer.zip > steps.zip']
		]);
		expect(p.items[1].entryPath).toEqual(['sub/steps.zip']);
		expect(makeSteps(p)[0].title).toBe('3D chair (2 STEP files)');
	});

	it('finds a guide inside a 3MF in a zip', () => {
		const child = probe('seat.3mf', '3mf', [...MF, 'Auxiliaries/g.pdf'], {
			entry: 'seat.3mf',
			pdfPages: 5
		});
		const p = plan(probe('pack.zip', 'zip', ['seat.3mf'], { children: [child] }));
		expect(labels(p)[0]).toEqual([
			'Print geometry (zip of 1 3MF file)',
			'Guide (5-page PDF inside seat.3mf)'
		]);
	});

	it('switches off the same file dropped twice', () => {
		const p = plan(probe('a.3mf', '3mf', MF), probe('a.3mf', '3mf', MF));
		expect(p.items[1].status).toBe('duplicate');
		expect(makeSteps(p)).toHaveLength(1);
	});

	it('keeps one guide: a PDF beats a 3MF, and warns about repeated STEP names', () => {
		const p = plan(
			probe('a.3mf', '3mf', [...MF, 'Auxiliaries/g.pdf']),
			probe('g.pdf', 'pdf'),
			probe('s1.zip', 'zip', ['x.step']),
			probe('s2.zip', 'zip', ['x.step'], { size: 2 })
		);
		const guides = p.items.flatMap((i) => i.feeds.filter((f) => f.kind === 'guide'));
		expect(guides.map((g) => g.enabled)).toEqual([false, true]);
		expect(makeSteps(p).filter((s) => s.kind === 'guide')[0].itemIds).toEqual(['2']);
		expect(p.warnings[0]).toMatch(/more than one source/);
	});

	it('flags an empty zip as unknown', () => {
		expect(plan(probe('x.zip', 'zip', ['a.txt'])).items[0].status).toBe('unknown');
	});
});

describe('guessOffset', () => {
	it('uses the most common difference, else 3', () => {
		expect(guessOffset([])).toBe(3);
		expect(
			guessOffset([
				{ page: 8, pdfPage: 3 },
				{ page: 9, pdfPage: 4 },
				{ page: 12, pdfPage: 1 },
				{ page: 5, pdfPage: null }
			])
		).toBe(5);
	});
});
