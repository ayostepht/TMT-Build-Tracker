/**
 * Re-derive part statuses from a run history, for when a past print log is
 * edited or deleted. Pure; it replays the runs through `applyRun`, so the rules
 * are the ones used when logging.
 */
import { applyRun, runTargets } from './actions.ts';
import type { BuildView, PartPatch, PartState, PrintRun } from './types.ts';

/**
 * Patches that make `slugs` consistent with `runs` (oldest first, the history
 * AFTER the edit). Parts not in `slugs` are never touched. Per part:
 * enough Success runs -> Printed (printedOn = the completing run's date, all
 * components ticked when it was not Printed before); otherwise a Failed run
 * leaves Reprint; some Success runs but not enough -> Printing only when the
 * part is Printing now, else To print; no runs -> To print.
 * Returns only the patches that change something.
 */
export function recomputeParts(view: BuildView, runs: PrintRun[], slugs: string[]): PartPatch[] {
	const out: PartPatch[] = [];
	for (const slug of new Set(slugs)) {
		const cur = view.state[slug];
		if (!cur) continue;

		let sim: PartState = {
			...cur,
			status: 'To print',
			startedAt: null,
			printedOn: null,
			runEstSeconds: null
		};
		let compsPatch: Record<string, boolean> | undefined;
		const seen: PrintRun[] = [];
		for (const r of runs) {
			if (runTargets(view, r).includes(slug)) {
				const simView: BuildView = { ...view, state: { ...view.state, [slug]: sim }, runs: seen };
				const p = applyRun(simView, r, new Date()).find((x) => x.slug === slug);
				if (p) {
					const { slug: _s, comps, ...rest } = p;
					void _s;
					sim = { ...sim, ...rest };
					if (comps) compsPatch = comps;
				}
			}
			seen.push(r);
		}

		let status = sim.status;
		if (status === 'Printing' && cur.status !== 'Printing') status = 'To print';
		const keepPrinting = status === 'Printing';
		const printedOn = status === 'Printed' ? sim.printedOn : null;
		const startedAt = keepPrinting ? cur.startedAt : null;
		const runEstSeconds = keepPrinting ? cur.runEstSeconds : null;

		const patch: PartPatch = { slug };
		if (status !== cur.status) patch.status = status;
		if (printedOn !== cur.printedOn) patch.printedOn = printedOn;
		if (startedAt !== cur.startedAt) patch.startedAt = startedAt;
		if (runEstSeconds !== cur.runEstSeconds) patch.runEstSeconds = runEstSeconds;
		if (status === 'Printed' && cur.status !== 'Printed' && compsPatch) patch.comps = compsPatch;
		if (Object.keys(patch).length > 1) out.push(patch);
	}
	return out;
}

/**
 * A plate was sent and the job ended before anything printed: parts still Printing go back to
 * the status their run history gives them (`recomputeParts`): Reprint after a failure with no
 * later success, Printed when every run is done, Printing between the runs of a multi-run part,
 * else To print (Printed when it was marked printed by hand). Start time and run time are cleared.
 */
export function releaseUnstarted(view: BuildView, slugs: string[]): PartPatch[] {
	const printing = slugs.filter((s) => view.state[s]?.status === 'Printing');
	const byRuns = new Map(recomputeParts(view, view.runs, printing).map((p) => [p.slug, p]));
	return printing.map((slug) => {
		const p = byRuns.get(slug);
		const patch: PartPatch = { slug, startedAt: null, runEstSeconds: null };
		if (p?.status === 'To print' && view.state[slug].printedOn) {
			patch.status = 'Printed';
			return patch;
		}
		if (p?.status) patch.status = p.status;
		if (p?.printedOn !== undefined) patch.printedOn = p.printedOn;
		if (p?.comps) patch.comps = p.comps;
		return patch;
	});
}
