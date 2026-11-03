import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { VariantGroup } from '#lib/domain/types.ts';
import { organization, user } from './auth.schema';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`);

// ---- Templates (printable kits). Data only: no vendor models, images or files.

export const templates = sqliteTable('templates', {
	id: id(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	version: text('version').notNull(),
	description: text('description').notNull().default(''),
	sourceUrl: text('source_url'),
	globalSettings: text('global_settings').notNull().default(''),
	sections: text('sections', { mode: 'json' })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
	variantGroups: text('variant_groups', { mode: 'json' })
		.$type<VariantGroup[]>()
		.notNull()
		.default(sql`'[]'`),
	createdAt: createdAt()
});

const templateId = () =>
	text('template_id')
		.notNull()
		.references(() => templates.id, { onDelete: 'cascade' });

export const templateFilamentRoles = sqliteTable(
	'template_filament_roles',
	{
		templateId: templateId(),
		key: text('key').notNull(),
		name: text('name').notNull(),
		material: text('material').notNull(),
		hex: text('hex').notNull(),
		tpu: integer('tpu', { mode: 'boolean' }).notNull().default(false),
		recommendedSpools: integer('recommended_spools').notNull().default(1)
	},
	(t) => [primaryKey({ columns: [t.templateId, t.key] })]
);

export const templateParts = sqliteTable(
	'template_parts',
	{
		templateId: templateId(),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		section: text('section').notNull(),
		defaultRole: text('default_role').notNull(),
		bomGrams: real('bom_grams'),
		qty: integer('qty'),
		walls: integer('walls'),
		infill: text('infill').notNull().default(''),
		supports: text('supports').notNull().default(''),
		brim: text('brim'),
		sourceFile: text('source_file').notNull().default(''),
		notes: text('notes', { mode: 'json' })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		components: text('components', { mode: 'json' })
			.$type<{ name: string; file?: string; settings: string }[]>()
			.notNull()
			.default(sql`'[]'`),
		allowedMaterials: text('allowed_materials', { mode: 'json' })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		symmetryGroup: text('symmetry_group'),
		guideRefs: text('guide_refs', { mode: 'json' })
			.$type<{ page: number; text: string }[]>()
			.notNull()
			.default(sql`'[]'`),
		sort: integer('sort').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.templateId, t.slug] })]
);

export const templatePlates = sqliteTable(
	'template_plates',
	{
		templateId: templateId(),
		number: integer('number').notNull(),
		name: text('name').notNull(),
		estSeconds: integer('est_seconds'),
		runs: integer('runs').notNull().default(1),
		runNote: text('run_note'),
		perPartRuns: integer('per_part_runs', { mode: 'boolean' }).notNull().default(false),
		parts: text('parts', { mode: 'json' })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`)
	},
	(t) => [primaryKey({ columns: [t.templateId, t.number] })]
);

export const templateGuidePages = sqliteTable(
	'template_guide_pages',
	{
		templateId: templateId(),
		page: integer('page').notNull(),
		title: text('title').notNull(),
		sort: integer('sort').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.templateId, t.page] })]
);

export const templateHardware = sqliteTable(
	'template_hardware',
	{
		templateId: templateId(),
		name: text('name').notNull(),
		qty: integer('qty'),
		note: text('note')
	},
	(t) => [primaryKey({ columns: [t.templateId, t.name] })]
);

export const templatePartPlacements = sqliteTable(
	'template_part_placements',
	{
		templateId: templateId(),
		slug: text('slug').notNull(),
		/** Column-major 4x4 (three.js order), mm. */
		matrix: text('matrix', { mode: 'json' }).$type<number[]>().notNull(),
		/** Extra instances, each a column-major 4x4. */
		instances: text('instances', { mode: 'json' })
			.$type<number[][]>()
			.notNull()
			.default(sql`'[]'`),
		placed: integer('placed', { mode: 'boolean' }).notNull().default(false),
		updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
	},
	(t) => [primaryKey({ columns: [t.templateId, t.slug] })]
);

/** The assembled 3D model of a template, built per install from uploaded STEP files. The GLB lives in the data volume (see uploadsDir()); this row records it. */
export const templateModels = sqliteTable('template_models', {
	templateId: text('template_id')
		.primaryKey()
		.references(() => templates.id, { onDelete: 'cascade' }),
	glbPath: text('glb_path').notNull(),
	/** Changes on every re-import; part of the model URL for cache busting. */
	version: text('version').notNull(),
	size: integer('size').notNull().default(0),
	/** Part slugs present as nodes in the GLB. */
	slugs: text('slugs', { mode: 'json' })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
	sourceNote: text('source_note').notNull().default(''),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: createdAt()
});

/** Background conversions of an uploaded STEP zip into the template's GLB (milestone 4). */
export const templateModelJobs = sqliteTable(
	'template_model_jobs',
	{
		id: id(),
		templateId: templateId(),
		status: text('status').notNull().default('queued'), // queued | running | done | failed
		progress: integer('progress').notNull().default(0), // 0-100
		message: text('message').notNull().default(''),
		/** Uploaded file under the uploads dir; deleted after the job unless kept for debugging. */
		inputPath: text('input_path').notNull(),
		/** Per-file results: { file, slug | null, status, triangles?, ms?, error? }[] */
		report: text('report', { mode: 'json' })
			.$type<Record<string, unknown>[]>()
			.notNull()
			.default(sql`'[]'`),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('template_model_jobs_template_idx').on(t.templateId, t.createdAt)]
);

/**
 * Built-in plate layouts per printer family (milestone 5), e.g. 'xpa' (Bambu
 * X1/P1/A1, 24 plates) and 'h2d' (Bambu H2D/H2S, 21 plates). Data only: plate
 * names, part slugs, runs and estimates; no slicer files. `template_plates`
 * stays the default layout for existing code.
 */
export const templatePlateLayouts = sqliteTable(
	'template_plate_layouts',
	{
		templateId: templateId(),
		key: text('key').notNull(),
		name: text('name').notNull(),
		printerNote: text('printer_note').notNull().default(''),
		isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
		plates: text('plates', { mode: 'json' })
			.$type<
				{
					number: number;
					name: string;
					estSeconds: number | null;
					runs: number;
					runNote?: string;
					perPartRuns?: boolean;
					parts: string[];
				}[]
			>()
			.notNull()
			.default(sql`'[]'`),
		sort: integer('sort').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.templateId, t.key] })]
);

// ---- Color designs

export const colorDesigns = sqliteTable('color_designs', {
	id: id(),
	templateId: templateId(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
	roles: text('roles', { mode: 'json' })
		.$type<{ key: string; name: string; material: string; hex: string }[]>()
		.notNull()
		.default(sql`'[]'`),
	partRoles: text('part_roles', { mode: 'json' })
		.$type<Record<string, string>>()
		.notNull()
		.default(sql`'{}'`),
	isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
	createdAt: createdAt()
});

// ---- Builds

export const builds = sqliteTable(
	'builds',
	{
		id: id(),
		organizationId: text('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		templateId: text('template_id')
			.notNull()
			.references(() => templates.id),
		name: text('name').notNull(),
		recipient: text('recipient'),
		hospital: text('hospital'),
		phase: text('phase').notNull().default('design'),
		deliveryDate: text('delivery_date'),
		design: text('design', { mode: 'json' }).$type<Record<string, unknown>>(),
		/** group key → option key; null on builds from before variants (= template defaults). */
		variantChoices: text('variant_choices', { mode: 'json' }).$type<Record<string, string>>(),
		/** Plate layout source: a template_plate_layouts key, or 'upload' when plates came from the build's own 3MF. Null = template default. */
		plateLayout: text('plate_layout'),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id),
		createdAt: createdAt()
	},
	(t) => [index('builds_org_idx').on(t.organizationId)]
);

const buildId = () =>
	text('build_id')
		.notNull()
		.references(() => builds.id, { onDelete: 'cascade' });

export const buildFilaments = sqliteTable(
	'build_filaments',
	{
		buildId: buildId(),
		roleKey: text('role_key').notNull(),
		name: text('name').notNull(),
		material: text('material').notNull(),
		hex: text('hex').notNull(),
		spools: real('spools').notNull().default(0),
		spoolmanSpoolId: integer('spoolman_spool_id')
	},
	(t) => [primaryKey({ columns: [t.buildId, t.roleKey] })]
);

export const buildParts = sqliteTable(
	'build_parts',
	{
		buildId: buildId(),
		partSlug: text('part_slug').notNull(),
		status: text('status').notNull().default('To print'),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		printedOn: text('printed_on'),
		runEstSeconds: integer('run_est_seconds'),
		comps: text('comps', { mode: 'json' })
			.$type<Record<string, boolean>>()
			.notNull()
			.default(sql`'{}'`),
		assigneeUserId: text('assignee_user_id').references(() => user.id, { onDelete: 'set null' }),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
	},
	(t) => [primaryKey({ columns: [t.buildId, t.partSlug] })]
);

export const buildPlates = sqliteTable(
	'build_plates',
	{
		buildId: buildId(),
		number: integer('number').notNull(),
		name: text('name').notNull(),
		estSeconds: integer('est_seconds'),
		runs: integer('runs').notNull().default(1),
		perPartRuns: integer('per_part_runs', { mode: 'boolean' }).notNull().default(false),
		parts: text('parts', { mode: 'json' })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		slicerGrams: real('slicer_grams'),
		slicerByPart: text('slicer_by_part', { mode: 'json' })
			.$type<Record<string, number>>()
			.notNull()
			.default(sql`'{}'`),
		thumbnailPath: text('thumbnail_path'),
		/** Grams per run by build filament role key, from a sliced 3MF (milestone 5). */
		filamentGrams: text('filament_grams', { mode: 'json' })
			.$type<Record<string, number>>()
			.notNull()
			.default(sql`'{}'`),
		/** 'template' | 'layout:<key>' | 'upload:<build_uploads.id>' */
		source: text('source').notNull().default('template')
	},
	(t) => [primaryKey({ columns: [t.buildId, t.number] })]
);

export const printRuns = sqliteTable(
	'print_runs',
	{
		id: id(),
		buildId: buildId(),
		plateNumber: integer('plate_number'),
		partSlug: text('part_slug'),
		partSlugs: text('part_slugs', { mode: 'json' }).$type<string[]>(),
		date: text('date').notNull(),
		result: text('result').notNull(),
		grams: real('grams'),
		hours: real('hours'),
		printer: text('printer'),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		note: text('note').notNull().default('')
	},
	(t) => [index('print_runs_build_idx').on(t.buildId)]
);

export const activity = sqliteTable(
	'activity',
	{
		id: id(),
		buildId: buildId(),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		kind: text('kind').notNull(),
		payload: text('payload', { mode: 'json' })
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'`),
		at: integer('at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
	},
	(t) => [index('activity_build_idx').on(t.buildId, t.at)]
);

/** Slicer files uploaded to a build (milestone 5). The original file is not kept; only the parsed summary and thumbnails. */
export const buildUploads = sqliteTable(
	'build_uploads',
	{
		id: id(),
		buildId: buildId(),
		kind: text('kind').notNull().default('3mf'),
		fileName: text('file_name').notNull(),
		size: integer('size').notNull().default(0),
		/** Parsed, normalised 3MF summary (printer, filaments, plates, objects) plus the user's object → part mapping. */
		summary: text('summary', { mode: 'json' })
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'`),
		status: text('status').notNull().default('parsed'), // parsed | applied | discarded
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('build_uploads_build_idx').on(t.buildId, t.createdAt)]
);
