/** Maps the workspace numbers to chart props: tones, short labels, sentences and tables. Pure. */
import { formatValue } from '#lib/components/charts/scale.ts';
import type { Tone } from '#lib/components/charts/tones.ts';
import { shortDate, type WorkspaceStats } from '#lib/domain/stats.ts';

export interface Table {
	columns: string[];
	rows: (string | number)[][];
}
export interface HRow {
	label: string;
	segments: { value: number; tone: Tone; label?: string }[];
	note?: string;
	swatch?: string;
}

export const MONTH_CHOICES = [3, 6, 12, 24] as const;

const hours = (v: number) => `${formatValue(v, v >= 100 ? 0 : 1)} h`;
const kg = (v: number) => `${formatValue(v, 1)} kg`;
const grams = (g: number) => (g >= 1000 ? kg(g / 1000) : `${formatValue(g, 0)} g`);
const pct = (r: number) => `${Math.round(r * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const windowText = (m: number) => (m === 1 ? 'the last month' : `the last ${m} months`);

export function workspaceCharts(s: WorkspaceStats) {
	const k = s.kpis;
	const tiles = [
		{
			key: 'builds',
			label: 'Builds',
			value: String(k.builds.finished),
			unit: 'finished',
			detail: `${k.builds.inProgress} in progress`
		},
		{
			key: 'time',
			label: 'Printing time',
			value: formatValue(k.hours.total, k.hours.total >= 100 ? 0 : 1),
			unit: 'h',
			detail: `${plural(k.hours.printDays, 'day')} of printing, ${pct(k.hours.lostShare)} lost to failures`,
			split: [
				{ value: k.hours.good, tone: 'good' as const },
				{ value: k.hours.lost, tone: 'bad' as const }
			]
		},
		{
			key: 'filament',
			label: 'Filament',
			value: formatValue(k.filament.keptKg + k.filament.lostKg, 1),
			unit: 'kg',
			detail: `${kg(k.filament.lostKg)} lost · ${kg(k.filament.stockKg)} bought`,
			split: [
				{ value: k.filament.keptKg, tone: 'good' as const },
				{ value: k.filament.lostKg, tone: 'bad' as const }
			]
		},
		{
			key: 'perchair',
			label: 'Per chair',
			value: k.perChair ? `~${formatValue(k.perChair.hours, 0)}` : 'Not yet',
			unit: k.perChair ? 'h' : undefined,
			detail: k.perChair
				? `~${kg(k.perChair.kg)} filament, over ${plural(k.perChair.builds, 'finished build')}`
				: 'Appears once a build is handed off'
		}
	];

	const win = windowText(s.months);
	const weekLabels = s.weekly.map((w) => shortDate(w.key));
	const weekly = {
		title: 'Printing hours per week',
		summary: `${hours(k.hours.total)} in ${win}; ${hours(k.hours.lost)} of it went to failed prints.`,
		categories:
			new Set(weekLabels).size === weekLabels.length ? weekLabels : s.weekly.map((w) => w.key),
		good: s.weekly.map((w) => w.goodHours),
		failed: s.weekly.map((w) => w.failedHours),
		table: {
			columns: ['Week of', 'Good (h)', 'Failed (h)'],
			rows: s.weekly.map((w) => [w.key, w.goodHours, w.failedHours])
		} as Table
	};

	const nameOf = (p: string | null) => p ?? 'Unknown';
	const printers = s.printers.length
		? {
				title: 'Printers',
				summary: `${nameOf(s.printers[0].printer)} printed the most: ${hours(s.printers[0].hours)} in ${win}.`,
				rows: s.printers.map<HRow>((p) => ({
					label: nameOf(p.printer),
					segments: [
						{ value: Math.max(0, p.hours - p.failedHours), tone: 'good', label: 'good' },
						{ value: p.failedHours, tone: 'bad', label: 'failed' }
					],
					note: p.runs ? `${pct(p.rate)} of ${plural(p.runs, 'print')} failed` : undefined
				})),
				table: {
					columns: ['Printer', 'Hours', 'Failed hours', 'Prints', 'Failed prints'],
					rows: s.printers.map((p) => [nameOf(p.printer), p.hours, p.failedHours, p.runs, p.failed])
				} as Table
			}
		: null;

	const filaments = s.topFilaments.length
		? {
				title: 'Most-used filaments',
				summary: `${s.topFilaments[0].name} leads with ${grams(s.topFilaments[0].keptG + s.topFilaments[0].lostG)}. Builds with prints in ${win}, all-time totals.`,
				rows: s.topFilaments.map<HRow>((f) => ({
					label: f.material ? `${f.name} (${f.material})` : f.name,
					swatch: f.hex,
					segments: [
						{ value: f.keptG, tone: 'good', label: 'in parts' },
						{ value: f.lostG, tone: 'bad', label: 'lost' }
					]
				})),
				table: {
					columns: ['Filament', 'Material', 'In parts (g)', 'Lost (g)'],
					rows: s.topFilaments.map((f) => [f.name, f.material, f.keptG, f.lostG])
				} as Table
			}
		: null;

	const plates = s.failingPlates.length
		? {
				title: 'Plates that fail most',
				summary: `${s.failingPlates[0].label} fails most: ${s.failingPlates[0].failed} of ${plural(s.failingPlates[0].runs, 'print')} (${pct(s.failingPlates[0].rate)}) in ${win}. Plates with at least 3 prints.`,
				rows: s.failingPlates.map<HRow>((p) => ({
					label: p.label,
					segments: [{ value: Math.round(p.rate * 100), tone: 'bad' }],
					note: `${p.failed} of ${plural(p.runs, 'print')}`
				})),
				table: {
					columns: ['Plate', 'Prints', 'Failed', 'Failure rate'],
					rows: s.failingPlates.map((p) => [p.label, p.runs, p.failed, pct(p.rate)])
				} as Table
			}
		: null;

	return {
		tiles,
		weekly,
		printers,
		filaments,
		plates,
		empty: k.builds.total === 0 && k.hours.total === 0
	};
}
