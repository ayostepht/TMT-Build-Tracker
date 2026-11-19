/**
 * Spoolman rules that are pure (issue #59): which logged runs may ever be deducted from a linked
 * spool, how a cached Spoolman filament record reads, and what "Spare" starts from while a slot
 * is linked. No DB, no HTTP. The run-by-role grams live in `accounting.ts` (`linkedRunGrams`).
 *
 * The pre-link rule: a run that was dated or logged before the slot was linked to Spoolman is
 * never deducted (Spoolman's weight already reflects it, or the maker chose the one-off
 * `prelink:` deduction), also when it is edited or undone later.
 */
import type { PrintRun, RoleSpoolman, SpoolmanKeptBy, SpoolmanStockView } from './types.ts';

/** The calendar day (YYYY-MM-DD, UTC) of a timestamp in ms: what run dates are compared with. */
export function dayOf(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

type RunWhen = Pick<PrintRun, 'date'> & { createdAt?: number | null };

/**
 * True when the run is older than the link: it was logged before `linkedAt`, or it is dated on a
 * day before the link day (a run backdated to before the link is a pre-link print too). A run
 * with no known creation time is judged by its date alone, so a run dated the link day counts as
 * after the link. `linkedAt` null (legacy or unlinked) means nothing is pre-link.
 */
export function isPreLinkRun(run: RunWhen, linkedAt: number | null | undefined): boolean {
	if (linkedAt == null) return false;
	if (typeof run.createdAt === 'number' && run.createdAt < linkedAt) return true;
	return run.date < dayOf(linkedAt);
}

/** A run whose grams may be taken from Spoolman at all: has grams and is not an old Partial row (never deducted). */
export function isDeductibleRun(run: Pick<PrintRun, 'result' | 'grams'>): boolean {
	return run.result !== 'Partial' && (Number(run.grams) || 0) > 0;
}

/**
 * The one test the deduction code asks for a run: deduct it from the linked spool? Both edit and
 * undo paths use it too (a pre-link run edited after the link still wants nothing).
 */
export function runCountsForDeduction(
	run: RunWhen & Pick<PrintRun, 'result' | 'grams'>,
	linkedAt: number | null | undefined
): boolean {
	return isDeductibleRun(run) && !isPreLinkRun(run, linkedAt);
}

/** A slot counts as linked for Spare once it points at a Spoolman filament. */
export function isSpoolmanLinked(sp: Pick<RoleSpoolman, 'filamentId'> | null | undefined): boolean {
	return sp?.filamentId != null;
}

// ---- Cached Spoolman record --------------------------------------------------------------------

/**
 * What the printers agent stores in `spoolman_cache.data`: the Spoolman filament record as the
 * API returns it, plus its spools under `spools` (Spoolman field names, all optional here).
 */
export interface SpoolmanCacheData {
	id?: number;
	name?: string;
	material?: string;
	color_hex?: string;
	vendor?: { name?: string } | null;
	/** Net filament weight of a new spool (g). */
	weight?: number | null;
	spool_weight?: number | null;
	density?: number | null;
	spools?: {
		id: number;
		remaining_weight?: number | null;
		initial_weight?: number | null;
		archived?: boolean;
	}[];
}

const finite = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Read a cache row into the stock a slot shows. `remainingG` / `initialG` are the sum over ALL the
 * filament's open (not archived) spools, whichever one is current: the grams on hand of that
 * colour, which is what Spare starts from. `currentSpoolRemainingG` is the spool in use alone
 * (`spoolId`, archived or not), null when none is chosen or it is not in the record. Null totals
 * when Spoolman gave no spool numbers; 0 when every spool is archived. Never throws on a
 * malformed record.
 */
export function readSpoolmanStock(
	data: unknown,
	row: { fetchedAt: number; error: string | null },
	spoolId: number | null
): SpoolmanStockView {
	const d = (data && typeof data === 'object' ? data : {}) as SpoolmanCacheData;
	const spools = Array.isArray(d.spools) ? d.spools.filter((s) => s && typeof s === 'object') : [];
	const open = spools.filter((s) => !s.archived);
	const sum = (
		list: typeof spools,
		pick: (s: (typeof spools)[number]) => unknown
	): number | null => {
		const vals = list.map((s) => finite(pick(s))).filter((x): x is number => x !== null);
		return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
	};
	const current = spoolId != null ? spools.find((s) => s.id === spoolId) : undefined;
	return {
		remainingG: sum(open, (s) => s.remaining_weight) ?? (spools.length ? 0 : null),
		initialG: sum(open, (s) => s.initial_weight ?? d.weight),
		currentSpoolRemainingG: current ? finite(current.remaining_weight) : null,
		fetchedAt: row.fetchedAt,
		stale: row.error != null,
		error: row.error
	};
}

// ---- Spare -------------------------------------------------------------------------------------

export interface HaveInput {
	/** The app's own stock in grams: starting spools plus added spools (`stockKg` * 1000). */
	appStockG: number;
	/** Everything logged on the build for this role (`FilamentStat.used`). */
	usedG: number;
	/** Grams of runs that count for deduction (after the link, see `runCountsForDeduction`). */
	postLinkUsedG: number;
	spoolman?: Pick<RoleSpoolman, 'filamentId' | 'keptBy' | 'stock' | 'deductedG'> | null;
}

export interface Have {
	/** What Spare starts from: spare = `haveGrams - usedGrams - need`. */
	haveGrams: number;
	/** What to subtract for prints already made. */
	usedGrams: number;
	/**
	 * 'app': the app's own spools (not linked). 'spoolman': Spoolman's remaining weight.
	 * 'unknown': linked but Spoolman's weight was never fetched (Spare cannot be told).
	 */
	source: 'app' | 'spoolman' | 'unknown';
}

/**
 * Grams on hand for a slot and the prints to subtract from them, so Spare never counts a print
 * twice:
 * - not linked: the app's own stock minus everything logged (unchanged behaviour);
 * - linked, kept up to date by 'other': Spoolman's remaining weight only. It already reflects
 *   every print the other tool recorded, before and after the link;
 * - linked, kept by 'app': Spoolman's remaining weight (all open spools) minus the logged grams after the link that
 *   the ledger has not yet taken from it (a failed or pending deduction). Pre-link grams are not
 *   in this figure, and the one-off pre-link deduction is already in Spoolman's weight.
 * While linked the app's own starting and added spools are not used (history is kept; they show
 * again on unlink). Pure.
 */
export function haveGramsOf(i: HaveInput): Have {
	const sp = i.spoolman;
	if (!isSpoolmanLinked(sp)) return { haveGrams: i.appStockG, usedGrams: i.usedG, source: 'app' };
	const remaining = sp?.stock?.remainingG ?? null;
	if (remaining == null) return { haveGrams: 0, usedGrams: 0, source: 'unknown' };
	if (sp!.keptBy === 'other') return { haveGrams: remaining, usedGrams: 0, source: 'spoolman' };
	const pending = Math.max(0, Math.round((i.postLinkUsedG - (sp!.deductedG || 0)) * 10) / 10);
	return { haveGrams: remaining, usedGrams: pending, source: 'spoolman' };
}

export type { SpoolmanKeptBy };
