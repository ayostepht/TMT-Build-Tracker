import { describe, expect, it } from 'vitest';
import {
	buildPlan,
	guessOffset,
	kitChecklist,
	kitReadiness,
	makeSteps,
	plateCount,
	slicedItems,
	slicedPlates,
	type FileKind,
	type KitStatusDto,
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
			probe('loose.step', 'step'),
			probe('notes.txt', 'unknown')
		);
		expect(p.items.find((i) => i.name === 'notes.txt')?.status).toBe('unknown');
		expect(makeSteps(p).map((s) => s.id)).toEqual(['model', 'print:4', 'print:2', 'guide']);
		expect(makeSteps(p)[0].title).toBe('3D chair (2 STEP files)');
		expect(makeSteps(p)[0].itemIds).toEqual(['3', '5']);
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

describe('kit readiness and checklist', () => {
	const kit = (over: Partial<KitStatusDto> = {}): KitStatusDto => ({
		model: {
			version: 'abcdef012345',
			createdAt: null,
			source: 'kit pack',
			rendered: 37,
			total: 40,
			placed: 37,
			unplaced: [],
			missing: []
		},
		print: {
			withGeometry: 40,
			total: 40,
			missing: [],
			paintedFaces: 1,
			withSettings: 40,
			sources: ['kit pack']
		},
		guide: { uploaded: 0, pages: 0, mapped: 0 },
		...over
	});

	it('kit pack install (no guide) is ready', () => {
		expect(kitReadiness(kit()).state).toBe('ready');
	});
	it('missing print geometry for a part is partial', () => {
		const r = kitReadiness(kit({ print: { ...kit().print, withGeometry: 39, missing: ['Seat'] } }));
		expect(r.state).toBe('partial');
		expect(r.note).toMatch(/1 part without print geometry/);
	});
	it('no model is partial with a no 3D preview note', () => {
		const r = kitReadiness(kit({ model: null }));
		expect(r.state).toBe('partial');
		expect(r.note).toMatch(/no 3D preview/);
	});
	it('installing wins', () => {
		const r = kitReadiness(kit({ model: null, installing: true, installMessage: 'Installing…' }));
		expect(r).toEqual({ state: 'installing', note: 'Installing…' });
	});
	it('nothing at all is missing', () => {
		expect(
			kitReadiness(kit({ model: null, print: { ...kit().print, withGeometry: 0 } })).state
		).toBe('missing');
	});
	it('the absent guide is informational and parts without 3D are a neutral note', () => {
		const rows = kitChecklist(kit());
		expect(rows.map((r) => r.id)).toEqual(['model', 'print', 'guide']);
		const guide = rows.find((r) => r.id === 'guide')!;
		expect(guide.state).toBe('info');
		expect(guide.lines[0]).toMatch(/^Optional: MakeGood's maker guide is not included/);
		expect(guide.link?.href).toBeTruthy();
		const model = rows.find((r) => r.id === 'model')!;
		expect(model.state).toBe('ok');
		expect(model.hints).toEqual([]);
		expect(model.notes).toEqual(['3 parts have no 3D preview: drawn as stand-ins or no STEP']);
	});
	it('a part the kit places but the model lacks is a hint, not a note', () => {
		const m = { ...kit().model!, rendered: 36, missing: ['Seat'] };
		const row = kitChecklist(kit({ model: m }))[0];
		expect(row.state).toBe('partial');
		expect(row.notes[0]).toMatch(/^3 parts/);
	});
});

describe('hardware GLB drops', () => {
	it('is not needed and skipped', () => {
		const p = buildPlan([
			{ fileId: 1, probe: { name: 'hardware.glb', size: 10, kind: 'unknown' } }
		]);
		expect(p.items[0].status).toBe('unknown');
		expect(p.items[0].note).toBe('Not needed: the app includes the hardware');
		expect(makeSteps(p)).toEqual([]);
	});
});

describe('sliced projects', () => {
	const gcode = ['Metadata/plate_1.gcode', 'Metadata/plate_1.gcode.md5', 'Metadata/plate_2.gcode'];
	it('slicedPlates: G-code or listed plates make a sliced project, a bare header does not', () => {
		expect(slicedPlates(MF)).toBeNull();
		expect(slicedPlates([...MF, ...gcode])).toBe(2);
		const header = '<config><header><header_item key="a" value="b"/></header></config>';
		expect(slicedPlates(MF, header)).toBeNull();
		expect(slicedPlates(MF, '<config><plate><metadata/></plate><plate/></config>')).toBe(2);
	});
	it('goes to the build plates by default, never silently to the kit', () => {
		const p = plan(probe('x.gcode.3mf', '3mf', [...MF, ...gcode], { sliced: { plates: 24 } }));
		const feeds = p.items[0].feeds;
		expect(feeds.map((f) => [f.kind, f.enabled])).toEqual([
			['sliced', true],
			['print', false]
		]);
		expect(feeds[0].label).toBe("Sliced file: use it for this build's plates (24 sliced plates)");
		expect(makeSteps(p)).toEqual([]);
		expect(slicedItems(p)).toHaveLength(1);
	});
	it('an admin can still choose kit print geometry explicitly', () => {
		const p = plan(probe('x.gcode.3mf', '3mf', MF, { sliced: { plates: 1 } }));
		p.items[0].feeds.find((f) => f.kind === 'print')!.enabled = true;
		expect(makeSteps(p).map((s) => s.kind)).toEqual(['print']);
	});
	it('an unsliced 3MF is still print geometry', () => {
		const p = plan(probe('x.3mf', '3mf', MF));
		expect(p.items[0].feeds.map((f) => f.kind)).toEqual(['print']);
	});
});
