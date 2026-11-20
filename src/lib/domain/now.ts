/** Data for the "Now printing" cards. */
import {
	partGrams,
	plateByNumber,
	printGrams,
	printingFractions,
	subsetShare,
	weakestGramsSource
} from './accounting.ts';
import { betweenRuns, runInfo } from './actions.ts';
import type { BuildView, GramsSource, PartDef, Plate } from './types.ts';

export interface NowCard {
	plate: number;
	name: string;
	parts: PartDef[]; // the parts on the printer (a subset of the plate on multi-color plates)
	roles: string[];
	multiColor: boolean;
	gramsPerRun: number | null; // plateGrams: typed > sliced file > your slice / BOM of its parts
	gramsSource: GramsSource; // where gramsPerRun comes from
	gramsApprox: boolean; // an estimate (BOM based or missing parts)
	gramsUnknown: string[]; // parts on the printer with no weight
	slicerGrams: number | null; // what the slicer field shows, if set
	subset: boolean; // only some parts (or some pieces of a part) of a single-run plate are on the printer: figures are their share
	/** Parts of which only some pieces are on the printer ("Print some pieces…"): the pieces picked, by name. */
	pieces: { slug: string; picked: string[]; of: number }[];
	startedAt: string | null;
	estSeconds: number | null;
	estSource: 'manual' | 'slicer' | 'learned' | 'template' | 'estimate' | null;
	run: { run: number; of: number } | null;
}

export function plateOf(view: BuildView, slug: string): Plate | null {
	return view.plates.find((p) => p.parts.includes(slug)) ?? null;
}

export function nowPrinting(view: BuildView): NowCard[] {
	// Parts between the runs of a multi-run plate are marked Printing but nothing is on the printer.
	const printing = view.parts.filter(
		(p) => view.state[p.slug]?.status === 'Printing' && !betweenRuns(view, p.slug)
	);
	const byPlate = new Map<number, PartDef[]>();
	for (const p of printing) {
		const pl = plateOf(view, p.slug);
		if (!pl) continue;
		byPlate.set(pl.number, [...(byPlate.get(pl.number) ?? []), p]);
	}
	return [...byPlate.keys()]
		.sort((a, b) => a - b)
		.map((n) => {
			const plate = plateByNumber(view, n)!;
			const here = byPlate.get(n)!;
			const slugs = here.map((p) => p.slug);
			const onPlate = plate.parts
				.map((s) => view.parts.find((p) => p.slug === s))
				.filter((p): p is PartDef => !!p);
			const multiColor = new Set(onPlate.map((p) => p.role)).size > 1;
			const raw = plate.perPartRuns ? plate.slicerByPart[slugs[0]] : plate.slicerGrams;
			// Some parts of a plate on the printer (picked on their own): their share of the plate, and the
			// plate's typed total is not theirs to show or edit.
			// A part with only some pieces on the printer counts its pieces' share (by count).
			const frac = printingFractions(view, slugs);
			const pieces = slugs
				.filter((s) => s in frac)
				.map((s) => {
					const part = view.parts.find((p) => p.slug === s)!;
					const on = view.state[s].printingComps ?? [];
					return {
						slug: s,
						picked: on.map((i) => part.components[i]?.name).filter((n): n is string => !!n),
						of: part.components.length
					};
				});
			const share = subsetShare(view, plate, slugs, frac);
			const subset = share < 1;
			const slicerGrams = !subset && typeof raw === 'number' && raw > 0 ? raw : null;
			// A perPartRuns plate prints its parts one by one: add the ones on the printer.
			const infos = plate.perPartRuns
				? slugs.map((s) => partGrams(view, s))
				: [printGrams(view, plate, slugs, frac)];
			const estimate = infos.reduce((a, i) => a + i.perRun, 0);
			const gramsPerRun = estimate > 0 ? estimate : null;
			const runEst = view.state[slugs[0]].runEstSeconds;
			const startedAt =
				slugs
					.map((s) => view.state[s].startedAt)
					.filter((s): s is string => !!s)
					.sort()[0] ?? null;
			const plateEst = plate.estSeconds ? Math.round(plate.estSeconds * share) : 0;
			const estSeconds = runEst || plateEst || null;
			return {
				plate: n,
				name: plate.name || here[0].name,
				parts: here,
				roles: [...new Set(here.map((p) => p.role))],
				multiColor,
				gramsPerRun,
				gramsSource: weakestGramsSource(infos.map((i) => i.source)),
				gramsApprox: infos.some((i) => i.approx),
				gramsUnknown: infos.flatMap((i) => i.unknown),
				slicerGrams,
				subset,
				pieces,
				startedAt,
				estSeconds,
				estSource: runEst
					? 'slicer'
					: plate.estSeconds
						? plate.estSource === 'manual'
							? 'manual'
							: plate.estSource === 'estimate'
								? 'estimate'
								: plate.estSource === 'learned'
									? 'learned'
									: 'template'
						: null,
				run: multiColor
					? here.length === 1
						? runInfo(view, n, here[0].slug)
						: null
					: runInfo(view, n)
			};
		});
}
