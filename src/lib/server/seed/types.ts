import type { PrintFootprintSeed } from '#lib/domain/print-footprint.ts';
export type { PrintFootprintSeed };
export interface FilamentRoleSeed {
	key: string;
	name: string;
	material: string;
	hex: string;
	tpu: boolean;
	recommendedSpools: number;
}
export interface ComponentSeed {
	name: string;
	file?: string;
	settings: string;
}
export interface GuideRefSeed {
	page: number;
	text: string;
}
export interface PartSeed {
	slug: string;
	name: string;
	section: string;
	defaultRole: string;
	bomGrams: number | null;
	qty: number | null;
	walls: number | null;
	infill: string;
	supports: string;
	brim?: string;
	sourceFile: string;
	notes: string[];
	components?: ComponentSeed[];
	allowedMaterials: string[];
	symmetryGroup?: string;
	guideRefs: GuideRefSeed[];
}
export interface PlateSeed {
	number: number;
	name: string;
	estSeconds: number | null;
	runs: number;
	runNote?: string;
	perPartRuns?: boolean;
	parts: string[];
}
export interface PlateLayoutSeed {
	key: string;
	name: string;
	/** Which printers this layout is for, shown next to the picker. */
	printerNote: string;
	isDefault?: boolean;
	plates: PlateSeed[];
}
export interface GuidePageSeed {
	page: number;
	title: string;
	sort: number;
}
export interface HardwareSeed {
	name: string;
	qty?: number;
	note?: string;
}
export interface ColorDesignSeed {
	slug: string;
	name: string;
	roles: { key: string; name: string; material: string; hex: string }[];
	partRoles: Record<string, string>;
}
export interface VariantOptionSeed {
	key: string;
	name: string;
	description: string;
	/** Part slugs used by this option. A part belongs to at most one option; `PartDef.variantGroup/variantOption` are derived from this. */
	parts: string[];
}
export interface VariantGroupSeed {
	key: string;
	name: string;
	defaultOption: string;
	options: VariantOptionSeed[];
}
/** Where a part sits in the assembled model (numbers only, no geometry). Matrices are column-major 4x4 (three.js order), mm, y up. */
export interface PlacementSeed {
	slug: string;
	/** Defaults to identity (the STEP file is already in the assembly frame). */
	matrix?: number[];
	/** Extra instances (mirrored copies, repeated segments). */
	instances?: number[][];
	placed: boolean;
}
export interface TemplateSeed {
	slug: string;
	name: string;
	version: string;
	description: string;
	sourceUrl?: string;
	globalSettings: string;
	sections: string[];
	filamentRoles: FilamentRoleSeed[];
	parts: PartSeed[];
	plates: PlateSeed[];
	/** Built-in plate layouts per printer family; the default one equals `plates`. Omit for kits with a single layout. */
	plateLayouts?: PlateLayoutSeed[];
	guidePages: GuidePageSeed[];
	hardware: HardwareSeed[];
	designs: ColorDesignSeed[];
	/** Alternative parts for one function; omit for kits without options. */
	variantGroups?: VariantGroupSeed[];
	/** Placements of parts in the assembled model; parts without an entry are treated as not placed. */
	placements?: PlacementSeed[];
	/** Print footprints per part (numbers only, mm), so plates can be planned without the geometry import. */
	printFootprints?: PrintFootprintSeed[];
	/** Assembly checklist in kit order (milestone 6). Reconciled into `template_assembly_steps` on startup. */
	assemblySteps?: AssemblyStepSeed[];
}

/**
 * One assembly step (our own wording, following the kit's build order). `key` is
 * `<section>.<name>` with the section one of the domain's `ASSEMBLY_SECTIONS` prefixes and no `:`.
 * `parts` are part slugs (inactive variant parts are filtered per build), `hardware` names must
 * exist in the template's `hardware`, `guidePage` in `guidePages`. `when` limits the step to a variant option.
 */
export interface AssemblyStepSeed {
	key: string;
	title: string;
	description: string;
	guidePage?: number;
	parts?: string[];
	hardware?: { name: string; qty?: number }[];
	checks?: { key: string; text: string }[];
	when?: { group: string; option: string };
}
