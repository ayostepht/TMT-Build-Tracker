/** Grouping and ordering of the part list. */
import { plateByNumber } from './accounting.ts';
import { filamentLabel } from './labels.ts';
import type { BuildView, PartDef, PartStatus } from './types.ts';

export type GroupBy = 'role' | 'section' | 'plate';

export interface PartGroup {
	key: string; // role key, section name, or plate number as a string ("other" for unplated parts)
	title: string;
	meta: string; // "3/5 printed"
	parts: PartDef[];
}

const STATUS_ORDER: Record<PartStatus, number> = {
	Printing: 0,
	Reprint: 1,
	'To print': 2,
	Printed: 3
};

export function groupParts(
	view: BuildView,
	by: GroupBy,
	opts: { role: string | 'all'; hidePrinted: boolean }
): PartGroup[] {
	const plateNo = new Map<string, number>();
	for (const pl of view.plates) for (const s of pl.parts) plateNo.set(s, pl.number);

	const keyOf = (p: PartDef): string =>
		by === 'role'
			? p.role
			: by === 'section'
				? p.section
				: plateNo.has(p.slug)
					? String(plateNo.get(p.slug))
					: 'other';

	const known =
		by === 'role'
			? view.filaments.map((f) => f.key)
			: by === 'section'
				? view.build.sections
				: view.plates.map((p) => String(p.number)).sort((a, b) => +a - +b);
	const keys = [...known];
	for (const p of view.parts) if (!keys.includes(keyOf(p))) keys.push(keyOf(p));

	const visible = view.parts.filter(
		(p) =>
			(opts.role === 'all' || p.role === opts.role) &&
			!(opts.hidePrinted && view.state[p.slug]?.status === 'Printed')
	);

	const groups: PartGroup[] = [];
	for (const key of keys) {
		const items = visible
			.filter((p) => keyOf(p) === key)
			.sort(
				(a, b) =>
					STATUS_ORDER[view.state[a.slug]?.status ?? 'To print'] -
						STATUS_ORDER[view.state[b.slug]?.status ?? 'To print'] || a.sort - b.sort
			);
		if (!items.length) continue;
		const all = view.parts.filter((p) => keyOf(p) === key);
		const done = all.filter((p) => view.state[p.slug]?.status === 'Printed').length;
		let title = key;
		if (by === 'role') {
			const f = view.filaments.find((x) => x.key === key);
			title = filamentLabel(f, key);
		} else if (by === 'plate') {
			title =
				key === 'other'
					? 'Other'
					: `Plate ${key} · ${plateByNumber(view, Number(key))?.name || 'Other'}`;
		}
		groups.push({ key, title, meta: `${done}/${all.length} printed`, parts: items });
	}
	return groups;
}
