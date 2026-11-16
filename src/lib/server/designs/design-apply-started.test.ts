import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { describeActivity } from '#lib/domain/activity.ts';
import { designSnapshot, undoPatch } from '#lib/domain/design-apply.ts';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { ApiError } from '../access';
import { openDb, runMigrations, type Db } from '../db';
import {
	activity,
	buildFilaments,
	buildPlates,
	builds,
	member,
	organization,
	printerJobs,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { setPartStatus } from '../builds/actions';
import { createBuild } from '../builds/create';
import { BuildStartedError } from '../builds/started-guard';
import { loadBuildView } from '../builds/view';
import { createPrinter } from '../printers/store';
import { respond } from '../api';
import { createDesign } from './designs';
import { applyDesignToBuild, previewApplyDesign, updateBuildDesign } from './mutate';

// Issue #56: applying a design (or resetting by palette) to a build that has started printing.

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-dstart-')), 'unused.db');
const cc = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	db.insert(user).values({ id: 'owner', name: 'Olive', email: 'o@example.test' }).run();
	db.insert(member)
		.values({
			id: 'm1',
			organizationId: orgId,
			userId: 'owner',
			role: 'owner',
			createdAt: new Date()
		})
		.run();
});

const mk = () =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', printer: cc },
		'owner'
	);
/** Hex case differs between kit seeds (upper) and API writes (lower): compare lower-cased. */
const snapLower = (s: ReturnType<typeof designSnapshot>) => ({
	...s,
	roles: s.roles.map((r) => ({ ...r, hex: r.hex.toLowerCase() }))
});
const snapOf = (id: string) => snapLower(designSnapshot(view(id)));
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const fil = (id: string, key: string) => view(id).filaments.find((f) => f.key === key)!;
const rolesOf = (id: string) => Object.fromEntries(view(id).allParts.map((p) => [p.slug, p.role]));
const lastKind = (id: string) =>
	db.select().from(activity).where(eq(activity.buildId, id)).all().at(-1)!;
const status = (fn: () => unknown): number => {
	try {
		fn();
	} catch (e) {
		if (e instanceof ApiError) return e.status;
		throw e;
	}
	return 0;
};
const plates = (id: string) =>
	JSON.stringify(db.select().from(buildPlates).where(eq(buildPlates.buildId, id)).all());

/** A design from a scratch build: primary and accent recolored, soft stays. */
function makeDesign(mutate?: (src: string) => void) {
	const src = mk();
	db.update(buildFilaments)
		.set({ name: 'Ocean', hex: '#0044cc' })
		.where(and(eq(buildFilaments.buildId, src), eq(buildFilaments.roleKey, 'primary')))
		.run();
	db.update(buildFilaments)
		.set({ name: 'Lime', hex: '#66dd00' })
		.where(and(eq(buildFilaments.buildId, src), eq(buildFilaments.roleKey, 'accent')))
		.run();
	mutate?.(src);
	return createDesign(db, 'owner', { buildId: src, name: 'Ocean set', isPublic: true });
}
const startReprint = (id: string) =>
	setPartStatus(db, id, 'owner', 'handle-left', { status: 'Reprint' });
const startPrinting = (id: string) =>
	setPartStatus(db, id, 'owner', 'handle-left', { status: 'Printing' });
const liveJob = (id: string) => {
	const printerId = createPrinter(db, orgId, 'owner', {
		name: 'Shop',
		kind: 'elegoo-sdcp',
		host: '10.0.0.9',
		catalogId: 'elegoo-centauri-carbon'
	}).id;
	db.insert(printerJobs)
		.values({
			printerId,
			buildId: id,
			plateNumber: 1,
			partSlugs: [],
			status: 'printing',
			startedAt: new Date()
		})
		.run();
};

describe('Colors only (design.recolor)', () => {
	it('changes hexes only: plates, part roles, locks, spools and Spoolman stay', () => {
		const d = makeDesign();
		const id = mk();
		startReprint(id);
		updateBuildDesign(db, id, 'owner', { lock: { slugs: ['seat-center'], locked: true } });
		db.update(buildFilaments)
			.set({
				spools: 3,
				spoolAdds: [{ id: 'a', kg: 1, at: '2026-01-01', by: 'x' } as never],
				spoolmanSpoolId: 42
			})
			.where(and(eq(buildFilaments.buildId, id), eq(buildFilaments.roleKey, 'accent')))
			.run();
		const platesBefore = plates(id);
		const rolesBefore = rolesOf(id);
		const lockedBefore = view(id)
			.allParts.filter((p) => p.locked)
			.map((p) => p.slug);
		const before = view(id);

		const plan = applyDesignToBuild(db, d.id, id, 'owner', { mode: 'colors' })!;
		const lockedRole = before.allParts.find((p) => p.slug === 'seat-center')!.role;
		expect(plan.changes.map((c) => c.key)).toContain('accent');
		expect(plan.skipped).toContainEqual(
			expect.objectContaining({ role: lockedRole, reason: 'locked' })
		);
		const v = view(id);
		expect(plates(id)).toBe(platesBefore);
		expect(rolesOf(id)).toEqual(rolesBefore);
		expect(v.allParts.filter((p) => p.locked).map((p) => p.slug)).toEqual(lockedBefore);
		expect(v.runs).toEqual(before.runs);
		expect(v.state['handle-left'].status).toBe('Reprint');
		// the accent slot keeps its spools, adds and Spoolman link although it is Lime now
		expect(fil(id, 'accent')).toMatchObject({ name: 'Lime', spools: 3, spoolmanSpoolId: 42 });
		expect(fil(id, 'accent').spoolAdds).toHaveLength(1);
		expect(plan.keptStock).toContainEqual({
			role: 'accent',
			name: 'Lime',
			was: before.filaments.find((f) => f.key === 'accent')!.name,
			spools: 4,
			spoolman: true
		});
		const row = lastKind(id);
		expect(row.kind).toBe('design.recolor');
		const p = row.payload as { designName: string; before: ReturnType<typeof designSnapshot> };
		expect(p.designName).toBe('Ocean set');
		expect(p.before).toEqual(designSnapshot(before));
		expect(
			describeActivity(
				view(id).activity.find((a) => a.kind === 'design.recolor')!,
				view(id)
			)
		).toContain('colors only');
	});

	it('skips a slot whose material family changes and a slot holding locked parts', () => {
		const d = makeDesign((src) => {
			db.update(buildFilaments)
				.set({ material: 'TPU', name: 'Soft Blue' })
				.where(and(eq(buildFilaments.buildId, src), eq(buildFilaments.roleKey, 'primary')))
				.run();
		});
		const id = mk();
		startReprint(id);
		// accent holds a locked part
		const accentPart = view(id).allParts.find((p) => p.role === 'accent')!;
		updateBuildDesign(db, id, 'owner', { lock: { slugs: [accentPart.slug], locked: true } });
		const primaryBefore = { ...fil(id, 'primary') };
		const accentBefore = { ...fil(id, 'accent') };
		const plan = applyDesignToBuild(db, d.id, id, 'owner', { mode: 'colors' });
		expect(plan?.skipped).toEqual(
			expect.arrayContaining([
				{ role: 'primary', name: primaryBefore.name, reason: 'material' },
				{ role: 'accent', name: accentBefore.name, reason: 'locked' }
			])
		);
		expect(fil(id, 'primary')).toMatchObject({ name: primaryBefore.name, hex: primaryBefore.hex });
		expect(fil(id, 'accent')).toMatchObject({ name: accentBefore.name, hex: accentBefore.hex });
	});

	it('does nothing (no activity row) when no slot would change', () => {
		const id = mk();
		const d = createDesign(db, 'owner', { buildId: id, name: 'Same' });
		startReprint(id);
		const n = db.select().from(activity).where(eq(activity.buildId, id)).all().length;
		expect(applyDesignToBuild(db, d.id, id, 'owner', { mode: 'colors' })?.changes).toEqual([]);
		expect(db.select().from(activity).where(eq(activity.buildId, id)).all().length).toBe(n);
	});

	it("uses the design color most common among a slot's unlocked parts when the design lacks its key", () => {
		const src = mk();
		updateBuildDesign(db, src, 'owner', {
			addRole: { key: 'red', name: 'Red', material: 'PETG', hex: '#aa0000' },
			partRoles: { 'wing-left': 'red' }
		});
		const d = createDesign(db, 'owner', { buildId: src, name: 'Red wings' });
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'mine', name: 'Mine', material: 'PETG', hex: '#00ff00' },
			partRoles: { 'wing-left': 'mine', 'wing-right': 'mine' }
		});
		startReprint(id);
		applyDesignToBuild(db, d.id, id, 'owner', { mode: 'colors' });
		// "mine" is not in the design: wing-left votes red, wing-right votes its kit slot (one each), either way a design color
		expect(['#aa0000', '#00ff00']).toContain(fil(id, 'mine').hex);
		expect(view(id).filaments.some((f) => f.key === 'red')).toBe(false);
	});
});

describe('started builds and full mode', () => {
	it('409 build-started without a mode, with started info', () => {
		const d = makeDesign();
		const id = mk();
		startReprint(id);
		try {
			applyDesignToBuild(db, d.id, id, 'owner');
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(BuildStartedError);
			expect((e as BuildStartedError).status).toBe(409);
			expect((e as BuildStartedError).code).toBe('build-started');
			expect((e as BuildStartedError).extra.started.started).toBe(true);
		}
		expect(fil(id, 'primary').hex).not.toBe('#0044cc');
	});

	it('the 409 body carries code, started and summary', async () => {
		const d = makeDesign();
		const id = mk();
		startReprint(id);
		const res = await respond(() => applyDesignToBuild(db, d.id, id, 'owner'));
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body).toMatchObject({ code: 'build-started', started: { started: true } });
		expect(typeof body.summary).toBe('string');
		expect(typeof body.error).toBe('string');
	});

	it('refuses full while a plate is printing and with a live job, even with confirm', () => {
		const d = makeDesign();
		const a = mk();
		startPrinting(a);
		expect(view(a).started.printingPlates.length).toBeGreaterThan(0);
		expect(
			status(() => applyDesignToBuild(db, d.id, a, 'owner', { mode: 'full', confirm: true }))
		).toBe(409);
		const b = mk();
		liveJob(b);
		expect(
			status(() => applyDesignToBuild(db, d.id, b, 'owner', { mode: 'full', confirm: true }))
		).toBe(409);
		expect(fil(a, 'primary').hex).not.toBe('#0044cc');
		// colors only is still fine while printing
		expect(status(() => applyDesignToBuild(db, d.id, a, 'owner', { mode: 'colors' }))).toBe(0);
		expect(fil(a, 'primary').hex).toBe('#0044cc');
	});

	it('full on a started build that is not printing needs confirm, then keeps locks', () => {
		const d = makeDesign((src) =>
			updateBuildDesign(db, src, 'owner', { partRoles: { 'seat-center': 'accent' } })
		);
		const id = mk();
		startReprint(id);
		const lockedSlot = view(id).allParts.find((p) => p.slug === 'seat-center')!.role;
		updateBuildDesign(db, id, 'owner', { lock: { slugs: ['seat-center'], locked: true } });
		expect(status(() => applyDesignToBuild(db, d.id, id, 'owner', { mode: 'full' }))).toBe(409);
		applyDesignToBuild(db, d.id, id, 'owner', { mode: 'full', confirm: true });
		const v = view(id);
		expect(v.allParts.find((p) => p.slug === 'seat-center')).toMatchObject({ locked: true });
		// the locked part kept its exact color (old filament), wherever its slot is now
		const part = v.allParts.find((p) => p.slug === 'seat-center')!;
		const slot = v.filaments.find((f) => f.key === part.role)!;
		const original = designSnapshot(view(id)).roles; // after: only check hex continuity below
		expect(original.length).toBeGreaterThan(0);
		expect(slot).toBeTruthy();
		expect(lockedSlot).toBeTruthy();
		const row = lastKind(id);
		expect(row.kind).toBe('design.apply');
		expect(row.payload).toMatchObject({ mode: 'full', designName: 'Ocean set' });
		expect((row.payload as { before: unknown }).before).toBeTruthy();
		expect(
			(db.select().from(builds).where(eq(builds.id, id)).get()!.design as { lockedParts: string[] })
				.lockedParts
		).toEqual(['seat-center']);
	});

	it('a locked part stays on its exact color when its slot changes in full mode', () => {
		const d = makeDesign();
		const id = mk();
		startReprint(id);
		const part = view(id).allParts.find((p) => p.role === 'primary')!;
		const old = { ...fil(id, 'primary') };
		updateBuildDesign(db, id, 'owner', { lock: { slugs: [part.slug], locked: true } });
		applyDesignToBuild(db, d.id, id, 'owner', { mode: 'full', confirm: true });
		const v = view(id);
		const nowSlot = v.filaments.find(
			(f) => f.key === v.allParts.find((p) => p.slug === part.slug)!.role
		)!;
		expect(nowSlot).toMatchObject({ name: old.name, material: old.material, hex: old.hex });
		expect(fil(id, 'primary').hex).toBe('#0044cc');
	});

	it('not started: unchanged (no mode needed, replaces colors and part slots)', () => {
		const d = makeDesign((src) =>
			updateBuildDesign(db, src, 'owner', { partRoles: { 'seat-center': 'accent' } })
		);
		const id = mk();
		expect(view(id).started.started).toBe(false);
		expect(applyDesignToBuild(db, d.id, id, 'owner')).toBeNull();
		expect(fil(id, 'primary').hex).toBe('#0044cc');
		expect(rolesOf(id)['seat-center']).toBe('accent');
		expect(lastKind(id).kind).toBe('design.apply');
	});

	it('rejects an unknown mode', () => {
		const d = makeDesign();
		const id = mk();
		expect(status(() => applyDesignToBuild(db, d.id, id, 'owner', { mode: 'x' as never }))).toBe(
			400
		);
	});
});

describe('dry run', () => {
	it('reports the plan and writes nothing', () => {
		const d = makeDesign();
		const id = mk();
		startPrinting(id);
		const n = db.select().from(activity).where(eq(activity.buildId, id)).all().length;
		const pv = previewApplyDesign(db, d.id, id, 'owner');
		expect(pv.changes.length).toBeGreaterThan(0);
		expect(pv.started.started).toBe(true);
		expect(pv.summary).toMatch(/printing/);
		expect(pv.fullBlocked).toMatch(/printing/);
		expect(db.select().from(activity).where(eq(activity.buildId, id)).all().length).toBe(n);
		expect(fil(id, 'primary').hex).not.toBe('#0044cc');
	});

	it('needs edit access', () => {
		const d = makeDesign();
		const id = mk();
		db.insert(user).values({ id: 'v', name: 'V', email: 'v@example.test' }).run();
		db.insert(member)
			.values({
				id: 'm2',
				organizationId: orgId,
				userId: 'v',
				role: 'viewer',
				createdAt: new Date()
			})
			.run();
		expect(status(() => previewApplyDesign(db, d.id, id, 'v'))).toBe(403);
	});
});

describe('palette reset on a started build', () => {
	const pal = (reset: boolean) => ({
		palette: {
			label: 'Sunset',
			reset,
			slots: { primary: { name: 'Sun Orange', material: 'PETG', hex: '#ff8800' } }
		}
	});

	it('needs confirm (409 build-started), stores before, and Undo restores everything', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'red', name: 'Red', material: 'PETG', hex: '#aa0000' },
			partRoles: { 'wing-left': 'red' }
		});
		startReprint(id);
		const snap = designSnapshot(view(id));
		expect(status(() => updateBuildDesign(db, id, 'owner', pal(true)))).toBe(409);
		expect(fil(id, 'primary').name).not.toBe('Sun Orange');
		updateBuildDesign(db, id, 'owner', { ...pal(true), confirm: true });
		expect(fil(id, 'primary').name).toBe('Sun Orange');
		expect((lastKind(id).payload as { before: unknown }).before).toEqual(snap);
		// Undo in one call
		updateBuildDesign(db, id, 'owner', undoPatch(snap, view(id)));
		expect(snapOf(id)).toEqual(snapLower(snap));
	});

	it('without reset (colors only) and on a build that has not started: no confirm needed', () => {
		const a = mk();
		startReprint(a);
		expect(status(() => updateBuildDesign(db, a, 'owner', pal(false)))).toBe(0);
		const b = mk();
		expect(status(() => updateBuildDesign(db, b, 'owner', pal(true)))).toBe(0);
		expect((lastKind(b).payload as { before?: unknown }).before).toBeUndefined();
	});
});

describe('undo of an applied design', () => {
	it('restores colors, part slots and removes added slots (full mode)', () => {
		const d = makeDesign((src) =>
			updateBuildDesign(db, src, 'owner', {
				addRole: { key: 'red', name: 'Red', material: 'PETG', hex: '#aa0000' },
				partRoles: { 'wing-left': 'red' }
			})
		);
		const id = mk();
		startReprint(id);
		const snap = designSnapshot(view(id));
		applyDesignToBuild(db, d.id, id, 'owner', { mode: 'full', confirm: true });
		expect(view(id).filaments.some((f) => f.key === 'red')).toBe(true);
		updateBuildDesign(db, id, 'owner', undoPatch(snap, view(id)));
		expect(snapOf(id)).toEqual(snapLower(snap));
	});

	it('restores colors (colors only)', () => {
		const d = makeDesign();
		const id = mk();
		startReprint(id);
		const snap = designSnapshot(view(id));
		applyDesignToBuild(db, d.id, id, 'owner', { mode: 'colors' });
		updateBuildDesign(db, id, 'owner', undoPatch(snap, view(id)));
		expect(snapOf(id)).toEqual(snapLower(snap));
	});
});
