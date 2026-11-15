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
import { addRun, setPartStatus, setPrinter } from './actions';
import { createBuild } from './create';
import { updateBuildDesign } from '../designs/mutate';
import { createPrinter } from '../printers/store';
import { buildArrangement } from './plates';
import { loadBuildView } from './view';

// Issue #56: once a build has started printing, design/part moves must not rewrite its plates.

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-start-')), 'unused.db');
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
const move = (id: string) =>
	updateBuildDesign(db, id, 'owner', { partRoles: { 'wing-left': 'primary' } });

describe('design changes on a started build keep the plates', () => {
	it('an unstarted arranged build still re-arranges automatically', () => {
		const id = mk();
		expect(view(id).started.started).toBe(false);
		const before = plates(id);
		move(id);
		expect(plates(id)).not.toBe(before);
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});

	const cases: [string, (id: string) => void][] = [
		[
			'a part logged on its own',
			(id) =>
				addRun(db, id, 'owner', {
					date: '2026-03-01',
					result: 'Success',
					partSlug: 'handle-left',
					grams: 5
				})
		],
		[
			'a part that is Printing',
			(id) => setPartStatus(db, id, 'owner', 'handle-left', { status: 'Printing' })
		],
		[
			'a part that is Reprint',
			(id) => setPartStatus(db, id, 'owner', 'handle-left', { status: 'Reprint' })
		],
		[
			'a live printer job',
			(id) => {
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
						partSlugs: view(id).plates[0].parts,
						status: 'printing',
						startedAt: new Date()
					})
					.run();
			}
		]
	];
	for (const [name, start] of cases)
		it(`does not rewrite plates after ${name}, and the plates go stale`, () => {
			const id = mk();
			start(id);
			expect(view(id).started.started).toBe(true);
			const before = plates(id);
			move(id);
			expect(plates(id)).toBe(before);
			expect(buildArrangement(db, id, 'owner').stale).toBe(true);
		});

	it('a printer change on a started build keeps the plates too', () => {
		const id = mk();
		setPartStatus(db, id, 'owner', 'handle-left', { status: 'Printing' });
		const before = plates(id);
		setPrinter(db, id, 'owner', {
			printer: { ...cc, bedX: 350, bedY: 320, catalogId: null, name: 'Big' }
		});
		expect(plates(id)).toBe(before);
	});

	it('a live job reports its plate in started.printingPlates', () => {
		const id = mk();
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
				plateNumber: 3,
				partSlugs: [],
				status: 'paused',
				startedAt: new Date()
			})
			.run();
		expect(view(id).started).toMatchObject({ started: true, liveJobs: 1, printingPlates: [3] });
	});
});
