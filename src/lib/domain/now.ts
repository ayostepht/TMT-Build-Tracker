/** Data for the "Now printing" cards. */
import { estPerRun, plateByNumber, units } from './accounting.ts';
import { runInfo } from './actions.ts';
import type { BuildView, PartDef, Plate } from './types.ts';

export interface NowCard {
	plate: number;
	name: string;
	parts: PartDef[]; // the parts on the printer (a subset of the plate on multi-color plates)
	roles: string[];
	multiColor: boolean;
	gramsPerRun: number | null; // slicer grams if set, else BOM estimate
	slicerGrams: number | null; // what the slicer field shows, if set
	startedAt: string | null;
	estSeconds: number | null;
	estSource: 'slicer' | 'learned' | 'template' | 'estimate' | null;
	run: { run: number; of: number } | null;
}

export function plateOf(view: BuildView, slug: string): Plate | null {
	return view.plates.find((p) => p.parts.includes(slug)) ?? null;
}

export function nowPrinting(view: BuildView): NowCard[] {
	const printing = view.parts.filter((p) => view.state[p.slug]?.status === 'Printing');
	const byPlate = new Map<number, PartDef[]>();
	for (const p of printing) {
		const pl = plateOf(view, p.slug);
		if (!pl) continue;
		byPlate.set(pl.number, [...(byPlate.get(pl.number) ?? []), p]);
	}
	const all = units(view);
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
			const slicerGrams = typeof raw === 'number' && raw > 0 ? raw : null;
			const estimate = all
				.filter((u) => u.plate === n && u.parts.some((p) => slugs.includes(p.slug)))
				.reduce((a, u) => a + estPerRun(view, u), 0);
			const gramsPerRun = slicerGrams ?? (estimate > 0 ? estimate : null);
			const runEst = view.state[slugs[0]].runEstSeconds;
			const startedAt =
				slugs
					.map((s) => view.state[s].startedAt)
					.filter((s): s is string => !!s)
					.sort()[0] ?? null;
			const estSeconds = runEst || plate.estSeconds || null;
			return {
				plate: n,
				name: plate.name || here[0].name,
				parts: here,
				roles: [...new Set(here.map((p) => p.role))],
				multiColor,
				gramsPerRun,
				slicerGrams,
				startedAt,
				estSeconds,
				estSource: runEst
					? 'slicer'
					: plate.estSeconds
						? plate.estSource === 'estimate'
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
