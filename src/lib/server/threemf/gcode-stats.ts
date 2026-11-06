/**
 * Per-object print cost from the G-code inside a sliced 3MF (`Metadata/plate_N.gcode`).
 *
 * Each plate's G-code entry is stream-inflated through the zip's central directory in 1 MB chunks and fed to
 * the incremental `GcodeObjectScanner`; nothing but the running totals is kept, so a 340 MB project with
 * 24 plates of 90 MB G-code each costs time (seconds) but no memory. Plates run one after another under a
 * time budget; a plate that is not reached keeps no `exact` data and falls back to volume shares later.
 */
import { GcodeObjectScanner } from '#lib/domain/gcode-objects.ts';
import type { ExactObject, ThreeMfSummary } from '#lib/domain/threemf.ts';
import { entryChunks, readZipDirectory } from './zipfile';

const TAIL = /_id_\d+_copy_\d+$/i;
export const stripCopyTail = (name: string) => name.replace(TAIL, '').trim();

export interface GcodeStatsReport {
	/** Plates that got exact data. */
	plates: number;
	/** Plates in the file that have a G-code entry. */
	withGcode: number;
	ms: number;
	/** Why the work stopped early (budget), or null. */
	note: string | null;
}

/** Default budget for all plates of one file, ms (override with `TMT_GCODE_BUDGET_MS`). */
export const gcodeBudgetMs = () => {
	const v = Number(process.env.TMT_GCODE_BUDGET_MS);
	return Number.isFinite(v) && v > 0 ? v : 240_000;
};

/**
 * Adds `exact` to each plate of `summary` whose G-code names its objects. Never throws: a file
 * without G-code, without object markers or with unreadable entries is simply left as it is.
 */
export async function attachGcodeObjectStats(
	path: string,
	summary: ThreeMfSummary,
	budgetMs = gcodeBudgetMs()
): Promise<GcodeStatsReport> {
	const t0 = performance.now();
	const rep: GcodeStatsReport = { plates: 0, withGcode: 0, ms: 0, note: null };
	let dir;
	try {
		dir = await readZipDirectory(path);
	} catch {
		return rep;
	}
	const byName = new Map(dir.map((e) => [e.name, e]));
	for (const pl of summary.plates) {
		const entry = byName.get(`Metadata/plate_${pl.index}.gcode`);
		if (!entry) continue;
		rep.withGcode++;
		if (performance.now() - t0 > budgetMs) {
			rep.note = `Per-object measuring stopped after ${Math.round(budgetMs / 1000)} s; the remaining plates are shared by volume.`;
			break;
		}
		try {
			const scan = new GcodeObjectScanner();
			for await (const chunk of entryChunks(path, entry)) scan.push(chunk);
			const res = scan.finish();
			if (!res.hasMarkers) continue;
			const merged = new Map<string, ExactObject>();
			for (const [raw, cost] of res.objects) {
				if (!raw) continue;
				const name = stripCopyTail(raw);
				const cur = merged.get(name) ?? { name, seconds: 0, mm: {} };
				cur.seconds += cost.seconds;
				for (const [tool, mm] of Object.entries(cost.mmByTool)) {
					const idx = String(Number(tool) + 1); // G-code tools are 0-based, the 3MF's filaments 1-based
					cur.mm[idx] = (cur.mm[idx] ?? 0) + mm;
				}
				merged.set(name, cur);
			}
			if (merged.size) {
				pl.exact = [...merged.values()].map((o) => ({
					name: o.name,
					seconds: Math.round(o.seconds * 10) / 10,
					mm: Object.fromEntries(Object.entries(o.mm).map(([k, v]) => [k, Math.round(v * 10) / 10]))
				}));
				rep.plates++;
			}
		} catch {
			/* unreadable entry: this plate keeps the volume split */
		}
	}
	rep.ms = Math.round(performance.now() - t0);
	return rep;
}
