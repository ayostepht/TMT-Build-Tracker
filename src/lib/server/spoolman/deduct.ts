import { and, eq } from 'drizzle-orm';
import { runCountsForDeduction, isPreLinkRun } from '#lib/domain/spoolman.ts';
import { splitGramsByRole } from '#lib/domain/spool-split.ts';
import type { PrintRunInput } from '#lib/domain/types.ts';
import type { Db } from '../db';
import { builds, buildFilaments, printRuns } from '../db/schema';
import { loadBuildView } from '../builds/view';
import {
	getDeductions,
	getOrgSettings,
	ledgerRole,
	setDeduction,
	type DeductionEntry
} from '../org-settings';
import { getMemberActor } from '../printers/system';
import { readCached, refreshFilaments } from './cache';
import { backfillFilamentIds } from './link';
import { SpoolmanClient, SpoolmanError } from './client';
import { EPS, giveBack, recordAdvances, round1, takeGrams } from './engine';
import { LOCK_BUDGET_MS, withSpoolmanLock } from './lock';

export type ClientFactory = (url: string) => SpoolmanClient;
const defaultFactory: ClientFactory = (url) => new SpoolmanClient(url);

/**
 * Bring Spoolman in line with one run: what the run should have consumed per filament slot (its
 * grams split over roles whose slot is linked, when the workspace has the app keep Spoolman up to
 * date) versus what the ledger says was already deducted for that slot. Only the difference moves:
 * calling it twice does nothing, editing grams adjusts, a deleted or undone run (row gone) gives
 * its grams back, newest first.
 *
 * Rules (issue #59):
 * - Runs created or dated before the slot was linked are never added (`runCountsForDeduction`);
 *   what the ledger already holds for them stays until the run row is deleted.
 * - Changing the current spool afterwards never moves grams: the ledger is per slot.
 * - A spool that runs out hands over to the next open spool of the linked filament (activity
 *   `filament.spoolman.spool` with `auto`).
 * - The whole sync runs under `withSpoolmanLock` for the workspace, so overlapping syncs of the same
 *   run cannot both deduct.
 * Never throws; returns a warning for the caller to show.
 */
export function syncRunDeduction(
	db: Db,
	buildId: string,
	runId: string,
	factory: ClientFactory = defaultFactory
): Promise<{ warning?: string; deducted?: number }> {
	const b = db
		.select({ org: builds.organizationId })
		.from(builds)
		.where(eq(builds.id, buildId))
		.get();
	if (!b) return Promise.resolve({});
	return withSpoolmanLock(b.org, () => syncLocked(db, b.org, buildId, runId, factory)).catch(
		(e) => ({ warning: `Spoolman: ${e instanceof Error ? e.message : 'update failed'}` })
	);
}

async function syncLocked(
	db: Db,
	org: string,
	buildId: string,
	runId: string,
	factory: ClientFactory
): Promise<{ warning?: string; deducted?: number }> {
	const cfg = getOrgSettings(db, org);
	const ledger = getDeductions(db, org)[runId] ?? [];
	if (!cfg.spoolmanUrl || (!cfg.spoolmanAutoDeduct && !ledger.length)) return {};

	const run = db
		.select()
		.from(printRuns)
		.where(and(eq(printRuns.id, runId), eq(printRuns.buildId, buildId)))
		.get();
	const loadSlots = () =>
		new Map(
			db
				.select()
				.from(buildFilaments)
				.where(eq(buildFilaments.buildId, buildId))
				.all()
				.map((f) => [f.roleKey, f])
		);
	let slots = loadSlots();
	const linked = (role: string) => {
		const f = slots.get(role);
		return !!f && (f.spoolmanFilamentId != null || f.spoolmanSpoolId != null);
	};
	const roleOf = (e: DeductionEntry): string | null => {
		const r = ledgerRole(e);
		if (r) return r;
		const hit = [...slots.values()].filter((f) => f.spoolmanSpoolId === e[0]);
		return hit.length === 1 ? hit[0].roleKey : null;
	};

	// Grams the run wants per role.
	const grams: Record<string, number> = {};
	if (run && run.result !== 'Partial' && (run.grams ?? 0) > 0) {
		const actor = getMemberActor(db, org);
		const view = actor ? loadBuildView(db, buildId, actor) : null;
		if (view) {
			const input: PrintRunInput = {
				plateNumber: run.plateNumber,
				partSlug: run.partSlug,
				partSlugs: run.partSlugs ?? null,
				date: run.date,
				result: run.result as PrintRunInput['result'],
				grams: run.grams,
				hours: run.hours,
				printer: run.printer,
				note: run.note
			};
			Object.assign(grams, splitGramsByRole(view, input));
		}
	}
	const runWhen = run && {
		date: run.date,
		createdAt: run.createdAt ? run.createdAt.getTime() : null,
		result: run.result as PrintRunInput['result'],
		grams: run.grams
	};

	const roles = new Set<string>([...Object.keys(grams)]);
	for (const e of ledger) {
		const r = roleOf(e);
		if (r) roles.add(r);
	}
	const hasOrphans = ledger.some((e) => roleOf(e) === null);

	// What each role should have taken. A slot that cannot take more right now (setting off, not
	// linked, run older than the link) keeps what it has until the run row is deleted.
	const plan = new Map<string | null, { want: number; had: number }>();
	const hadOf = (r: string | null) =>
		round1(ledger.filter((e) => roleOf(e) === r).reduce((a, e) => a + e[1], 0));
	for (const r of [...roles, ...(hasOrphans ? [null] : [])]) {
		const had = hadOf(r);
		let want: number;
		if (!run) want = 0;
		else if (r === null) want = had;
		else {
			const f = slots.get(r)!;
			const open = cfg.spoolmanAutoDeduct && linked(r);
			const linkedAt = f?.spoolmanLinkedAt ? f.spoolmanLinkedAt.getTime() : null;
			const frozen = !open || isPreLinkRun(runWhen!, linkedAt);
			want = frozen ? had : runCountsForDeduction(runWhen!, linkedAt) ? (grams[r] ?? 0) : 0;
			if (!f) want = had;
		}
		plan.set(r, { want: round1(want), had });
	}
	if (![...plan.values()].some((p) => Math.abs(p.want - p.had) > EPS)) return {};

	let client: SpoolmanClient;
	try {
		client = factory(cfg.spoolmanUrl);
	} catch (e) {
		return { warning: e instanceof Error ? e.message : 'Invalid Spoolman address' };
	}

	// A legacy link gets its link time stamped here: never later than this run, so the run (and
	// its later edits) still counts as after the link; older runs become pre-link.
	const stampAt = new Date(
		Math.min(
			Date.now(),
			runWhen?.createdAt ?? Date.now(),
			runWhen ? Date.parse(`${runWhen.date}T00:00:00Z`) || Date.now() : Date.now()
		)
	);
	await backfillFilamentIds(db, buildId, client, stampAt);
	slots = loadSlots();
	const deadline = Date.now() + LOCK_BUDGET_MS;
	let entries = ledger.map((e) => [...e] as DeductionEntry);
	let warning: string | undefined;
	let total = 0;
	for (const [r, p] of plan) {
		const delta = round1(p.want - p.had);
		if (Math.abs(delta) <= EPS) continue;
		if (delta < 0) {
			const back = await giveBack(client, entries, roleOf, r, -delta, deadline);
			entries = back.entries;
			total -= back.given;
			warning ??= back.warning;
			continue;
		}
		const f = slots.get(r as string)!;
		const t = await takeGrams(
			client,
			{ filamentId: f.spoolmanFilamentId, spoolId: f.spoolmanSpoolId },
			r as string,
			delta,
			deadline
		);
		for (const e of t.entries) {
			const last = entries[entries.length - 1];
			if (last && last[0] === e[0] && ledgerRole(last) === e[2]) last[1] = round1(last[1] + e[1]);
			else entries.push(e);
			total += e[1];
		}
		warning ??= t.warning;
		if (t.advances.length) {
			try {
				recordAdvances(db, buildId, org, r as string, t.advances, () =>
					f.spoolmanFilamentId != null
						? (readCached(db, org, f.spoolmanFilamentId)?.name ?? null)
						: null
				);
			} catch {
				// a draft or a vanished build: the deduction itself is already recorded below
			}
		}
	}
	setDeduction(
		db,
		org,
		runId,
		entries.filter((e) => e[1] > EPS)
	);

	// Fresh stock for Spare; best effort, Spoolman may have just gone away.
	const fids = [...slots.values()]
		.map((f) => f.spoolmanFilamentId)
		.filter((x): x is number => x != null);
	if (fids.length && total !== 0) await refreshFilaments(db, org, client, fids);
	return { warning, deducted: round1(total) };
}

export { SpoolmanError };
