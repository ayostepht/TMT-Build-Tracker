/**
 * Moving grams in Spoolman for one slot: take grams from the slot's current spool (moving on to
 * the next open spool of the linked filament when one runs out) and give grams back newest first.
 * No DB here; callers hold `withSpoolmanLock` and write the ledger. Never throws: a Spoolman
 * failure stops the work and comes back as `warning`, with the entries that did happen.
 */
import { and, eq } from 'drizzle-orm';
import type { DeductionEntry } from '../org-settings';
import { ledgerRole } from '../org-settings';
import type { Db } from '../db';
import { buildFilaments } from '../db/schema';
import { mutateBuildSystem } from '../builds/actions';
import { getMemberActor } from '../printers/system';
import { openSpools } from './cache';
import { SpoolmanError, type SpoolmanClient } from './client';
import { LOCK_BUDGET_MS } from './lock';

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const EPS = 0.05;
const TOO_SLOW = 'Spoolman is taking too long; try again in a moment';

export interface Advance {
	from: number | null;
	to: number;
}

const warnOf = (e: unknown) =>
	`Spoolman: ${e instanceof SpoolmanError ? e.message : 'update failed'}`;

/** Add an entry; same spool and role as the newest entry merges into it. */
export function pushEntry(
	list: DeductionEntry[],
	spool: number,
	grams: number,
	role: string
): void {
	const last = list[list.length - 1];
	if (last && last[0] === spool && ledgerRole(last) === role) last[1] = round1(last[1] + grams);
	else list.push([spool, round1(grams), role]);
}

/**
 * Take `grams` for a slot. `link.filamentId` set: when the current spool is empty or runs out,
 * the next open spool of that filament (lowest id) takes over; when none is left the last spool
 * keeps the rest (grams are never lost). No filament (legacy spool-only link): that spool only.
 */
export async function takeGrams(
	client: SpoolmanClient,
	link: { filamentId: number | null; spoolId: number | null },
	role: string,
	grams: number,
	deadline = Date.now() + LOCK_BUDGET_MS
): Promise<{
	entries: DeductionEntry[];
	spoolId: number | null;
	advances: Advance[];
	warning?: string;
}> {
	const entries: DeductionEntry[] = [];
	const advances: Advance[] = [];
	let cur = link.spoolId;
	let left = round1(grams);
	const used = new Set<number>();
	try {
		let siblings: ReturnType<typeof openSpools> | null = null;
		const next = async (): Promise<number | null> => {
			if (link.filamentId == null) return null;
			siblings ??= openSpools(await client.getFilamentWithSpools(link.filamentId));
			return siblings.find((s) => !used.has(s.id) && s.id !== cur)?.id ?? null;
		};
		for (let guard = 0; guard < 25 && left > EPS; guard++) {
			if (Date.now() > deadline) throw new SpoolmanError(TOO_SLOW);
			if (cur == null) {
				const n = await next();
				if (n == null) {
					return {
						entries,
						spoolId: cur,
						advances,
						warning: 'Spoolman: no open spool left for this filament'
					};
				}
				advances.push({ from: null, to: n });
				cur = n;
			}
			used.add(cur);
			const info = await client.getSpool(cur);
			const rem = info.remainingG;
			const exhausted = info.archived || (rem != null && rem <= 0);
			if (exhausted && link.filamentId != null) {
				const n = await next();
				if (n != null) {
					advances.push({ from: cur, to: n });
					cur = n;
					continue;
				}
			}
			const hasNext = link.filamentId != null && !exhausted && rem != null && rem > 0 && rem < left;
			const nextId = hasNext ? await next() : null;
			const take = nextId != null ? round1(rem as number) : left;
			if (take > EPS) {
				await client.useWeight(cur, take);
				pushEntry(entries, cur, take, role);
				left = round1(left - take);
			}
			if (left > EPS && nextId != null) {
				advances.push({ from: cur, to: nextId });
				cur = nextId;
			} else break;
		}
	} catch (e) {
		return { entries, spoolId: cur, advances, warning: warnOf(e) };
	}
	return { entries, spoolId: cur, advances };
}

/**
 * Give `grams` back, newest entry first (LIFO), only from entries of `role` (null = entries of no
 * known role). Returns the ledger entries that remain and how much really went back.
 */
export async function giveBack(
	client: SpoolmanClient,
	ledger: DeductionEntry[],
	roleOf: (e: DeductionEntry) => string | null,
	role: string | null,
	grams: number,
	deadline = Date.now() + LOCK_BUDGET_MS
): Promise<{ entries: DeductionEntry[]; given: number; warning?: string }> {
	const entries = ledger.map((e) => [...e] as DeductionEntry);
	let left = round1(grams);
	let given = 0;
	try {
		for (let i = entries.length - 1; i >= 0 && left > EPS; i--) {
			if (Date.now() > deadline) throw new SpoolmanError(TOO_SLOW);
			const e = entries[i];
			if (roleOf(e) !== role) continue;
			const g = round1(Math.min(e[1], left));
			if (g <= EPS) continue;
			await client.restoreWeight(e[0], g);
			e[1] = round1(e[1] - g);
			left = round1(left - g);
			given = round1(given + g);
		}
	} catch (e) {
		return { entries: entries.filter((x) => x[1] > EPS), given, warning: warnOf(e) };
	}
	return { entries: entries.filter((x) => x[1] > EPS), given };
}

/** Write each auto-advance to the slot (and the activity feed, with the SSE event). */
export function recordAdvances(
	db: Db,
	buildId: string,
	org: string,
	role: string,
	advances: Advance[],
	nameOf: (spoolId: number) => string | null
): void {
	const actor = getMemberActor(db, org);
	if (!actor) return;
	for (const a of advances) {
		mutateBuildSystem(db, buildId, actor, 'Spoolman', (tx) => {
			tx.update(buildFilaments)
				.set({ spoolmanSpoolId: a.to })
				.where(and(eq(buildFilaments.buildId, buildId), eq(buildFilaments.roleKey, role)))
				.run();
			return {
				kind: 'filament.spoolman.spool',
				payload: {
					role,
					spoolId: a.to,
					spoolName: nameOf(a.to),
					...(a.from != null ? { fromSpoolId: a.from } : {}),
					auto: true
				}
			};
		});
	}
}
