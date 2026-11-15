/**
 * Maps a build's numbers (`domain/stats.ts`) to the chart components' props: tones, short date
 * labels, the sentence under each chart and its table. Pure; the Stats tab renders the result.
 */
import { formatValue } from '#lib/components/charts/scale.ts';
import type { Tone } from '#lib/components/charts/tones.ts';
import { overallProgress, timeStats } from '#lib/domain/accounting.ts';
import { today } from '#lib/domain/format.ts';
import {
	addDays,
	failureRates,
	filamentBreakdown,
	plateTimes,
	progressSeries,
	projectFinish,
	runsByPeriod,
	shortDate
} from '#lib/domain/stats.ts';
import type { BuildView } from '#lib/domain/types.ts';

export interface Table {
	columns: string[];
	rows: (string | number)[][];
}
export interface Tile {
	key: string;
	label: string;
	value: string;
	unit?: string;
	detail: string;
	split?: { value: number; tone: Tone }[];
}
export interface HRow {
	label: string;
	segments: { value: number; tone: Tone; label?: string }[];
	marker?: { value: number; label: string };
	note?: string;
	swatch?: string;
}
export interface Figure {
	title: string;
	summary: string;
	table: Table;
}
export interface BuildStats {
	empty: boolean;
	tiles: Tile[];
	progress:
		| (Figure & {
				unit: string;
				yMax: number;
				points: { x: string; y: number }[];
				projection: { x: string; y: number }[];
				markers: { x: string; label: string; tone: 'bad' }[];
		  })
		| null;
	failures: (Figure & { rows: HRow[] }) | { title: string; summary: string; rows: null };
	filament: (Figure & { rows: HRow[] }) | null;
	plates: (Figure & { rows: HRow[] }) | null;
	time: (Figure & { categories: string[]; good: number[]; failed: number[] }) | null;
}

const n1 = (v: number) => formatValue(v, 1);
const hours = (v: number) => `${formatValue(v, v >= 100 ? 0 : 1)} h`;
const grams = (g: number) => (g >= 1000 ? `${n1(g / 1000)} kg` : `${formatValue(g, 0)} g`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;

const SPAN_MAX = 120; // days a progress line is drawn day by day
const DAILY_MAX = 70; // days the hours chart is drawn per day; longer builds go per week

/** Date labels for the x axis: "Nov 10", or the full date when two would read the same. */
function labelsFor(dates: string[]): string[] {
	const short = dates.map(shortDate);
	return new Set(short).size === short.length ? short : dates;
}

/** One point per day from the first to the last, so the axis is true to time (steps hold). */
function daily(points: { x: string; y: number }[], to: string) {
	if (!points.length) return points;
	const first = points[0].x;
	const last = points[points.length - 1].x;
	const end = to > last ? to : last;
	if (end < first) return points;
	const byDay = new Map(points.map((p) => [p.x, p.y]));
	const out: { x: string; y: number }[] = [];
	let y = 0;
	for (let d = first, i = 0; d <= end && i <= SPAN_MAX + 1; d = addDays(d, 1), i++) {
		y = byDay.get(d) ?? y;
		out.push({ x: d, y });
	}
	return out;
}

function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function buildStats(view: BuildView, now: Date): BuildStats {
	const todayStr = today(now);
	const t = timeStats(view);
	const fil = filamentBreakdown(view);
	const fails = failureRates(view);
	const prog = progressSeries(view);
	const proj = projectFinish(view, now);
	const op = overallProgress(view);

	const keptG = fil.reduce((s, f) => s + f.keptG, 0);
	const lostG = fil.reduce((s, f) => s + f.lostG, 0);
	const toPrintG = fil.reduce((s, f) => s + f.toPrintG, 0);
	const platesDone = prog.points.length ? prog.points[prog.points.length - 1].y : 0;
	const platesLeft = Math.max(0, prog.platesTotal - platesDone);

	// ---- tiles
	const finishTile: Tile =
		proj.kind === 'projected'
			? {
					key: 'finish',
					label: 'Projected finish',
					value: shortDate(proj.date),
					detail: `About ${hours(proj.hoursLeft)} left at ${n1(proj.hoursPerDay)} h a day${
						t.pace ? ` · ${t.pace.text}` : ''
					}`
				}
			: proj.kind === 'done'
				? {
						key: 'finish',
						label: 'Projected finish',
						value: 'Done',
						detail: 'Every part is printed'
					}
				: proj.kind === 'no-estimate'
					? {
							key: 'finish',
							label: 'Projected finish',
							value: 'No estimate',
							detail: 'The plates left have no print time yet'
						}
					: {
							key: 'finish',
							label: 'Projected finish',
							value: 'Not yet',
							detail: `Needs 3 prints in the last 28 days (${proj.runs} so far)`
						};
	const useG = keptG + lostG;
	const tiles: Tile[] = [
		{
			key: 'time',
			label: 'Printing time',
			value: formatValue(t.loggedHours, t.loggedHours >= 100 ? 0 : 1),
			unit: 'h logged',
			detail: `${hours(t.keptHours)} good, ${hours(t.lostHours)} lost to failed prints`,
			split: [
				{ value: t.keptHours, tone: 'good' },
				{ value: t.lostHours, tone: 'bad' }
			]
		},
		{
			key: 'filament',
			label: 'Filament used',
			value: useG >= 1000 ? n1(useG / 1000) : formatValue(useG, 0),
			unit: useG >= 1000 ? 'kg' : 'g',
			detail: `${grams(keptG)} in parts, ${grams(lostG)} lost`,
			split: [
				{ value: keptG, tone: 'good' },
				{ value: lostG, tone: 'bad' }
			]
		},
		{
			key: 'parts',
			label: 'Parts printed',
			value: String(op.printed),
			unit: `of ${op.total}`,
			detail: `${plural(platesLeft, 'plate')} to go · ${plural(fails.total.failed, 'failed print')}`,
			split: [
				{ value: op.printed, tone: 'good' },
				{ value: Math.max(0, op.total - op.printed), tone: 'neutral' }
			]
		},
		finishTile
	];

	// ---- progress
	const byPlates = prog.platesTotal > 0;
	const pts = byPlates ? prog.points : prog.partPoints;
	const yMax = byPlates ? prog.platesTotal : prog.partsTotal;
	const done = pts.length ? pts[pts.length - 1].y : 0;
	const span = pts.length
		? daysBetween(pts[0].x, todayStr > pts[pts.length - 1].x ? todayStr : pts[pts.length - 1].x)
		: 0;
	const dense = span <= SPAN_MAX;
	const series = dense ? daily(pts, todayStr) : pts;
	const projection: { x: string; y: number }[] = [];
	let progressWords: string;
	const from = series.length ? series[series.length - 1] : null;
	const ahead = proj.kind === 'projected' && from ? daysBetween(from.x, proj.date) : 0;
	if (proj.kind === 'projected' && from && dense && ahead > 0 && ahead <= SPAN_MAX) {
		for (let i = 1; i <= ahead; i++) {
			projection.push({
				x: addDays(from.x, i),
				y: Math.round((from.y + ((yMax - from.y) * i) / ahead) * 100) / 100
			});
		}
		progressWords = `at the recent pace the last print finishes around ${shortDate(proj.date)}.`;
	} else if (proj.kind === 'projected') {
		progressWords = `at the recent pace the last print finishes around ${shortDate(proj.date)}.`;
	} else if (proj.kind === 'done') {
		progressWords = 'everything is printed.';
	} else if (proj.kind === 'no-estimate') {
		progressWords = 'the plates left have no print time, so there is no finish date.';
	} else {
		progressWords = 'there are not enough recent prints to project a finish yet.';
	}
	const xs = [...series.map((p) => p.x), ...projection.map((p) => p.x)];
	const xl = labelsFor(xs);
	const lab = new Map(xs.map((x, i) => [x, xl[i]]));
	const progress: BuildStats['progress'] = pts.length
		? {
				title: byPlates ? 'Plates done' : 'Parts printed',
				unit: byPlates ? 'plates' : 'parts',
				yMax: Math.max(1, yMax),
				summary: `${done} of ${yMax} ${byPlates ? 'plates' : 'parts'} done; ${progressWords}`,
				points: series.map((p) => ({ x: lab.get(p.x)!, y: p.y })),
				projection: projection.map((p) => ({ x: lab.get(p.x)!, y: p.y })),
				markers: prog.markers.map((m) => ({ ...m, x: lab.get(m.x) ?? shortDate(m.x) })),
				table: {
					columns: ['Date', byPlates ? 'Plates done' : 'Parts printed'],
					rows: pts.map((p) => [p.x, p.y])
				}
			}
		: null;

	// ---- failures
	const failedPlates = fails.byPlate.filter((p) => p.failed > 0);
	const failures: BuildStats['failures'] =
		fails.total.failed === 0
			? {
					title: 'Failures',
					summary: `No failed prints in ${plural(fails.total.runs, 'print')}.`,
					rows: null
				}
			: {
					title: 'Failures',
					summary: `${fails.total.failed} of ${plural(fails.total.runs, 'print')} failed (${pct(fails.total.rate)})${
						failedPlates.length ? `; ${failedPlates[0].name} most often` : ''
					}.`,
					rows: failedPlates.slice(0, 8).map((p) => ({
						label: p.name,
						segments: [{ value: p.failed, tone: 'bad' as const }],
						note: `${p.failed} of ${plural(p.runs, 'run')} (${pct(p.rate)})`
					})),
					table: {
						columns: ['Plate', 'Runs', 'Failed', 'Failure rate'],
						rows: fails.byPlate.map((p) => [p.name, p.runs, p.failed, pct(p.rate)])
					}
				};

	// ---- filament
	const filUsed = fil.filter((f) => f.keptG + f.lostG + f.toPrintG > 0);
	const short = filUsed.filter((f) => f.shortG > 0);
	const filament: BuildStats['filament'] = filUsed.length
		? {
				title: 'Filament by colour',
				summary: short.length
					? `${short[0].name} is short by ${grams(short[0].shortG)} of what is left to print${
							short.length > 1
								? `, and ${short.length - 1} more colour${short.length > 2 ? 's' : ''} too`
								: ''
						}.`
					: `${grams(useG)} used so far and ${grams(toPrintG)} still to print; your stock covers it.`,
				rows: filUsed.map((f) => {
					const spare = f.haveG - f.keptG - f.lostG - f.toPrintG;
					return {
						label: f.name,
						swatch: f.hex,
						segments: [
							{ value: f.keptG, tone: 'good' as const, label: 'in parts' },
							{ value: f.lostG, tone: 'bad' as const, label: 'lost' },
							{ value: f.toPrintG, tone: 'neutral' as const, label: 'to print' }
						],
						marker: { value: f.haveG, label: 'Stock' },
						note: spare >= 0 ? `${grams(spare)} spare` : `short by ${grams(-spare)}`
					};
				}),
				table: {
					columns: ['Filament', 'In parts (g)', 'Lost (g)', 'To print (g)', 'Stock (g)'],
					rows: filUsed.map((f) => [f.name, f.keptG, f.lostG, f.toPrintG, f.haveG])
				}
			}
		: null;

	// ---- plate time vs estimate
	const pt = plateTimes(view);
	const withEst = pt.filter((p) => p.estHours !== null);
	const sumAct = withEst.reduce((s, p) => s + p.actualHours, 0);
	const sumEst = withEst.reduce((s, p) => s + (p.estHours ?? 0), 0);
	const plates: BuildStats['plates'] = pt.length
		? {
				title: 'Plate time against the estimate',
				summary: withEst.length
					? `Plates ran ${pct(Math.abs(sumAct / sumEst - 1))} ${sumAct >= sumEst ? 'over' : 'under'} the estimate on average, across ${plural(withEst.length, 'plate')}.`
					: 'Average logged time per run; these plates have no estimate to compare with.',
				rows: pt.slice(0, 12).map((p) => ({
					label: p.name,
					segments: [
						{
							value: p.actualHours,
							tone: (p.deltaHours !== null && p.deltaHours > 0.05 ? 'accent' : 'good') as Tone,
							label: 'your time'
						}
					],
					marker: p.estHours === null ? undefined : { value: p.estHours, label: 'Estimate' },
					note:
						p.deltaHours === null
							? undefined
							: `${p.deltaHours > 0 ? '+' : p.deltaHours < 0 ? '−' : ''}${n1(Math.abs(p.deltaHours))} h`
				})),
				table: {
					columns: ['Plate', 'Runs', 'Your time (h)', 'Estimate (h)', 'Difference (h)'],
					rows: pt.map((p) => [p.name, p.runs, p.actualHours, p.estHours ?? '', p.deltaHours ?? ''])
				}
			}
		: null;

	// ---- hours by day (or week)
	const dated = view.runs.filter((r) => (Number(r.hours) || 0) > 0).map((r) => r.date);
	let time: BuildStats['time'] = null;
	if (dated.length) {
		const from = dated.reduce((m, d) => (d < m ? d : m));
		const last = dated.reduce((m, d) => (d > m ? d : m));
		const to = last > todayStr ? last : todayStr;
		const unit = daysBetween(from, to) <= DAILY_MAX ? 'day' : 'week';
		const buckets = runsByPeriod(view, { unit, from, to });
		const cats = labelsFor(buckets.map((b) => b.key));
		const peak = buckets.reduce((m, b) =>
			b.goodHours + b.failedHours > m.goodHours + m.failedHours ? b : m
		);
		const printDays = new Set(dated).size;
		time = {
			title: `Printing hours by ${unit}`,
			summary: `${hours(t.loggedHours)} on ${plural(printDays, 'day')} with prints; busiest ${unit} ${hours(peak.goodHours + peak.failedHours)} (${shortDate(peak.key)}).`,
			categories: cats,
			good: buckets.map((b) => b.goodHours),
			failed: buckets.map((b) => b.failedHours),
			table: {
				columns: [unit === 'day' ? 'Day' : 'Week of', 'Good (h)', 'Failed (h)'],
				rows: buckets.map((b) => [b.key, b.goodHours, b.failedHours])
			}
		};
	}

	return { empty: view.runs.length === 0, tiles, progress, failures, filament, plates, time };
}
