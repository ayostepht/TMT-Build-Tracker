/**
 * The grams text of a plate header, next to the time (`plateTimeBadge`). Pure: no DB, no Svelte.
 *
 * Per run, like the time ("~417 g per run · 834 g total" on a plate printed twice), because the
 * maker prints, weighs and logs one run at a time. Parts show their total for all copies instead.
 * Marks: "~" an estimate (MakeGood BOM), "≥" a total that leaves parts without weight out,
 * "your entry" typed, "from file" / "from your slice" measured.
 */
import { fmt } from './format.ts';
import { plateGrams } from './accounting.ts';
import type { BuildView, GramsSource, Plate } from './types.ts';

export interface PlateGramsBadge {
	/** Headline: "~417 g", "≥ 417 g", "417 g"; empty when no part of the plate has a weight. */
	main: string;
	/** Where it comes from: "your entry", "from file", "from your slice"; empty for an estimate (the "~" says it). */
	note: string;
	/** Multi-run plates: "834 g total". */
	total: string;
	/** "1 part without weight"; empty when none. */
	flag: string;
	/** Slugs of the parts without weight, for the quick "Add weight". */
	unknown: string[];
	title: string;
	source: GramsSource;
}

const NOTE: Partial<Record<GramsSource, string>> = {
	user: 'your entry',
	file: 'from file',
	slice: 'from your slice'
};
const TITLE: Record<GramsSource, string> = {
	user: 'Weight you entered',
	file: 'Weight from the sliced file',
	slice: 'Weight from your slice',
	bom: 'Estimate from the MakeGood kit weights of the parts',
	none: 'No weight known'
};

/** Grams badge for a plate of the view; null when the plate has no parts in the build. */
export function plateGramsBadge(view: BuildView, plate: Plate): PlateGramsBadge | null {
	if (!plate.parts.some((s) => view.parts.some((p) => p.slug === s))) return null;
	const g = plateGrams(view, plate);
	const n = g.unknown.length;
	const flag = n ? `${n} part${n === 1 ? '' : 's'} without weight` : '';
	const noneKnown = g.source === 'none' || g.perRun <= 0;
	if (noneKnown)
		return {
			main: '',
			note: '',
			total: '',
			flag: flag || 'no weight',
			unknown: g.unknown,
			title: TITLE.none,
			source: 'none'
		};
	const mark = n ? '≥ ' : g.approx || g.source === 'bom' ? '~' : '';
	const runs = g.perRun > 0 ? g.total / g.perRun : 1;
	const multi = runs > 1.01;
	return {
		main: `${mark}${fmt(g.perRun)} g${multi ? ' per run' : ''}`,
		note: NOTE[g.source] ?? '',
		total: multi ? `${mark}${fmt(g.total)} g total` : '',
		flag,
		unknown: g.unknown,
		title: TITLE[g.source] + (n ? '; parts without a weight are left out' : ''),
		source: g.source
	};
}
