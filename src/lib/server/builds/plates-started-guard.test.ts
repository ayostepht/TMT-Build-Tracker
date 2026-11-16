import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { openDb, runMigrations, type Db } from '../db';
import { member, organization, printerJobs, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun, setPartStatus } from './actions';
import { createBuild } from './create';
import { createPrinter } from '../printers/store';
import { arrangeForPrinter, buildLayouts, setPlateLayout } from './plates';
import { BuildStartedError } from './started-guard';
import { loadBuildView } from './view';

// Issue #56: re-arranging or switching layout renumbers plates. Live job: refused. Started: confirm.

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-pguard-')), 'unused.db');
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
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const plates = (id: string) => JSON.stringify(view(id).plates);
const layoutKey = (id: string) => buildLayouts(db, id, 'owner').layouts[0].key;
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
			plateNumber: 2,
			partSlugs: view(id).plates[1]?.parts ?? [],
			status: 'printing',
			startedAt: new Date()
		})
		.run();
};
const refusal = (fn: () => unknown): BuildStartedError => {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(BuildStartedError);
		return e as BuildStartedError;
	}
	throw new Error('expected a refusal');
};

describe('plate replacement on a started build', () => {
	it('works without a prompt on an unstarted build', () => {
		const id = mk();
		expect(view(id).started.started).toBe(false);
		expect(arrangeForPrinter(db, id, 'owner').plates).toBeGreaterThan(0);
		expect(setPlateLayout(db, id, 'owner', { key: layoutKey(id) }).plates).toBeGreaterThan(0);
	});

	it('refuses a live job, even with confirm, and changes nothing', () => {
		const id = mk();
		liveJob(id);
		const before = plates(id);
		const e1 = refusal(() =>
			arrangeForPrinter(db, id, 'owner', { confirm: true, convertRuns: true })
		);
		expect(e1.status).toBe(409);
		expect(e1.code).toBe('build-started');
		expect(e1.message).toMatch(/Plate 2 is printing on Shop.*wait until the print finishes/);
		expect(e1.extra.started.liveJobs).toBe(1);
		refusal(() => setPlateLayout(db, id, 'owner', { key: layoutKey(id), confirm: true }));
		expect(plates(id)).toBe(before);
	});

	it('needs confirm when a part is Printing by hand, and names it', () => {
		const id = mk();
		setPartStatus(db, id, 'owner', 'handle-left', { status: 'Printing' });
		const before = plates(id);
		const e = refusal(() => arrangeForPrinter(db, id, 'owner'));
		expect(e.message).toMatch(/renumbers/);
		expect(e.message).toMatch(/marked Printing by hand/);
		expect(e.extra.started.liveJobs).toBe(0);
		refusal(() => setPlateLayout(db, id, 'owner', { key: layoutKey(id) }));
		expect(plates(id)).toBe(before);
		expect(arrangeForPrinter(db, id, 'owner', { confirm: true }).plates).toBeGreaterThan(0);
		// statuses stay as they were
		expect(view(id).state['handle-left'].status).toBe('Printing');
		expect(
			setPlateLayout(db, id, 'owner', { key: layoutKey(id), confirm: true }).plates
		).toBeGreaterThan(0);
	});

	it('a logged part run needs confirm too, and confirm converts plate logs', () => {
		const id = mk();
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			plateNumber: 1,
			grams: 10
		});
		const e = refusal(() => arrangeForPrinter(db, id, 'owner'));
		expect(e.message).toMatch(/print log/);
		const r = arrangeForPrinter(db, id, 'owner', { confirm: true });
		expect(r.convertedRuns).toBe(1);
		expect(view(id).runs.every((x) => x.plateNumber === null)).toBe(true);
	});
});
