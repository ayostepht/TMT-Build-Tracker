import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { organizationSettings } from './db/schema';

export interface OrgSettings {
	spoolmanUrl: string | null;
	spoolmanAutoDeduct: boolean;
	/** Log finished prints automatically (needs a plate link and slicer grams). */
	autoLogPrints: boolean;
}

type Extra = { autoLogPrints?: boolean; spoolmanDeductions?: Record<string, [number, number][]> };

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
		autoLogPrints: extra.autoLogPrints === true
	};
}

/** Per-run Spoolman deduction ledger: run id -> [[spoolId, grams]]. Kept in the settings json. */
export function getDeductions(db: Db, orgId: string): Record<string, [number, number][]> {
	const r = db
		.select({ s: organizationSettings.settings })
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, orgId))
		.get();
	return ((r?.s ?? {}) as Extra).spoolmanDeductions ?? {};
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
	upsert(db, orgId, (settings) => {
		const set: Partial<typeof organizationSettings.$inferInsert> = {};
		if (patch.spoolmanUrl !== undefined) set.spoolmanUrl = patch.spoolmanUrl;
		if (patch.spoolmanAutoDeduct !== undefined) set.spoolmanAutoDeduct = patch.spoolmanAutoDeduct;
		if (patch.autoLogPrints !== undefined) settings.autoLogPrints = patch.autoLogPrints;
		return set;
	});
}

export function setDeduction(
	db: Db,
	orgId: string,
	runId: string,
	entries: [number, number][] | null
): void {
	upsert(db, orgId, (settings) => {
		const all = { ...((settings.spoolmanDeductions as Record<string, [number, number][]>) ?? {}) };
		if (entries && entries.length) all[runId] = entries;
		else delete all[runId];
		settings.spoolmanDeductions = all;
		return {};
	});
}

/** "Start on printer X": the plate the user said they are about to print there (cleared when a job attaches). */
export interface ExpectedPlate {
	buildId: string;
	plate: number;
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
