/** Test helper: turns a template seed plus a color design into a BuildView with every part "To print". */
import { tmtTemplate } from '../server/seed/tmt.ts';
import type { TemplateSeed } from '../server/seed/types.ts';
import { inactiveSlugs, resolveChoices, variantOfPart } from './variants.ts';
import type { BuildView, PartState, PrintRun } from './types.ts';

export function makeView(
	seed: TemplateSeed = tmtTemplate,
	designIndex = 0,
	variantChoices: Record<string, string> = {}
): BuildView {
	const design = seed.designs[designIndex];
	const t0 = '2026-01-01T00:00:00.000Z';
	const groups = seed.variantGroups ?? [];
	const choices = resolveChoices(groups, variantChoices);
	const inactive = inactiveSlugs(groups, choices);
	const variantOf = variantOfPart(groups);
	const allParts = seed.parts.map((p, i) => ({
		slug: p.slug,
		name: p.name,
		section: p.section,
		role: design?.partRoles[p.slug] ?? p.defaultRole,
		bomGrams: p.bomGrams,
		qty: p.qty,
		walls: p.walls,
		infill: p.infill,
		supports: p.supports,
		brim: p.brim ?? null,
		sourceFile: p.sourceFile,
		notes: p.notes,
		components: p.components ?? [],
		allowedMaterials: p.allowedMaterials,
		symmetryGroup: p.symmetryGroup ?? null,
		variantGroup: variantOf.get(p.slug)?.group ?? null,
		variantOption: variantOf.get(p.slug)?.option ?? null,
		guideRefs: p.guideRefs,
		sort: i
	}));
	const parts = allParts.filter((p) => !inactive.has(p.slug));
	const state: Record<string, PartState> = {};
	for (const p of parts) {
		state[p.slug] = {
			slug: p.slug,
			status: 'To print',
			startedAt: null,
			printedOn: null,
			runEstSeconds: null,
			comps: {},
			assigneeUserId: null,
			updatedAt: t0
		};
	}
	return {
		build: {
			id: 'b1',
			organizationId: 'o1',
			name: 'Test build',
			recipient: null,
			hospital: null,
			phase: 'printing',
			deliveryDate: null,
			createdAt: t0,
			templateId: 't1',
			templateName: seed.name,
			templateVersion: seed.version,
			globalSettings: seed.globalSettings,
			sections: seed.sections,
			setupStep: null,
			templateOwned: false
		},
		role: 'owner',
		canEdit: true,
		filaments: seed.filamentRoles.map((r) => ({
			key: r.key,
			name: design?.roles.find((x) => x.key === r.key)?.name ?? r.name,
			material: r.material,
			hex: design?.roles.find((x) => x.key === r.key)?.hex ?? r.hex,
			tpu: r.tpu,
			spools: r.recommendedSpools,
			recommendedSpools: r.recommendedSpools,
			spoolmanSpoolId: null
		})),
		parts,
		state,
		variantGroups: groups,
		variantChoices: choices,
		allParts,
		model: null,
		plates: seed.plates
			.map((p) => ({
				number: p.number,
				name: p.name,
				estSeconds: p.estSeconds,
				runs: p.runs,
				runNote: p.runNote ?? null,
				perPartRuns: !!p.perPartRuns,
				parts: p.parts.filter((s) => !inactive.has(s)),
				slicerGrams: null,
				slicerByPart: {},
				thumbnailPath: null,
				filamentGrams: {},
				source: 'template'
			}))
			.filter((p) => p.parts.length > 0),
		runs: [],
		guidePages: [],
		hardware: [],
		activity: [],
		members: [],
		printer: null,
		assembly: { steps: [], items: {} },
		photos: [],
		handoff: null
	};
}

let n = 0;
export function run(over: Partial<PrintRun>): PrintRun {
	return {
		id: `r${++n}`,
		plateNumber: null,
		partSlug: null,
		partSlugs: null,
		date: '2026-03-01',
		result: 'Success',
		grams: null,
		hours: null,
		printer: null,
		userId: null,
		userName: null,
		note: '',
		...over
	};
}

/** Apply patches to a view (what the server would persist). */
export function applyPatches(
	view: BuildView,
	patches: { slug: string; [k: string]: unknown }[]
): BuildView {
	const state = { ...view.state };
	for (const { slug, ...rest } of patches) state[slug] = { ...state[slug], ...rest } as PartState;
	return { ...view, state };
}
