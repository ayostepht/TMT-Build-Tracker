import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { describeActivity } from '#lib/domain/activity.ts';
import {
	SAFETY_STEP_KEY,
	checkItemKey,
	filterSteps,
	hwItemKey,
	readyToAssemble,
	resolveItem
} from '#lib/domain/assembly.ts';
import { ASSEMBLY_SECTIONS } from '#lib/domain/assembly.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	builds,
	member,
	organization,
	templateAssemblySteps,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { setAssemblyItem } from './assembly';
import { setVariant, setPartStatus } from './actions';
import { markHandedOff, updateHandoff } from './handoff';
import { createBuild } from './create';
import { onBuildEvents } from './test-helpers';
import { loadBuildView } from './view';

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-asm-')), 'unused.db');

let db: Db;
let templateId: string;
let buildId: string;

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: 'org1', name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const u of ['owner', 'editor', 'viewer', 'outsider'])
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test` })
			.run();
	for (const [u, role] of [
		['owner', 'owner'],
		['editor', 'editor'],
		['viewer', 'viewer']
	])
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: 'org1', userId: u, role, createdAt: new Date() })
			.run();
	buildId = createBuild(
		db,
		{ organizationId: 'org1', templateId, designId: null, name: 'Chair' },
		'owner'
	);
});

const tmt = templateSeeds[0];

describe('seed assembly steps', () => {
	const steps = tmt.assemblySteps ?? [];
	it('has about 20 steps with unique keys in known sections', () => {
		expect(steps.length).toBeGreaterThanOrEqual(15);
		expect(steps.length).toBeLessThanOrEqual(24);
		expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length);
		for (const s of steps) {
			expect(s.key).not.toContain(':');
			expect(ASSEMBLY_SECTIONS[s.key.split('.')[0]]).toBeTruthy();
		}
		expect(steps.at(-1)!.key).toBe(SAFETY_STEP_KEY);
	});

	it('references existing parts, hardware, guide pages and variant options', () => {
		const slugs = new Set(tmt.parts.map((p) => p.slug));
		const hw = new Set(tmt.hardware.map((h) => h.name));
		const pages = new Set(tmt.guidePages.map((g) => g.page));
		for (const s of steps) {
			for (const p of s.parts ?? []) expect(slugs.has(p), `${s.key}: part ${p}`).toBe(true);
			for (const h of s.hardware ?? [])
				expect(hw.has(h.name), `${s.key}: hardware ${h.name}`).toBe(true);
			if (s.guidePage !== undefined) expect(pages.has(s.guidePage), `${s.key}: page`).toBe(true);
			const keys = (s.checks ?? []).map((c) => c.key);
			expect(new Set(keys).size).toBe(keys.length);
			if (s.when) {
				const g = tmt.variantGroups!.find((x) => x.key === s.when!.group);
				expect(
					g?.options.some((o) => o.key === s.when!.option),
					`${s.key}: when`
				).toBe(true);
			}
		}
	});

	it('is stored on the template and reconciling again changes nothing', () => {
		const n = db
			.select()
			.from(templateAssemblySteps)
			.where(eq(templateAssemblySteps.templateId, templateId))
			.all();
		expect(n).toHaveLength(steps.length);
		expect(seedTemplates(db, templateSeeds).updated).toEqual([]);
	});
});

describe('variant filtering', () => {
	const keys = () => loadBuildView(db, buildId, 'owner')!.assembly.steps.map((s) => s.key);

	it('shows the default variants', () => {
		const k = keys();
		expect(k).toContain('frame.footrest-one');
		expect(k).not.toContain('frame.footrest-two');
		expect(k).toContain('seat.cushions');
		expect(k).not.toContain('seat.bucket');
		expect(k).toContain('extras.headrest');
		expect(k).toContain('extras.push-handle');
	});

	it('follows the chosen options and filters step parts to active ones', () => {
		setVariant(db, buildId, 'owner', { group: 'footrest', option: 'two-piece' });
		setVariant(db, buildId, 'owner', { group: 'seat', option: 'bucket-seat' });
		setVariant(db, buildId, 'owner', { group: 'headrest', option: 'none' });
		setVariant(db, buildId, 'owner', { group: 'rear-caster', option: 'mcmaster' });
		const v = loadBuildView(db, buildId, 'owner')!;
		const k = v.assembly.steps.map((s) => s.key);
		expect(k).toContain('frame.footrest-two');
		expect(k).not.toContain('frame.footrest-one');
		expect(k).toContain('seat.bucket');
		expect(k).not.toContain('seat.cushions');
		expect(k).not.toContain('extras.headrest');
		const rear = v.assembly.steps.find((s) => s.key === 'frame.rear-casters')!;
		expect(rear.parts).toContain('rear-caster-left-mcmaster');
		expect(rear.parts).not.toContain('rear-caster-left');
		const wheels = v.assembly.steps.find((s) => s.key === 'wheels.tires')!;
		expect(wheels.parts).toContain('rims-1-4');
		expect(wheels.parts).not.toContain('rims-small-1-4');
	});

	it('filterSteps drops a step whose parts are all inactive', () => {
		const rows = [
			{
				key: 'extras.x',
				title: 'x',
				description: '',
				guidePage: null,
				parts: ['a'],
				hardware: [],
				checks: [],
				when: null
			}
		];
		expect(filterSteps(rows, {}, new Set())).toEqual([]);
		expect(filterSteps(rows, {}, new Set(['a']))).toHaveLength(1);
	});
});

describe('setAssemblyItem', () => {
	const view = () => loadBuildView(db, buildId, 'owner')!;

	it('ticks a step, a check and a hardware item, with who and when', () => {
		const step = view().assembly.steps.find((s) => s.key === 'frame.rear-casters')!;
		const events = onBuildEvents(buildId);
		setAssemblyItem(db, buildId, 'editor', step.key, { done: true });
		setAssemblyItem(db, buildId, 'editor', checkItemKey(step.key, step.checks[0].key), {
			done: true
		});
		setAssemblyItem(db, buildId, 'owner', hwItemKey(step.key, 'Casters'), { done: true });
		const v = view();
		expect(v.assembly.items[step.key]).toMatchObject({
			done: true,
			doneBy: 'editor',
			doneByName: 'User editor'
		});
		expect(v.assembly.items[step.key].doneAt).toBeTruthy();
		expect(v.assembly.items[checkItemKey(step.key, step.checks[0].key)].done).toBe(true);
		expect(v.assembly.items[hwItemKey(step.key, 'Casters')].doneBy).toBe('owner');
		expect(events.map((e) => e.type)).toEqual(['changed', 'changed', 'changed']);
		const rows = db
			.select()
			.from(activity)
			.where(eq(activity.buildId, buildId))
			.all()
			.filter((a) => a.kind === 'assembly.item');
		expect(rows).toHaveLength(3);
		const names = { parts: v.parts, filaments: v.filaments, members: v.members, runs: v.runs };
		const sentence = describeActivity(
			{
				id: 'x',
				userId: 'editor',
				userName: 'Eddie',
				kind: 'assembly.item',
				payload: rows[0].payload,
				at: ''
			},
			names
		);
		expect(sentence).toBe('Eddie marked step "Rear caster mounts" done');
		expect(
			describeActivity(
				{
					id: 'y',
					userId: null,
					userName: 'Eddie',
					kind: 'assembly.item',
					payload: rows[1].payload,
					at: ''
				},
				names
			)
		).toContain('ticked');
	});

	it('unticking clears who and when; a note alone keeps the tick', () => {
		setAssemblyItem(db, buildId, 'editor', 'frame.handle', { done: true, note: 'tight fit' });
		setAssemblyItem(db, buildId, 'editor', 'frame.handle', { note: 'tight fit, sanded' });
		expect(view().assembly.items['frame.handle']).toMatchObject({
			done: true,
			note: 'tight fit, sanded'
		});
		setAssemblyItem(db, buildId, 'owner', 'frame.handle', { done: false });
		const it = view().assembly.items['frame.handle'];
		expect(it).toMatchObject({
			done: false,
			doneBy: null,
			doneAt: null,
			note: 'tight fit, sanded'
		});
	});

	it('rejects viewers (403), outsiders (404) and unknown or inactive items (400)', () => {
		const code = (fn: () => void) => {
			try {
				fn();
			} catch (e) {
				return (e as ApiError).status;
			}
			return 0;
		};
		expect(code(() => setAssemblyItem(db, buildId, 'viewer', 'frame.handle', { done: true }))).toBe(
			403
		);
		expect(
			code(() => setAssemblyItem(db, buildId, 'outsider', 'frame.handle', { done: true }))
		).toBe(404);
		expect(code(() => setAssemblyItem(db, buildId, 'owner', 'nope', { done: true }))).toBe(400);
		expect(
			code(() => setAssemblyItem(db, buildId, 'owner', 'frame.handle:check:nope', { done: true }))
		).toBe(400);
		expect(
			code(() => setAssemblyItem(db, buildId, 'owner', 'frame.footrest-two', { done: true }))
		).toBe(400);
		expect(code(() => setAssemblyItem(db, buildId, 'owner', 'frame.handle', {}))).toBe(400);
		expect(code(() => setAssemblyItem(db, buildId, 'owner', 'frame.handle', { done: 'yes' }))).toBe(
			400
		);
		expect(view().assembly.items).toEqual({});
	});
});

describe('resolveItem and readiness', () => {
	it('resolves step, check and hardware keys', () => {
		const steps = loadBuildView(db, buildId, 'owner')!.assembly.steps;
		expect(resolveItem(steps, 'frame.handle')?.kind).toBe('step');
		expect(resolveItem(steps, 'frame.handle:check:flat')?.kind).toBe('check');
		expect(resolveItem(steps, 'frame.rear-casters:hw:Casters')?.kind).toBe('hw');
		expect(resolveItem(steps, 'frame.rear-casters:hw:Nope')).toBeNull();
		expect(resolveItem(steps, 'frame.handle:bogus:flat')).toBeNull();
	});

	it('is ready only when every active part is printed', () => {
		let v = loadBuildView(db, buildId, 'owner')!;
		expect(readyToAssemble(v).ready).toBe(false);
		for (const p of v.parts) setPartStatus(db, buildId, 'owner', p.slug, { status: 'Printed' });
		v = loadBuildView(db, buildId, 'owner')!;
		expect(readyToAssemble(v)).toMatchObject({ ready: true, missing: [] });
	});
});

describe('handoff', () => {
	it('saves the form (editors only) and marks the build done', () => {
		expect(() => updateHandoff(db, buildId, 'viewer', { notes: 'x' })).toThrow(ApiError);
		updateHandoff(db, buildId, 'editor', {
			recipientName: 'Sam',
			organization: 'City Clinic',
			contact: 'sam@example.test',
			safetyChecked: true
		});
		let v = loadBuildView(db, buildId, 'owner')!;
		expect(v.handoff).toMatchObject({
			recipientName: 'Sam',
			contact: 'sam@example.test',
			safetyChecked: true
		});
		expect(v.build.phase).not.toBe('done');
		markHandedOff(db, buildId, 'editor', { handedOffOn: '2026-11-03' });
		v = loadBuildView(db, buildId, 'owner')!;
		expect(v.build.phase).toBe('done');
		expect(v.handoff?.handedOffOn).toBe('2026-11-03');
		expect(v.handoff?.organization).toBe('City Clinic');
		const kinds = db
			.select()
			.from(activity)
			.where(eq(activity.buildId, buildId))
			.all()
			.map((a) => a.kind);
		expect(kinds).toContain('build.handoff');
		const a = db.select().from(activity).where(eq(activity.kind, 'build.handoff')).get()!;
		expect(
			describeActivity(
				{ id: 'z', userId: 'editor', userName: 'Eddie', kind: a.kind, payload: a.payload, at: '' },
				v
			)
		).toBe('Eddie marked the chair as handed off to City Clinic');
		expect(db.select({ p: builds.phase }).from(builds).where(eq(builds.id, buildId)).get()!.p).toBe(
			'done'
		);
	});

	it('rejects bad input and defaults the date to today', () => {
		expect(() => updateHandoff(db, buildId, 'owner', { handedOffOn: '03/11/2026' })).toThrow(
			ApiError
		);
		expect(() => updateHandoff(db, buildId, 'owner', {})).toThrow(ApiError);
		expect(() => markHandedOff(db, buildId, 'outsider', {})).toThrow(ApiError);
		markHandedOff(db, buildId, 'owner', {});
		expect(loadBuildView(db, buildId, 'owner')!.handoff?.handedOffOn).toMatch(
			/^\d{4}-\d{2}-\d{2}$/
		);
	});
});
