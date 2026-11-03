/**
 * Shared contract for a build as the UI and the domain logic see it.
 *
 * The server assembles a `BuildView` from the database (template + build rows);
 * pure functions in `src/lib/domain/` compute progress, filament and time from
 * it and decide how actions change part state; the UI renders it. Keep this
 * file free of DB, Svelte and Node imports. Dates are ISO strings so the view
 * serializes cleanly from server load functions.
 */

export const PART_STATUSES = ['To print', 'Printing', 'Printed', 'Reprint'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const RUN_RESULTS = ['Success', 'Failed', 'Partial'] as const;
export type RunResult = (typeof RUN_RESULTS)[number];

export const BUILD_PHASES = [
	'design',
	'plates',
	'printing',
	'assembly',
	'handoff',
	'done'
] as const;
export type BuildPhase = (typeof BUILD_PHASES)[number];

export type TeamRole = 'owner' | 'editor' | 'viewer';

/** A filament slot in this build: a template role with the build's chosen filament. */
export interface FilamentRole {
	key: string; // template role key: primary | accent | soft | tire | …
	name: string; // e.g. "Overture Blue"
	material: string; // e.g. "PETG", "TPU 95A"
	hex: string;
	tpu: boolean;
	spools: number; // spools on hand (1 kg each)
	recommendedSpools: number;
	spoolmanSpoolId: number | null;
}

export interface PartComponent {
	name: string;
	file?: string;
	settings: string;
}

/** Static definition of a part (from the template) with this build's color role applied. */
export interface PartDef {
	slug: string;
	name: string;
	section: string;
	role: string; // FilamentRole.key: design snapshot's partRoles[slug] ?? template defaultRole
	bomGrams: number | null;
	qty: number | null;
	walls: number | null;
	infill: string;
	supports: string;
	brim: string | null;
	sourceFile: string;
	notes: string[];
	components: PartComponent[];
	allowedMaterials: string[];
	symmetryGroup: string | null;
	variantGroup: string | null; // VariantGroup.key when this part belongs to a variant option
	variantOption: string | null; // VariantOption.key
	guideRefs: { page: number; text: string }[];
	sort: number;
}

/** Mutable per-build progress for one part. */
export interface PartState {
	slug: string;
	status: PartStatus;
	startedAt: string | null; // ISO; set while Printing once the start time is known
	printedOn: string | null; // YYYY-MM-DD
	runEstSeconds: number | null; // slicer time for the current run, while Printing
	comps: Record<string, boolean>; // component index → checked
	assigneeUserId: string | null;
	updatedAt: string; // ISO
}

/** A plate in this build. `perPartRuns`: each part on the plate is its own unit printed `runs` times (e.g. two rim colors). */
export interface Plate {
	number: number;
	name: string;
	estSeconds: number | null; // per run
	runs: number;
	runNote: string | null;
	perPartRuns: boolean;
	parts: string[]; // part slugs
	slicerGrams: number | null; // per run, whole plate (when !perPartRuns)
	slicerByPart: Record<string, number>; // per run, per part (when perPartRuns)
	thumbnailPath: string | null; // served via GET /api/builds/[id]/plates/[number]/thumbnail when set
	filamentGrams: Record<string, number>; // grams per run by filament role key, from a sliced 3MF; {} when unknown
	source: string; // 'template' | 'layout:<key>' | 'upload:<uploadId>'
}

/**
 * One logged print. Attach to a plate (`plateNumber`), optionally narrowed to one
 * part (`partSlug`, used for perPartRuns plates) or a subset (`partSlugs`).
 * A run with only `partSlug` and no plate is a per-part log entry.
 */
export interface PrintRun {
	id: string;
	plateNumber: number | null;
	partSlug: string | null;
	partSlugs: string[] | null;
	date: string; // YYYY-MM-DD
	result: RunResult;
	grams: number | null;
	hours: number | null;
	printer: string | null;
	userId: string | null;
	userName: string | null;
	note: string;
}

/** Input for logging a run (what the UI sends; server adds id/user). */
export type PrintRunInput = Omit<PrintRun, 'id' | 'userId' | 'userName'>;

export interface ActivityItem {
	id: string;
	userId: string | null;
	userName: string | null;
	kind: string; // e.g. 'part.status', 'run.add', 'run.delete', 'plate.slicer', 'filament.spools', 'build.update', 'printing.start', 'printing.stop'
	payload: Record<string, unknown>;
	at: string; // ISO
}

export interface GuidePage {
	page: number;
	title: string;
	sort: number;
	hasImage: boolean; // false until guide images are imported (template admin, later milestone)
}

export interface HardwareItem {
	name: string;
	qty: number | null;
	note: string | null;
}

export interface BuildSummary {
	id: string;
	organizationId: string;
	name: string;
	recipient: string | null;
	hospital: string | null;
	phase: BuildPhase;
	deliveryDate: string | null;
	createdAt: string;
	templateId: string;
	templateName: string;
	templateVersion: string;
	globalSettings: string;
	sections: string[];
}

/**
 * Variants: a template may offer alternative parts for one function (e.g. seat:
 * cushions OR foaming bucket seat). Each build chooses one option per group.
 * Parts belonging to an option that is not chosen are excluded from
 * `BuildView.parts`, `state`, `plates[].parts` (plates left empty are dropped)
 * and all accounting. Parts with no variant group are always active.
 */
export interface VariantOption {
	key: string; // e.g. 'cushions', 'bucket-seat'
	name: string;
	description: string;
	parts: string[]; // part slugs used by this option
}

export interface VariantGroup {
	key: string; // e.g. 'seat', 'rear-caster', 'footrest', 'rim'
	name: string;
	defaultOption: string;
	options: VariantOption[];
}

/**
 * Where a part sits in the template's assembled 3D model. Placement data
 * (numbers only) may live in the seed; the model geometry never does: it is
 * built per install from uploaded STEP files and served from the /data volume.
 */
export interface PartPlacement {
	slug: string;
	/** Column-major 4x4 matrix (three.js `Matrix4.fromArray` order), mm, y up. Identity when the STEP is already in the assembly frame. */
	matrix: number[];
	/** Extra instances (e.g. the mirrored right-hand copy, 4 rim halves, 16 tire segments), each a column-major 4x4 matrix. */
	instances: number[][];
	/** False when the part has no usable placement yet; the Design tab lists it below the 3D view instead. */
	placed: boolean;
}

export interface TemplateModelInfo {
	/** URL of the GLB served by the app (e.g. `/api/templates/<id>/model.glb?v=<hash>`); one node per part named by slug, hardware nodes named `hw:<name>`. */
	url: string;
	/** Optional second GLB with neutral hardware (casters, bolts, bearings), nodes named `hw:<name>`, already in the assembly frame; uploaded by a site admin (built offline with scripts/step-to-glb.mjs). */
	hardwareUrl: string | null;
	version: string; // hash or timestamp, for cache busting
	placements: PartPlacement[];
	/** Slugs present as nodes in the GLB. */
	slugs: string[];
}

export interface BuildView {
	build: BuildSummary;
	role: TeamRole;
	canEdit: boolean; // owner or editor
	filaments: FilamentRole[];
	parts: PartDef[]; // active parts only (variant choices applied), sorted by `sort`
	state: Record<string, PartState>; // by part slug; every active part has an entry
	variantGroups: VariantGroup[]; // all groups with all options, for the chooser
	variantChoices: Record<string, string>; // group key → chosen option key (every group present)
	allParts: PartDef[]; // every template part incl. inactive variant options (Design tab, 3D view)
	model: TemplateModelInfo | null; // null until a site admin imports the 3D model
	plates: Plate[]; // sorted by number
	runs: PrintRun[]; // oldest first
	guidePages: GuidePage[];
	hardware: HardwareItem[];
	activity: ActivityItem[]; // newest first, at most 50
	members: { userId: string; name: string; role: TeamRole }[];
	/** Printer chosen for plate planning; null until the user picks one. */
	printer: BuildPrinter | null;
}

/** A change to one part's state produced by a domain action; the server persists it. */
export type PartPatch = { slug: string } & Partial<Omit<PartState, 'slug' | 'updatedAt'>>;

/**
 * The printer a build is planned for (set in New build, Settings or the Plates tab).
 * `catalogId` points into `src/lib/printers/catalog.ts` (null = custom printer).
 * The plate arranger (`arrange.ts`) uses bed, margin, spacing and `mmSlots`.
 * All lengths in mm.
 */
export interface BuildPrinter {
	catalogId: string | null;
	name: string;
	bedX: number;
	bedY: number;
	bedZ: number;
	/** Filaments one plate may use (1 = single filament, 4 = CANVAS / AMS, ...). */
	mmSlots: number;
	nozzle: number;
	/** Keep-out border around the bed edge. Default 5. */
	margin: number;
	/** Gap between parts on a plate. Default 8. */
	spacing: number;
}
