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
	guidePages: GuidePageSeed[];
	hardware: HardwareSeed[];
	designs: ColorDesignSeed[];
}
