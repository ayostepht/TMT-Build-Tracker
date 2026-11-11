/** Split the grams of a logged run across filament roles (to deduct from linked spools). Pure. */
import { plateFileRoleGrams } from './accounting.ts';
import { runTargets } from './actions.ts';
import type { BuildView, PrintRun, PrintRunInput } from './types.ts';

export function splitGramsByRole(
	view: BuildView,
	run: Pick<
		PrintRunInput,
		| 'plateNumber'
		| 'partSlug'
		| 'partSlugs'
		| 'grams'
		| 'date'
		| 'result'
		| 'hours'
		| 'printer'
		| 'note'
	>
): Record<string, number> {
	const grams = run.grams ?? 0;
	if (!(grams > 0)) return {};
	const slugs = runTargets(view, run as PrintRun | PrintRunInput).filter((s) => view.state[s]);
	const roleOf = (s: string) => view.allParts.find((p) => p.slug === s)?.role;
	const plate =
		run.plateNumber == null ? null : view.plates.find((p) => p.number === run.plateNumber);

	let weights: Record<string, number> = {};
	const wholePlate = plate && slugs.length === plate.parts.length;
	// The parts' roles decide which roles the file's grams go to (see plateFileRoleGrams).
	const fileWeights =
		wholePlate && plate
			? plateFileRoleGrams(
					plate,
					plate.parts.flatMap((s) => (view.state[s] ? [roleOf(s) ?? ''] : []))
				)
			: null;
	if (fileWeights) {
		weights = fileWeights;
	} else {
		for (const s of slugs) {
			const role = roleOf(s);
			if (!role) continue;
			const p = view.allParts.find((x) => x.slug === s);
			weights[role] = (weights[role] ?? 0) + ((p?.bomGrams ?? 0) * (p?.qty ?? 1) || 1);
		}
	}
	const total = Object.values(weights).reduce((a, b) => a + b, 0);
	if (!(total > 0)) return {};
	return Object.fromEntries(
		Object.entries(weights)
			.filter(([, w]) => w > 0)
			.map(([k, w]) => [k, Math.round(((grams * w) / total) * 10) / 10])
	);
}
