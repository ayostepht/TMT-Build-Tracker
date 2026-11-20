/**
 * Re-derive part statuses from a run history, for when a past print log is
 * edited or deleted. Pure; it replays the runs through `applyRun`, so the rules
 * are the ones used when logging.
 */
import { applyRun, isPieceRun, runTargets, type RunOpts } from './actions.ts';
import type { BuildView, PartPatch, PartState, PrintRun } from './types.ts';

/**
 * Patches that make `slugs` consistent with `runs` (oldest first, the history
 * AFTER the edit). Parts not in `slugs` are never touched. Per part:
 * enough Success runs -> Printed (printedOn = the completing run's date, all
 * components ticked when it was not Printed before); otherwise a Failed run
 * leaves Reprint; some Success runs but not enough -> Printing only when the
 * part is Printing now, else To print; no runs -> To print.
 * A slug in `opts.livePrinting` that is Printing now stays Printing (start time and estimate kept)
 * unless the history completes it: a newer print is running on a live job. So does a part with a
 * piece print on the printer (`printingComps`), whatever runs are edited.
 * Piece runs (`PrintRun.comps`): the ticks they made are replayed too. The part's ticks are first
 * stripped of the pieces its piece Success runs in the OLD history (`view.runs`) ticked, then the NEW
 * history ticks its own again, so deleting or failing a piece run unticks exactly those pieces and
 * pieces ticked by hand otherwise stay.
 * Returns only the patches that change something.
 */
export function recomputeParts(
	view: BuildView,
	runs: PrintRun[],
	slugs: string[],
	opts: RunOpts & {
		/** Default true: a part with a piece print on the printer stays Printing (see above). `releaseUnstarted` sets false. */
		keepPieces?: boolean;
	} = {}
): PartPatch[] {
	const out: PartPatch[] = [];
	for (const slug of new Set(slugs)) {
		const cur = view.state[slug];
		if (!cur) continue;

		// Pieces the old history's successful piece runs ticked: not the part's own to keep.
		const pieceSuccess = (rs: readonly PrintRun[]) =>
			rs.filter((r) => r.result === 'Success' && isPieceRun(r) && r.partSlug === slug && r.comps);
		const oldPieces = pieceSuccess(view.runs);
		const touchesPieces = oldPieces.length > 0 || pieceSuccess(runs).length > 0;
		const baseTicks = { ...cur.comps };
		for (const r of oldPieces) for (const i of r.comps ?? []) delete baseTicks[String(i)];

		let sim: PartState = {
			...cur,
			status: 'To print',
			startedAt: null,
			printedOn: null,
			runEstSeconds: null,
			comps: touchesPieces ? baseTicks : cur.comps,
			printingComps: null
		};
		let compsPatch: Record<string, boolean> | undefined;
		const seen: PrintRun[] = [];
		for (const r of runs) {
			if (runTargets(view, r).includes(slug)) {
				const simView: BuildView = { ...view, state: { ...view.state, [slug]: sim }, runs: seen };
				const p = applyRun(simView, r, new Date(), opts).find((x) => x.slug === slug);
				if (p) {
					const { slug: _s, comps, ...rest } = p;
					void _s;
					sim = { ...sim, ...rest };
					// A piece run's ticks carry on to the next run; a whole run's "all ticked" is only
					// written back when it completes a part that was not Printed before.
					if (comps && isPieceRun(r)) sim.comps = comps;
					else if (comps) compsPatch = comps;
				}
			}
			seen.push(r);
		}

		let status = sim.status;
		if (status === 'Printing' && cur.status !== 'Printing') status = 'To print';
		if (status !== 'Printed' && cur.status === 'Printing' && opts.livePrinting?.has(slug)) {
			status = 'Printing';
		}
		// A piece print on the printer now is newer than any run edited here.
		const pieceOnPrinter =
			opts.keepPieces !== false && cur.status === 'Printing' && !!cur.printingComps?.length;
		if (status !== 'Printed' && pieceOnPrinter) status = 'Printing';
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
		if (touchesPieces) {
			const ticks = status === 'Printed' && patch.comps ? patch.comps : sim.comps;
			const same = (a: Record<string, boolean>, b: Record<string, boolean>) =>
				[...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => !!a[k] === !!b[k]);
			if (!same(ticks, cur.comps ?? {})) patch.comps = ticks;
		}
		// The piece list goes with a print that is no longer on the printer.
		if (cur.printingComps && !(keepPrinting && pieceOnPrinter)) patch.printingComps = null;
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
	const byRuns = new Map(
		recomputeParts(view, view.runs, printing, { keepPieces: false }).map((p) => [p.slug, p])
	);
	return printing.map((slug) => {
		const p = byRuns.get(slug);
		const patch: PartPatch = { slug, startedAt: null, runEstSeconds: null };
		if (view.state[slug].printingComps) patch.printingComps = null;
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
