/**
 * The four headline numbers (parts, time, filament, finish), formatted once so the build header and
 * the Stats tiles show the same text. Pure and light: imports only `stats-core.ts` and accounting.
 */
import { filamentStats, overallProgress, timeStats } from './accounting.ts';
import {
	PROJECTION_DAYS,
	PROJECTION_MIN_RUNS,
	failureRates,
	projectFinish,
	round1,
	shortDate,
	type Projection
} from './stats-core.ts';
import type { BuildView } from './types.ts';

const num = (v: number, digits: number) =>
	v.toLocaleString('en-US', { maximumFractionDigits: digits });
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Hours as text: whole hours when `whole`, else one decimal. */
const hoursText = (h: number, whole: boolean) => `${num(h, whole ? 0 : 1)} h`;
/** Grams as "840 g" or, from 1000 g, "1.2 kg". */
const gramsText = (g: number) => (g >= 1000 ? `${num(g / 1000, 1)} kg` : `${num(g, 0)} g`);

export interface BuildKpis {
	parts: { printed: number; total: number; label: string; detail: string };
	time: {
		/** Hours, rounded alike: one decimal while the logged total is under 100 h, else whole. */
		loggedH: number;
		goodH: number;
		failedH: number;
		/** The big number without its unit ("338", "31.5"). */
		value: string;
		/** "338 h". */
		label: string;
		/** "267 h good · 72 h failed". */
		detail: string;
	};
	filament: {
		usedKg: number;
		keptKg: number;
		lostKg: number;
		/** The big number ("1.2" or "840") and its unit ("kg" or "g"). */
		value: string;
		unit: string;
		/** "1.2 kg". */
		label: string;
		/** "1 kg in parts · 200 g lost". */
		detail: string;
	};
	finish: {
		projection: Projection;
		/** "Nov 20", "Done", "No estimate" or "Not yet". */
		label: string;
		detail: string;
	};
}

/**
 * The four headline numbers, formatted once so the build header and the Stats tiles show the same
 * text. Pure and light: no chart or Svelte imports.
 */
export function buildKpis(view: BuildView, now: Date = new Date()): BuildKpis {
	const t = timeStats(view);
	const fil = filamentStats(view);
	const op = overallProgress(view);
	const proj = projectFinish(view, now);

	const whole = t.loggedHours >= 100;
	const r = (h: number) => (whole ? Math.round(h) : round1(h));
	const loggedH = r(t.loggedHours);
	const goodH = r(t.keptHours);
	const failedH = r(t.lostHours);

	const keptG = fil.reduce((s, f) => s + Math.round(f.keptG), 0);
	const lostG = fil.reduce((s, f) => s + Math.round(f.lostG), 0);
	const useG = keptG + lostG;
	const kg = (g: number) => Math.round(g) / 1000;

	const failedPrints = failureRates(view).total.failed;

	let finish: BuildKpis['finish'];
	if (proj.kind === 'projected') {
		finish = {
			projection: proj,
			label: shortDate(proj.date),
			detail: `About ${hoursText(proj.hoursLeft, proj.hoursLeft >= 100)} left at ${num(proj.hoursPerDay, 1)} h a day${
				t.pace ? ` · ${t.pace.text}` : ''
			}`
		};
	} else if (proj.kind === 'done') {
		finish = { projection: proj, label: 'Done', detail: 'Every part is printed' };
	} else if (proj.kind === 'no-estimate') {
		finish = {
			projection: proj,
			label: 'No estimate',
			detail: 'The plates left have no print time yet'
		};
	} else {
		finish = {
			projection: proj,
			label: 'Not yet',
			detail: `Needs ${PROJECTION_MIN_RUNS} prints in the last ${PROJECTION_DAYS} days (${proj.runs} so far)`
		};
	}

	return {
		parts: {
			printed: op.printed,
			total: op.total,
			label: `${op.printed} of ${op.total}`,
			detail: `${plural(Math.max(0, op.total - op.printed), 'part')} to go · ${plural(failedPrints, 'failed print')}`
		},
		time: {
			loggedH,
			goodH,
			failedH,
			value: num(loggedH, whole ? 0 : 1),
			label: hoursText(loggedH, whole),
			detail: `${hoursText(goodH, whole)} good · ${hoursText(failedH, whole)} failed`
		},
		filament: {
			usedKg: kg(useG),
			keptKg: kg(keptG),
			lostKg: kg(lostG),
			value: useG >= 1000 ? num(useG / 1000, 1) : num(useG, 0),
			unit: useG >= 1000 ? 'kg' : 'g',
			label: gramsText(useG),
			detail: `${gramsText(keptG)} in parts · ${gramsText(lostG)} lost`
		},
		finish
	};
}
