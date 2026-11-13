/**
 * 3MF export of a build for a slicer (see `plan.ts`, `writer.ts`, `plate-grid.ts`).
 *
 * Plates come from the build's arranged plates; when the build is not arranged (or its
 * arrangement is out of date after a color change) a fresh arrangement is computed in
 * memory and used instead, with a note. Nothing is written to the database. Meshes come from
 * the print geometry imported in the kit admin page (`template_print_geometry`).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from '../access';
import { buildArrangement } from '../builds/plates';
import { loadFootprints, planArrangement } from '../builds/arrange-plan';
import { loadBuildView } from '../builds/view';
import type { Db } from '../db';
import { printDir, readPieceMesh } from '../print-geometry/store';
import {
	buildExportPlan,
	PlanError,
	type ExportPlan,
	type ExportWarning,
	type Flavor,
	FLAVORS
} from './plan';
import { checkPlacement } from './check';
import { slug, writePlainZip, writeThreeMf, type WriteOptions } from './writer';
import type { ArrangedPlate } from '#lib/domain/arrange.ts';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { BuildView } from '#lib/domain/types.ts';
import type { ExportPreview } from '#lib/domain/export-types.ts';

export * from './plan';
export { plateColumns, plateOrigin } from './plate-grid';

export interface ExportOptions {
	flavor: Flavor;
	/** Plate numbers (as on the Print tab); default all. */
	plates?: number[];
}

export interface PreparedExport {
	plan: ExportPlan;
	view: BuildView;
}

export function parseFlavor(v: string | null | undefined): Flavor {
	const f = (v ?? 'orca').toLowerCase();
	if (!FLAVORS.includes(f as Flavor))
		throw new ApiError(400, 'flavor must be orca, bambu or plain');
	return f as Flavor;
}

export function parsePlates(v: string | null | undefined): number[] | undefined {
	if (!v) return undefined;
	const out = v.split(',').map((s) => Number(s.trim()));
	if (out.some((n) => !Number.isInteger(n) || n < 1 || n > 999))
		throw new ApiError(400, 'plates must be a comma-separated list of plate numbers');
	return [...new Set(out)];
}

/** Resolve the plan for a build: access check, arrangement, geometry. Throws ApiError. */
export function prepareExport(
	db: Db,
	buildId: string,
	userId: string,
	opts: ExportOptions
): PreparedExport {
	const loaded = loadBuildView(db, buildId, userId);
	if (!loaded) throw new ApiError(404, 'Not found');
	// a built-in MakeGood layout stands for its bed when the build has no printer of its own
	const view = loaded.printer ? loaded : { ...loaded, printer: loaded.layoutPrinter ?? null };
	if (!view.printer)
		throw new ApiError(400, 'Choose a printer first (Print tab) so the export knows your bed.');
	const footprints = loadFootprints(db, view.build.templateId);
	const info = buildArrangement(db, buildId, userId);
	const notes: ExportWarning[] = [];
	let plates: ArrangedPlate[] = info.plates;
	// Arrangements stored before the 3D re-orientation code was removed may still carry a
	// legacy `pose` on items (tipped/tilted parts): never export those, re-arrange flat instead.
	const hasPose = plates.some((pl) =>
		pl.items.some((i) => typeof i === 'object' && i !== null && 'pose' in i)
	);
	if (info.layout !== 'arranged' || !plates.length || info.stale || hasPose) {
		const plan = planArrangement(view, footprints, null);
		if (!plan) throw new ApiError(400, 'Choose a printer first.');
		plates = plan.result.plates;
		notes.push({
			code: 'arrangement',
			severity: 'info',
			message:
				info.layout !== 'arranged'
					? `The build's plates are not arranged for ${view.printer.name} yet, so the file uses a fresh arrangement (plate numbers may differ from the Print tab).`
					: `The colors changed since the plates were arranged, so the file uses a fresh arrangement (plate numbers may differ). Re-arrange on the Print tab to match.`
		});
	}
	try {
		const plan = buildExportPlan({
			view,
			plates,
			footprints: footprints as Map<string, PrintFootprint>,
			flavor: opts.flavor,
			selected: opts.plates,
			notes
		});
		// Meshes that vanished from disk count as missing geometry.
		const dir = printDir(view.build.templateId);
		const gone = new Set(
			plan.objects.filter((o) => !existsSync(join(dir, o.meshFile))).map((o) => o.id)
		);
		if (gone.size) {
			for (const o of plan.objects)
				if (gone.has(o.id) && !plan.missing.some((m) => m.slug === o.slug))
					plan.missing.push({ slug: o.slug, name: o.partName });
			for (const p of plan.plates) p.items = p.items.filter((i) => !gone.has(i.objectId));
			plan.plates = plan.plates.filter((p) => p.items.length);
			plan.objects = plan.objects.filter((o) => !gone.has(o.id));
			plan.warnings.push({
				code: 'no-geometry',
				severity: 'warn',
				message: 'Some mesh files are missing on disk; re-import the print geometry.'
			});
		}
		// Guard: the real meshes through the exact transforms must stay on the plate.
		const io = (f: string) => readPieceMesh(view.build.templateId, f);
		const guard = checkPlacement(plan, io);
		plan.warnings.push(...guard.warnings);
		return { plan, view };
	} catch (e) {
		if (e instanceof PlanError) throw new ApiError(e.status, e.message);
		throw e;
	}
}

/** Everything the UI shows before download. Never throws for "no geometry"; `ready` says so. */
export function previewExport(
	db: Db,
	buildId: string,
	userId: string,
	opts: ExportOptions
): ExportPreview {
	const { plan } = prepareExport(db, buildId, userId, opts);
	const objectOf = new Map(plan.objects.map((o) => [o.id, o]));
	return {
		flavor: plan.flavor,
		printer: {
			name: plan.printer.name,
			bedX: plan.printer.bedX,
			bedY: plan.printer.bedY,
			mmSlots: plan.printer.mmSlots
		},
		ready: plan.plates.length > 0,
		reason: plan.plates.length ? null : 'no-geometry',
		plates: plan.plates.map((p) => {
			const byObj = new Map<number, number>();
			for (const i of p.items) byObj.set(i.objectId, (byObj.get(i.objectId) ?? 0) + 1);
			return {
				index: p.index,
				number: p.number,
				name: p.name,
				runs: p.runs,
				items: p.items.length,
				roles: p.roles,
				objects: [...byObj].map(([id, count]) => {
					const o = objectOf.get(id)!;
					return {
						name: o.name,
						slug: o.slug,
						role: o.role,
						filamentIndex: o.filamentIndex,
						count
					};
				})
			};
		}),
		filaments: plan.filaments,
		warnings: plan.warnings,
		missing: plan.missing,
		files: plan.flavor === 'plain' ? plan.plates.length : 1
	};
}

export interface ExportResult {
	stream: ReadableStream<Uint8Array>;
	filename: string;
	contentType: string;
	warnings: ExportWarning[];
	missing: { slug: string; name: string }[];
}

/** Turn an async generator into a pull-based web stream (backpressure per chunk). */
export function toWebStream(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async pull(ctl) {
			try {
				const { value, done } = await gen.next();
				if (done) ctl.close();
				else ctl.enqueue(value);
			} catch (e) {
				ctl.error(e);
			}
		},
		async cancel() {
			await gen.return(undefined);
		}
	});
}

export function chunksOf(
	prepared: PreparedExport,
	opts: WriteOptions = {}
): AsyncGenerator<Uint8Array> {
	const { plan } = prepared;
	const io = { readMesh: (file: string) => readPieceMesh(plan.templateId, file) };
	if (plan.flavor === 'plain')
		return plan.plates.length === 1
			? writeThreeMf(plan, plan.plates, io, opts)
			: writePlainZip(plan, io, opts);
	return writeThreeMf(plan, plan.plates, io, opts);
}

export function exportFilename(plan: ExportPlan): string {
	const zip = plan.flavor === 'plain' && plan.plates.length > 1;
	// One plate: always name it ("-plateN"), the printer job linker matches on that file name.
	const only = plan.plates.length === 1 ? `-plate${plan.plates[0].number}` : '';
	return `TMT-${slug(plan.buildName)}-${slug(plan.printer.name)}-${plan.flavor}${only}.${zip ? 'zip' : '3mf'}`;
}

/** Stream the export of a build; throws ApiError (400 without a printer, 409 without geometry). */
export function exportBuild3mf(
	db: Db,
	buildId: string,
	userId: string,
	opts: ExportOptions
): ExportResult {
	const prepared = prepareExport(db, buildId, userId, opts);
	const { plan } = prepared;
	if (!plan.plates.length)
		throw new ApiError(
			409,
			'No print geometry is imported for this kit yet. A site admin imports the MakeGood profile 3MF on the kit page.'
		);
	const zip = plan.flavor === 'plain' && plan.plates.length > 1;
	return {
		stream: toWebStream(chunksOf(prepared)),
		filename: exportFilename(plan),
		contentType: zip ? 'application/zip' : 'model/3mf',
		warnings: plan.warnings,
		missing: plan.missing
	};
}
