import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { organizationSettings } from './db/schema';

export interface OrgSettings {
	spoolmanUrl: string | null;
	spoolmanAutoDeduct: boolean;
	/** Log finished prints automatically (needs a plate link and slicer grams). */
	autoLogPrints: boolean;
	/**
	 * Who keeps Spoolman's weights up to date: 'app' = this app deducts logged grams (auto-deduct),
	 * 'other' = something else does (the app never writes weights; Spare follows this).
	 */
	spoolmanKeptBy: SpoolmanKeptBy;
}

export type SpoolmanKeptBy = 'app' | 'other';

/**
 * One ledger entry: [spoolId, grams, role]. Entries written before the role was added have two
 * elements and read as role unknown (use `ledgerRole`).
 */
export type DeductionEntry = [spoolId: number, grams: number, role?: string];

type Extra = {
	autoLogPrints?: boolean;
	spoolmanKeptBy?: SpoolmanKeptBy;
	spoolmanDeductions?: Record<string, DeductionEntry[]>;
};

/** The role an entry was deducted for, or null for an old two-element entry. */
export function ledgerRole(e: DeductionEntry): string | null {
	return typeof e[2] === 'string' ? e[2] : null;
}

/**
 * Ledger key for the one-off "also subtract the grams logged before linking" deduction of a slot.
 * It lives in the same ledger as run deductions, so it is read, undone and given back the same way.
 */
export function prelinkLedgerKey(buildId: string, roleKey: string): string {
	return `prelink:${buildId}:${roleKey}`;
}

function normalizeEntries(raw: unknown): DeductionEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: DeductionEntry[] = [];
	for (const e of raw) {
		if (!Array.isArray(e) || !Number.isFinite(e[0]) || !Number.isFinite(e[1])) continue;
		out.push(typeof e[2] === 'string' ? [e[0], e[1], e[2]] : [e[0], e[1]]);
	}
	return out;
}

export function getOrgSettings(db: Db, orgId: string): OrgSettings {
	const r = db
		.select()
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, orgId))
		.get();
	const extra = (r?.settings ?? {}) as Extra;
	return {
		spoolmanUrl: r?.spoolmanUrl ?? null,
		spoolmanAutoDeduct: r?.spoolmanAutoDeduct ?? false,
		autoLogPrints: extra.autoLogPrints === true,
		// Not chosen yet: a workspace with no Spoolman address starts as 'app'; one that already has an
		// address keeps what it had (auto-deduct on = 'app', off = 'other').
		spoolmanKeptBy:
			extra.spoolmanKeptBy ?? (r?.spoolmanUrl ? (r.spoolmanAutoDeduct ? 'app' : 'other') : 'app')
	};
}

/**
 * Spoolman deduction ledger: run id (or `prelinkLedgerKey`) -> entries. Kept in the settings json.
 * Old two-element entries are returned as they are.
 */
export function getDeductions(db: Db, orgId: string): Record<string, DeductionEntry[]> {
	const r = db
		.select({ s: organizationSettings.settings })
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, orgId))
		.get();
	const raw = ((r?.s ?? {}) as Extra).spoolmanDeductions ?? {};
	const out: Record<string, DeductionEntry[]> = {};
	for (const [k, v] of Object.entries(raw)) {
		const entries = normalizeEntries(v);
		if (entries.length) out[k] = entries;
	}
	return out;
}

function upsert(
	db: Db,
	orgId: string,
	mutate: (cur: Record<string, unknown>) => Partial<typeof organizationSettings.$inferInsert>
) {
	const cur = db
		.select()
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, orgId))
		.get();
	const settings = { ...((cur?.settings ?? {}) as Record<string, unknown>) };
	const set = mutate(settings);
	const row = { settings, updatedAt: new Date(), ...set };
	if (cur)
		db.update(organizationSettings)
			.set(row)
			.where(eq(organizationSettings.organizationId, orgId))
			.run();
	else
		db.insert(organizationSettings)
			.values({ organizationId: orgId, ...row })
			.run();
}

export function setOrgSettings(db: Db, orgId: string, patch: Partial<OrgSettings>): void {
	// First Spoolman address with no choice made yet: the workspace starts as "this app keeps it up
	// to date" (auto-deduct on).
	const cur = db
		.select()
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, orgId))
		.get();
	const firstAddress =
		!!patch.spoolmanUrl &&
		!cur?.spoolmanUrl &&
		((cur?.settings ?? {}) as Extra).spoolmanKeptBy === undefined &&
		patch.spoolmanKeptBy === undefined &&
		patch.spoolmanAutoDeduct === undefined;
	if (firstAddress) patch = { ...patch, spoolmanKeptBy: 'app' };
	upsert(db, orgId, (settings) => {
		const set: Partial<typeof organizationSettings.$inferInsert> = {};
		if (patch.spoolmanUrl !== undefined) set.spoolmanUrl = patch.spoolmanUrl;
		if (patch.spoolmanAutoDeduct !== undefined) set.spoolmanAutoDeduct = patch.spoolmanAutoDeduct;
		// "Kept up to date by" is the user-facing form of auto-deduct: keep the column in step so the
		// existing deduction code keeps working. An explicit spoolmanKeptBy wins over the boolean.
		if (patch.spoolmanKeptBy !== undefined) {
			settings.spoolmanKeptBy = patch.spoolmanKeptBy;
			set.spoolmanAutoDeduct = patch.spoolmanKeptBy === 'app';
		} else if (patch.spoolmanAutoDeduct !== undefined) {
			settings.spoolmanKeptBy = patch.spoolmanAutoDeduct ? 'app' : 'other';
		}
		if (patch.autoLogPrints !== undefined) settings.autoLogPrints = patch.autoLogPrints;
		return set;
	});
}

export function setDeduction(
	db: Db,
	orgId: string,
	runId: string,
	entries: DeductionEntry[] | null
): void {
	upsert(db, orgId, (settings) => {
		const all = { ...((settings.spoolmanDeductions as Record<string, DeductionEntry[]>) ?? {}) };
		if (entries && entries.length) all[runId] = entries;
		else delete all[runId];
		settings.spoolmanDeductions = all;
		return {};
	});
}

/** "Start on printer X": the plate the user said they are printing there. A suggestion the user confirms; cleared when a job attaches or ends. */
export interface ExpectedPlate {
	buildId: string;
	plate: number;
	/** The part(s) the next job covers (perPartRuns plates: one color per print). */
	partSlugs?: string[];
	/** Only these pieces (indexes into the part's `components`) of the single part in `partSlugs` are on the print. */
	comps?: number[];
	/** The unlinked job that was already running when it was sent, or the first job that started after. */
	jobId?: string;
	at: number;
}
export function getExpected(db: Db, orgId: string, printerId: string): ExpectedPlate | null {
	const r = db
		.select({ s: organizationSettings.settings })
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, orgId))
		.get();
	const all = ((r?.s ?? {}) as { expected?: Record<string, ExpectedPlate> }).expected ?? {};
	return all[printerId] ?? null;
}
export function setExpected(
	db: Db,
	orgId: string,
	printerId: string,
	e: ExpectedPlate | null
): void {
	upsert(db, orgId, (settings) => {
		const all = { ...((settings.expected as Record<string, ExpectedPlate>) ?? {}) };
		if (e) all[printerId] = e;
		else delete all[printerId];
		settings.expected = all;
		return {};
	});
}
