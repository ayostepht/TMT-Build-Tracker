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
	thumbnailPath: string | null;
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

export interface BuildView {
	build: BuildSummary;
	role: TeamRole;
	canEdit: boolean; // owner or editor
	filaments: FilamentRole[];
	parts: PartDef[]; // sorted by `sort`
	state: Record<string, PartState>; // by part slug; every part has an entry
	plates: Plate[]; // sorted by number
	runs: PrintRun[]; // oldest first
	guidePages: GuidePage[];
	hardware: HardwareItem[];
	activity: ActivityItem[]; // newest first, at most 50
	members: { userId: string; name: string; role: TeamRole }[];
}

/** A change to one part's state produced by a domain action; the server persists it. */
export type PartPatch = { slug: string } & Partial<Omit<PartState, 'slug' | 'updatedAt'>>;
