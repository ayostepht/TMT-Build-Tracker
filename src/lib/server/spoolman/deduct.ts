import { and, eq } from 'drizzle-orm';
import { splitGramsByRole } from '#lib/domain/spool-split.ts';
import type { PrintRunInput } from '#lib/domain/types.ts';
import type { Db } from '../db';
import { builds, buildFilaments, printRuns } from '../db/schema';
import { loadBuildView } from '../builds/view';
import { getDeductions, getOrgSettings, setDeduction } from '../org-settings';
import { getMemberActor } from '../printers/system';
import { SpoolmanClient, SpoolmanError } from './client';

export type ClientFactory = (url: string) => SpoolmanClient;
const defaultFactory: ClientFactory = (url) => new SpoolmanClient(url);

/**
 * Bring Spoolman in line with one run: what the run should have consumed (its grams split
 * over roles with a linked spool, when the team has auto-deduct on) versus what the ledger says
 * was already deducted. Only the difference is sent, so calling it twice does nothing, editing
 * grams adjusts, and a deleted or undone run (row gone) gives its grams back.
 * Never throws; returns a warning for the caller to show.
 */
export async function syncRunDeduction(
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
	if (!b) return {};
	const cfg = getOrgSettings(db, b.org);
	const ledger = getDeductions(db, b.org)[runId] ?? [];
	if (!cfg.spoolmanUrl || (!cfg.spoolmanAutoDeduct && !ledger.length)) return {};

	const run = db
		.select()
		.from(printRuns)
		.where(and(eq(printRuns.id, runId), eq(printRuns.buildId, buildId)))
		.get();

	// Desired spool -> grams
	const want = new Map<number, number>();
	if (run && cfg.spoolmanAutoDeduct && run.result !== 'Partial' && (run.grams ?? 0) > 0) {
		const actor = getMemberActor(db, b.org);
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
			const links = new Map(
				db
					.select({ role: buildFilaments.roleKey, id: buildFilaments.spoolmanSpoolId })
					.from(buildFilaments)
					.where(eq(buildFilaments.buildId, buildId))
					.all()
					.filter((f) => f.id != null)
					.map((f) => [f.role, f.id as number])
			);
			for (const [role, g] of Object.entries(splitGramsByRole(view, input))) {
				const spool = links.get(role);
				if (spool != null) want.set(spool, (want.get(spool) ?? 0) + g);
			}
		}
	}
	const had = new Map<number, number>();
	for (const [id, g] of ledger) had.set(id, (had.get(id) ?? 0) + g);

	const ids = new Set([...want.keys(), ...had.keys()]);
	if (![...ids].some((id) => Math.abs((want.get(id) ?? 0) - (had.get(id) ?? 0)) > 0.05)) return {};

	let client: SpoolmanClient;
	try {
		client = factory(cfg.spoolmanUrl);
	} catch (e) {
		return { warning: e instanceof Error ? e.message : 'Invalid Spoolman address' };
	}
	const done = new Map(had);
	let warning: string | undefined;
	let total = 0;
	for (const id of ids) {
		const delta = Math.round(((want.get(id) ?? 0) - (had.get(id) ?? 0)) * 10) / 10;
		if (Math.abs(delta) <= 0.05) continue;
		try {
			if (delta > 0) await client.useWeight(id, delta);
			else await client.restoreWeight(id, -delta);
			done.set(id, want.get(id) ?? 0);
			total += delta;
		} catch (e) {
			warning = `Spoolman: ${e instanceof SpoolmanError ? e.message : 'update failed'}`;
		}
	}
	setDeduction(
		db,
		b.org,
		runId,
		[...done.entries()].filter(([, g]) => g > 0.05)
	);
	return { warning, deducted: total };
}
