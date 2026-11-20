import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import { openDb, runMigrations, type Db } from '../db';
import { member, organization, templatePlateLayouts, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { and, eq } from 'drizzle-orm';
import { createBuild } from './create';
import { updateBuildDesign } from '../designs/mutate';
import { arrangeForPrinter, buildArrangement } from './plates';
import { loadBuildView } from './view';

// The kit's own plate layout comes first (see domain/arrange-source.ts): a new build on a printer, an
// explicit "Arrange for my bed" and an automatic re-arrange all follow it.

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-kit-')), 'unused.db');

const cc = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
const bed = (x: number, y = x, mmSlots = 4) => ({
	...cc,
	catalogId: null,
	name: 'Custom',
	bedX: x,
	bedY: y,
	mmSlots,
	keepOut: []
});

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

const mk = (printer = bed(350, 320)) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', printer },
		'owner'
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const kit = (key: string) =>
	db
		.select()
		.from(templatePlateLayouts)
		.where(and(eq(templatePlateLayouts.templateId, templateId), eq(templatePlateLayouts.key, key)))
		.get()!.plates;

describe('a new build on a printer follows the kit layout', () => {
	it(
		'standard palette on the bed the layout is for: the kit plates, not a fresh packing',
		{ timeout: 30_000 },
		() => {
			const id = mk();
			const v = view(id);
			const layout = kit('h2d');
			const active = new Set(v.parts.map((p) => p.slug));
			expect(v.plates.every((p) => p.source === 'arranged')).toBe(true);
			let same = 0;
			let compared = 0;
			for (const src of layout) {
				const want = src.parts.filter((s) => active.has(s));
				if (!want.length) continue;
				compared++;
				const got = v.plates.find((p) => p.number === src.number);
				expect(got, `plate ${src.number} (${src.name}) is there`).toBeTruthy();
				if (want.every((s) => got!.parts.includes(s)) && got!.parts.length === want.length) same++;
				// a plate that is alone in the kit is alone here
				if (want.length === 1) expect(got!.parts).toEqual(want);
			}
			// the seed footprints are boxes: a few multi-part plates may not fit as the author's real outlines do
			expect(same).toBeGreaterThanOrEqual(compared - 3);
			// no stale banner for a plan we just made
			expect(buildArrangement(db, id, 'owner').stale).toBe(false);
		}
	);

	it('every kit plate that is alone stays alone on any bed (no layout for it too)', () => {
		const layout = kit('xpa');
		const aloneInKit = layout.filter((p) => p.parts.length === 1).map((p) => p.parts[0]);
		expect(aloneInKit.length).toBeGreaterThan(5);
		// 220 x 220: no kit layout is for a bed this small (E): the arranger runs, solo parts stay alone
		const id = mk(bed(220, 220));
		const v = view(id);
		for (const slug of aloneInKit.filter((s) => v.parts.some((p) => p.slug === s)))
			expect(v.plates.find((p) => p.parts.includes(slug))!.parts).toEqual([slug]);
	});

	it(
		'a design that gives two parts of one kit plate different colors moves only the minority',
		{ timeout: 30_000 },
		() => {
			const id = mk();
			const before = view(id);
			const shared = kit('h2d').find(
				(p) =>
					p.parts.length >= 2 &&
					p.parts.every((s) => before.parts.some((x) => x.slug === s)) &&
					new Set(p.parts.map((s) => before.parts.find((x) => x.slug === s)!.defaultRole)).size ===
						1 &&
					before.plates.find((x) => x.number === p.number)?.parts.length === p.parts.length
			)!;
			expect(shared).toBeTruthy();
			const other = shared.parts[shared.parts.length - 1];
			const role = before.parts.find((x) => x.slug === other)!.role;
			const to = role === 'accent' ? 'primary' : 'accent';
			updateBuildDesign(db, id, 'owner', { partRoles: { [other]: to } });
			const after = view(id);
			// the plate keeps its number and the rest of its parts
			expect(after.plates.find((p) => p.number === shared.number)!.parts).toEqual(
				shared.parts.filter((s) => s !== other)
			);
			expect(after.plates.find((p) => p.parts.includes(other))!.number).toBeGreaterThan(
				Math.max(...before.plates.map((p) => p.number))
			);
			// every other plate is as before
			for (const p of before.plates.filter((x) => x.number !== shared.number))
				expect(after.plates.find((x) => x.number === p.number)!.parts).toEqual(p.parts);
			expect(buildArrangement(db, id, 'owner').stale).toBe(false);
		}
	);

	it('re-arranging explicitly gives the same plates again', { timeout: 30_000 }, () => {
		const id = mk();
		const a = view(id).plates.map((p) => [p.number, p.parts.join()]);
		arrangeForPrinter(db, id, 'owner');
		expect(view(id).plates.map((p) => [p.number, p.parts.join()])).toEqual(a);
	});
});
