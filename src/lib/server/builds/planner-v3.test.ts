import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { catalogPrinter } from '#lib/printers/catalog.ts';
import { printerFromCatalog } from '#lib/printers/printer.ts';
import type { BuildPrinter } from '#lib/domain/types.ts';
import { openDb, runMigrations, type Db } from '../db';
import {
	buildPlates,
	member,
	organization,
	templatePlateLayouts,
	templates,
	user
} from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addRun, setPrinter, setVariant, updatePlate } from './actions';
import { createBuild } from './create';
import { updateBuildDesign } from '../designs/mutate';
import {
	clearPlanCache,
	layoutHintFor,
	loadFootprints,
	loadKitSource,
	PLANNER_VERSION,
	planArrangement,
	planCacheStats,
	planForBuild,
	manualTimes,
	signature,
	writePlan,
	type Plan
} from './arrange-plan';
import { arrangeForPrinter, buildArrangement } from './plates';
import { loadBuildView } from './view';

// Planner 3: a plate printed in runs of its own (the wheel rims) stays one plate, and a part that moved
// may join an existing multi-part plate. Arrangements stored by planner 2 keep being checked by planner 2.

let db: Db;
let templateId: string;
const orgId = 'org1';
process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'tmt-kit-')), 'unused.db');

const cc = printerFromCatalog(catalogPrinter('elegoo-centauri-carbon')!, 0);
/** 300 x 256: the kit's 256 layout is the source, and one rim half (280 x 154) fits but two do not. */
const wide: BuildPrinter = {
	...cc,
	catalogId: null,
	name: 'Custom',
	bedX: 300,
	bedY: 256,
	keepOut: []
};

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

const mk = (printer = wide) =>
	createBuild(
		db,
		{ organizationId: orgId, templateId, designId: null, name: 'B', printer },
		'owner'
	);
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const rows = (id: string) =>
	db
		.select()
		.from(buildPlates)
		.where(eq(buildPlates.buildId, id))
		.orderBy(buildPlates.number)
		.all();

describe('the wheel rims are one plate', () => {
	it('stays the kit plate: both parts, runs, one print on the bed, flagged per part', () => {
		const id = mk();
		const v = view(id);
		// both rim halves are on the kit's plate 13, and nowhere else (the harness and tires of the seed's
		// box footprints may spill over a 300 x 256 bed: they are not the rims)
		expect(v.plates.filter((p) => p.parts.some((s) => s.startsWith('rims-')))).toHaveLength(1);
		const rim = v.plates.find((p) => p.parts.includes('rims-1-4'))!;
		expect(rim.parts).toEqual(['rims-1-4', 'rims-2-3']);
		expect(rim.runs).toBe(2);
		expect(rim.perPartRuns).toBe(true);
		const row = rows(id).find((r) => r.number === rim.number)!;
		expect(row.perPartRuns).toBe(true);
		expect(row.arrangement).toMatchObject({ v: PLANNER_VERSION, perPartRuns: true, runs: 2 });
		// one print = one rim half on the bed (the same object in both colors)
		expect(row.arrangement!.items).toHaveLength(1);
		expect(row.arrangement!.items[0].slug).toBe('rims-1-4');
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});

	it('planner 2 (stored arrangements) split it onto an extra plate', () => {
		const id = mk();
		const v = view(id);
		const fp = loadFootprints(db, templateId);
		const plan = planArrangement(v, fp, null, undefined, loadKitSource(db, v)!, 2)!;
		expect(plan.result.plates.length).toBe(v.plates.length + 1);
	});
});

describe('arrangements stored by planner 2 are not flagged stale, and not rewritten', () => {
	it('a v2 arrangement is checked against planner 2; a color change still makes it stale', () => {
		const id = mk();
		const v = view(id);
		const fp = loadFootprints(db, templateId);
		const v2 = planArrangement(v, fp, null, undefined, loadKitSource(db, v)!, 2)!;
		writePlan(db, id, v2, 2);
		const before = JSON.stringify(rows(id).map((r) => [r.number, r.parts, r.arrangement]));
		expect(rows(id)[0].arrangement).toMatchObject({ v: 2 });
		// the current planner would plan one plate less, yet nothing is stale: the plates were made by planner 2
		const info = buildArrangement(db, id, 'owner');
		expect(info.fresh!.plates).toBe(v2.result.plates.length - 1);
		expect(info.stale).toBe(false);
		// reading never rewrites
		expect(JSON.stringify(rows(id).map((r) => [r.number, r.parts, r.arrangement]))).toBe(before);
		// a started build keeps its plates when a part is recolored: planner 2 sees the change, so it is stale
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			partSlug: 'handle-left',
			grams: 5
		});
		updateBuildDesign(db, id, 'owner', { partRoles: { 'seat-back-top': 'accent' } });
		expect(buildArrangement(db, id, 'owner').stale).toBe(true);
		expect(JSON.stringify(rows(id).map((r) => [r.number, r.parts, r.arrangement]))).toBe(before);
	});

	it('an explicit re-arrange writes planner 3', () => {
		const id = mk();
		const v = view(id);
		const fp = loadFootprints(db, templateId);
		writePlan(db, id, planArrangement(v, fp, null, undefined, loadKitSource(db, v)!, 2)!, 2);
		arrangeForPrinter(db, id, 'owner');
		const now = rows(id);
		expect(now.every((r) => (r.arrangement as { v?: number }).v === PLANNER_VERSION)).toBe(true);
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
	});
});

describe('a part that moved joins an existing multi-part plate', () => {
	it('an automatic re-arrange after a recolor: the part sits on a kit plate, no plate added', () => {
		const id = mk(cc);
		const kitCount = view(id).plates.length;
		updateBuildDesign(db, id, 'owner', { partRoles: { 'push-pin': 'primary' } });
		const v = view(id);
		expect(v.plates.length).toBe(kitCount);
		const plate = v.plates.find((p) => p.parts.includes('push-pin'))!;
		expect(plate.parts.length).toBeGreaterThanOrEqual(2);
		const pin = v.parts.find((p) => p.slug === 'push-pin')!;
		for (const s of plate.parts) expect(v.parts.find((p) => p.slug === s)!.role).toBe(pin.role);
		// the plate it left lost only the pin
		const left = v.plates.find((p) => p.parts.includes('push-bottom'))!;
		expect(left.parts).not.toContain('push-pin');
		expect(buildArrangement(db, id, 'owner').stale).toBe(false);
		// the stored plate holds the pin's item and the plate's own items did not move
		const stored = rows(id).find((r) => r.number === plate.number)!;
		expect(stored.arrangement!.items.some((i) => i.slug === 'push-pin')).toBe(true);
		expect(stored.arrangement!.utilisation).toBeLessThanOrEqual(0.61);
	});

	it('single-part plates never get it: the plates that are alone in the kit are still alone', () => {
		const id = mk(cc);
		const kit = loadKitSource(db, view(id))!.plates!;
		const lone = kit.filter((p) => p.parts.length === 1).map((p) => p.parts[0]);
		updateBuildDesign(db, id, 'owner', { partRoles: { 'push-pin': 'primary' } });
		const v = view(id);
		for (const s of lone.filter((x) => v.parts.some((p) => p.slug === x)))
			expect(v.plates.find((p) => p.parts.includes(s))!.parts).toEqual([s]);
	});
});

// What every build made before this change is in: plates stored by the plain arranger, with no planner
// version on them. They are compared with that arranger (`planArrangement(..., 'legacy')`), never with the
// current planner, so reading them never flags them stale and never rewrites them.

/** Store a plan as the build's plates the way the build had them before planner versions existed: no `v`. */
function storeWithoutVersion(id: string, plan: Plan) {
	writePlan(db, id, plan);
	for (const r of rows(id))
		db.update(buildPlates)
			.set({
				arrangement: Object.fromEntries(
					Object.entries(r.arrangement!).filter(([k]) => k !== 'v')
				) as never
			})
			.where(and(eq(buildPlates.buildId, id), eq(buildPlates.number, r.number)))
			.run();
}
const snapshot = (id: string) => JSON.stringify(rows(id));

describe('arrangements stored without a planner version (every build made before this change)', () => {
	it(
		"are the legacy planner's own output: not stale, not rewritten, stale after a color change",
		{ timeout: 30_000 },
		() => {
			const id = mk(cc);
			const fp = loadFootprints(db, templateId);
			const legacy = planArrangement(view(id), fp, null, undefined, 'legacy')!;
			storeWithoutVersion(id, legacy);
			expect(rows(id).every((r) => (r.arrangement as { v?: number }).v === undefined)).toBe(true);
			// the current planner plans something else for this build (so "not stale" is the legacy comparison)
			const kitPlan = planForBuild(db, view(id), fp, null)!;
			expect(signature(kitPlan.result.plates)).not.toBe(signature(legacy.result.plates));
			const before = snapshot(id);
			const info = buildArrangement(db, id, 'owner');
			expect(info.stale).toBe(false);
			expect(info.plates.length).toBe(legacy.result.plates.length);
			expect(info.fresh!.plates).toBe(kitPlan.result.plates.length);
			expect(snapshot(id)).toBe(before); // reading never rewrites
			// a started build keeps its plates when a part is recolored; the legacy planner now plans it differently
			addRun(db, id, 'owner', {
				date: '2026-03-01',
				result: 'Success',
				partSlug: 'handle-left',
				grams: 5
			});
			updateBuildDesign(db, id, 'owner', { partRoles: { 'seat-back-top': 'accent' } });
			expect(snapshot(id)).toBe(before);
			const changed = loadBuildView(db, id, 'owner')!;
			expect(
				signature(planArrangement(changed, fp, null, undefined, 'legacy')!.result.plates)
			).not.toBe(signature(legacy.result.plates));
			expect(buildArrangement(db, id, 'owner').stale).toBe(true);
			expect(snapshot(id)).toBe(before);
		}
	);
});

describe('an automatic re-arrange of a version-less build keeps typed grams and times', () => {
	it(
		'a plate whose parts stay together keeps them, even though the kit numbers it differently',
		{ timeout: 30_000 },
		() => {
			const id = mk(cc);
			const fp = loadFootprints(db, templateId);
			const legacy = planArrangement(view(id), fp, null, undefined, 'legacy')!;
			storeWithoutVersion(id, legacy);
			const kitPlan = planForBuild(db, view(id), fp, null)!;
			const same = (a: { parts: string[] }, b: { parts: string[] }) =>
				[...a.parts].sort().join() === [...b.parts].sort().join();
			// a plate with the same parts in both plans, under another number, printed as often, not recolored below
			const pair = legacy.result.plates
				.map((l) => ({
					l,
					k: kitPlan.result.plates.find(
						(k) => same(k, l) && k.number !== l.number && k.runs === l.runs && !k.perPartRuns
					)
				}))
				.find((x) => x.k && !x.l.parts.includes('seat-back-top'))!;
			expect(pair, 'a plate that has the same parts under another number').toBeTruthy();
			const typed = { slicerGrams: 77, manualEstSeconds: 5400 };
			updatePlate(db, id, 'owner', pair.l.number, typed);
			// a recolor of a part on another plate: the unstarted build is re-arranged to the kit's layout
			updateBuildDesign(db, id, 'owner', { partRoles: { 'seat-back-top': 'accent' } });
			const now = rows(id);
			expect(now.every((r) => (r.arrangement as { v?: number }).v === PLANNER_VERSION)).toBe(true);
			const moved = now.find((r) => same(r, pair.l))!;
			expect(moved.number).toBe(pair.k!.number);
			expect(moved.manualEstSeconds).toBe(5400);
			expect(moved.manualEstSource).toBe('user');
			expect(moved.slicerGrams).toBe(77);
			expect(moved.slicerGramsSource).toBe('user');
			const v = view(id).plates.find((p) => p.number === moved.number)!;
			expect(v.estSource).toBe('manual');
			expect(v.gramsSource).toBe('user');
		}
	);
});

describe('typed values follow a renumbered plate only when it is the same plate', () => {
	it('same parts, same runs, same kind: carried once; another run count or kind, or a second claim: not', () => {
		const id = mk(cc);
		const pl = view(id).plates.find((p) => p.parts.length >= 1 && !p.perPartRuns)!;
		updatePlate(db, id, 'owner', pl.number, { slicerGrams: 41, manualEstSeconds: 600 });
		const carry = manualTimes(db, id, [{ number: pl.number, parts: pl.parts }]);
		const shape = { runs: pl.runs, perPartRuns: false };
		// the same number and parts always win, shape or not
		expect(carry(pl.number, pl.parts).manualEstSeconds).toBe(600);
		const renumbered = manualTimes(db, id, [
			{ number: pl.number + 100, parts: pl.parts },
			{ number: pl.number + 101, parts: pl.parts }
		]);
		expect(renumbered(pl.number + 100, pl.parts, shape)).toMatchObject({
			manualEstSeconds: 600,
			typedGrams: { slicerGrams: 41, slicerGramsSource: 'user' }
		});
		// used once: a second plate with the same parts does not get a copy
		expect(renumbered(pl.number + 101, pl.parts, shape).manualEstSeconds).toBeNull();
		const other = manualTimes(db, id, [{ number: pl.number + 100, parts: pl.parts }]);
		expect(
			other(pl.number + 100, pl.parts, { ...shape, runs: pl.runs + 1 }).manualEstSeconds
		).toBeNull();
		expect(
			other(pl.number + 100, pl.parts, { ...shape, perPartRuns: true }).manualEstSeconds
		).toBeNull();
		expect(other(pl.number + 100, [...pl.parts, 'extra'], shape).manualEstSeconds).toBeNull();
		expect(other(pl.number + 100, pl.parts).manualEstSeconds).toBeNull(); // no shape given: exact only
	});

	it('a typed value goes to one new plate only, and the exact number + parts match wins in either order', async () => {
		const id = await mk(cc);
		const pl = (await view(id)).plates.find((p) => p.parts.length >= 1 && !p.perPartRuns)!;
		await updatePlate(db, id, 'owner', pl.number, { slicerGrams: 41, manualEstSeconds: 600 });
		const shape = { runs: pl.runs, perPartRuns: false };
		const exact = { number: pl.number, parts: pl.parts };
		const renumbered = { number: pl.number + 100, parts: pl.parts };
		for (const order of [
			[exact, renumbered],
			[renumbered, exact]
		]) {
			const carry = manualTimes(db, id, [exact, renumbered]);
			const got = new Map(order.map((o) => [o.number, carry(o.number, o.parts, shape)]));
			expect(got.get(exact.number)!.manualEstSeconds).toBe(600);
			expect(got.get(exact.number)!.typedGrams?.slicerGrams).toBe(41);
			expect(got.get(renumbered.number)!.manualEstSeconds).toBeNull();
			expect(got.get(renumbered.number)!.typedGrams).toBeUndefined();
		}
	});
});

// A small in-process cache of fresh plans (arrange-plan.ts): a plan is only ever returned for the exact
// input it was made from.
describe('the fresh-plan cache', () => {
	const hintOf = () => layoutHintFor(db, templateId);
	const fresh = (id: string) => {
		const v = view(id);
		return planForBuild(db, v, loadFootprints(db, templateId), hintOf())!;
	};
	/** The same plan without the cache (explicit options are never cached). */
	const direct = (id: string) => {
		const v = view(id);
		return planArrangement(v, loadFootprints(db, templateId), hintOf(), {}, loadKitSource(db, v))!;
	};
	const started = (id: string) =>
		addRun(db, id, 'owner', {
			date: '2026-03-01',
			result: 'Success',
			partSlug: 'handle-left',
			grams: 5
		});

	it('two identical reads plan once', { timeout: 30_000 }, () => {
		const id = mk(cc);
		clearPlanCache();
		const a = buildArrangement(db, id, 'owner');
		expect(planCacheStats).toEqual({ hits: 0, misses: 1 });
		const b = buildArrangement(db, id, 'owner');
		expect(planCacheStats).toEqual({ hits: 1, misses: 1 });
		expect(b).toEqual(a);
		expect(signature(fresh(id).result.plates)).toBe(signature(direct(id).result.plates));
	});

	it(
		'a version-less build plans twice on the first read (legacy and current) and never again',
		{ timeout: 30_000 },
		() => {
			const id = mk(cc);
			storeWithoutVersion(
				id,
				planArrangement(view(id), loadFootprints(db, templateId), null, undefined, 'legacy')!
			);
			clearPlanCache();
			buildArrangement(db, id, 'owner');
			expect(planCacheStats.misses).toBe(2);
			buildArrangement(db, id, 'owner');
			buildArrangement(db, id, 'owner');
			expect(planCacheStats.misses).toBe(2);
			expect(planCacheStats.hits).toBe(4);
		}
	);

	it(
		'a change of colour, variant, printer, bed option or kit layout misses, and gets its own plan',
		{ timeout: 30_000 },
		() => {
			const id = mk(cc);
			started(id); // a started build keeps its plates: no automatic re-arrange in between
			clearPlanCache();
			const seen = new Set<string>();
			const step = (label: string, change: () => void) => {
				change();
				const before = planCacheStats.misses;
				const plan = fresh(id);
				expect(planCacheStats.misses, `${label} misses`).toBe(before + 1);
				expect(fresh(id)).toEqual(plan); // and the next read hits
				expect(planCacheStats.misses, `${label} then hits`).toBe(before + 1);
				expect(signature(plan.result.plates), `${label} is what a fresh computation gives`).toBe(
					signature(direct(id).result.plates)
				);
				seen.add(signature(plan.result.plates));
				return plan;
			};
			step('first', () => {});
			step('colour', () =>
				updateBuildDesign(db, id, 'owner', { partRoles: { 'seat-back-top': 'accent' } })
			);
			step('variant', () => setVariant(db, id, 'owner', { group: 'seat', option: 'bucket-seat' }));
			step('printer', () =>
				setPrinter(db, id, 'owner', { printer: { ...cc, bedX: 300, bedY: 300, keepOut: [] } })
			);
			step('bed margin', () =>
				setPrinter(db, id, 'owner', {
					printer: { ...cc, bedX: 300, bedY: 300, keepOut: [], margin: 9 }
				})
			);
			step('keep-out', () =>
				setPrinter(db, id, 'owner', {
					printer: {
						...cc,
						bedX: 300,
						bedY: 300,
						margin: 9,
						keepOut: [{ x: 0, y: 0, w: 60, d: 60 }]
					}
				})
			);
			// the kit's own layout: another name on a plate is another plan
			const layout = loadKitSource(db, view(id))!;
			expect(layout.layout).toBeTruthy();
			const row = db
				.select()
				.from(templatePlateLayouts)
				.where(
					and(
						eq(templatePlateLayouts.templateId, templateId),
						eq(templatePlateLayouts.key, layout.layout!)
					)
				)
				.get()!;
			const plan = step('kit layout', () =>
				db
					.update(templatePlateLayouts)
					.set({
						plates: row.plates.map((p, i) => (i === 0 ? { ...p, name: 'Renamed plate' } : p))
					})
					.where(
						and(
							eq(templatePlateLayouts.templateId, templateId),
							eq(templatePlateLayouts.key, row.key)
						)
					)
					.run()
			);
			expect(plan.result.plates.some((p) => p.name === 'Renamed plate')).toBe(true);
			expect(planCacheStats.misses).toBe(7);
		}
	);

	it(
		'hands out copies: a caller that edits its plan changes nothing for the next read',
		{ timeout: 30_000 },
		() => {
			const id = mk(cc);
			clearPlanCache();
			const a = fresh(id);
			const n = a.result.plates.length;
			a.result.plates.length = 0;
			a.result.plates.push(...[]);
			expect(fresh(id).result.plates).toHaveLength(n);
			expect(planCacheStats.hits).toBe(1);
		}
	);

	it('is bounded', () => {
		const id = mk(cc);
		clearPlanCache();
		const v0 = view(id);
		// a small build keeps the 60 plans cheap
		const v = { ...v0, parts: v0.parts.slice(0, 3) };
		const fp = loadFootprints(db, templateId);
		const kit = loadKitSource(db, v0)!;
		const at = (i: number) =>
			planArrangement(
				{ ...v, printer: { ...v.printer!, margin: 1 + i / 100 } },
				fp,
				null,
				undefined,
				kit
			);
		for (let i = 0; i < 60; i++) at(i);
		expect(planCacheStats.misses).toBe(60);
		// the oldest were dropped (they plan again), the newest are still there
		at(59);
		expect(planCacheStats.hits).toBe(1);
		at(0);
		expect(planCacheStats.misses).toBe(61);
	});
});
