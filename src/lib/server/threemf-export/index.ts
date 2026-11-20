/**
 * 3MF export of a build for a slicer (see `plan.ts`, `writer.ts`, `plate-grid.ts`).
 *
 * Plates come from the build's arranged plates. A MakeGood layout chosen for the export's bed is
 * followed too: same plates and numbers as the Print tab, parts placed flat on each bed
 * (`placeOnPlates`). Otherwise (not arranged, a layout for another bed, an uploaded file, or an
 * arrangement out of date after a color change) a fresh arrangement is computed in memory and
 * used instead, with a note. Nothing is written to the database. Meshes come from
 * the print geometry imported in the kit admin page (`template_print_geometry`).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from '../access';
import { buildArrangement, buildLayouts } from '../builds/plates';
import { loadFootprints, placeOnPlates, planForBuild } from '../builds/arrange-plan';
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
import type { SourceMove } from '#lib/domain/arrange-source.ts';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { BuildPrinter, BuildView } from '#lib/domain/types.ts';
import type { ExportPreview } from '#lib/domain/export-types.ts';
import { layoutBed } from '#lib/printers/layout-bed.ts';

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

/**
 * The MakeGood layout the build's plates come from, when the plates are that layout's (not an
 * uploaded file's), and whether its bed is the export printer's bed.
 */
function kitLayoutFor(
	db: Db,
	buildId: string,
	userId: string,
	view: BuildView
): { name: string; bed: BuildPrinter; fits: boolean } | null {
	if (!view.plates.length || !view.printer) return null;
	// the maker's own file: its plates are the source, whatever bed it was sliced for
	if (view.plates.every((p) => p.source.startsWith('upload:')))
		return { name: 'your uploaded file', bed: view.printer, fits: true };
	if (!view.plates.every((p) => p.source === 'template' || p.source.startsWith('layout:')))
		return null;
	const { layouts, current } = buildLayouts(db, buildId, userId);
	const bed = layoutBed(current);
	if (!bed) return null;
	// a layout made for a bed the printer holds (the same or a bigger one) can be followed; a layout for
	// a bigger bed than the printer's cannot
	const within = (a: number, b: number) => a <= b + 0.5;
	return {
		name: layouts.find((l) => l.key === current)?.name ?? bed.name,
		bed,
		fits: within(bed.bedX, view.printer.bedX) && within(bed.bedY, view.printer.bedY)
	};
}

/** "plate 7", "plates 7 and 9", "a new plate 25", "new plates 25 and 26". */
function plateList(nums: number[], fresh: boolean): string {
	const list = [...new Set(nums)].sort((a, b) => a - b);
	const word = `${fresh ? 'new ' : ''}plate${list.length === 1 ? '' : 's'}`;
	const text =
		list.length > 2
			? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
			: list.join(' and ');
	return `${fresh && list.length === 1 ? 'a ' : ''}${word} ${text}`;
}

/**
 * One info note per source plate that gave up parts: which parts, where they went and why. A part that
 * joined a plate of the layout says so ("joined plate 15 (Push Handle Bottom)"); the others "moved to a
 * new plate 25".
 */
function moveNotes(moves: SourceMove[], view: BuildView, plates: ArrangedPlate[]): ExportWarning[] {
	const nameOf = (n: number) =>
		view.plates.find((p) => p.number === n)?.name ??
		plates.find((p) => p.number === n)?.name ??
		`Plate ${n}`;
	const partName = (slug: string) => view.parts.find((p) => p.slug === slug)?.name ?? slug;
	const out: ExportWarning[] = [];
	for (const f of [...new Set(moves.map((m) => m.from))]) {
		const mine = moves.filter((m) => m.from === f);
		const names = mine.map((m) => partName(m.slug)).join(', ');
		const many = mine.length !== 1;
		/** Where the parts went, one clause per destination: "X joined plate 15 (...)" / "Y moved to a new plate 25". */
		const joinedTo = [...new Set(mine.filter((m) => m.joined).map((m) => m.to))].sort(
			(a, b) => a - b
		);
		const clauses = joinedTo.map(
			(to) =>
				`${mine
					.filter((m) => m.joined && m.to === to)
					.map((m) => partName(m.slug))
					.join(', ')} joined plate ${to} (${nameOf(to)}), which prints in the same filament`
		);
		const fresh = mine.filter((m) => !m.joined);
		if (fresh.length)
			clauses.push(
				`${fresh.map((m) => partName(m.slug)).join(', ')} moved to ${plateList(
					fresh.map((m) => m.to),
					true
				)}`
			);
		const where = clauses.join('; ');
		if (f == null)
			out.push({
				code: 'arrangement',
				severity: 'info',
				message: `${names} ${many ? 'are' : 'is'} not on any plate of the layout, so ${many ? 'they were' : 'it was'} placed on ${plateList(
					mine.map((m) => m.to),
					true
				)}.`
			});
		else if (mine.every((m) => m.reason === 'bed'))
			out.push({
				code: 'arrangement',
				severity: 'info',
				plate: f,
				message: `Plate ${f} (${nameOf(f)}) does not fit one ${view.printer?.bedX} × ${view.printer?.bedY} mm bed on ${view.printer?.name}, so ${names} moved to ${plateList(
					mine.map((m) => m.to),
					true
				)} (after the last plate). The other plates match the Print tab.`
			});
		else
			out.push({
				code: 'arrangement',
				severity: 'info',
				plate: f,
				message: `On plate ${f} (${nameOf(f)}), ${names} no longer ${many ? 'share' : 'shares'} a filament with the rest of the plate. ${where.charAt(0).toUpperCase()}${where.slice(1)}. The other parts stay where they are.`
			});
	}
	return out;
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
	const arrangedOk = info.layout === 'arranged' && plates.length > 0 && !info.stale && !hasPose;
	if (!arrangedOk) {
		// A MakeGood layout chosen for this bed: the file keeps the Print tab's plates (same numbers,
		// names and parts) and only places the parts on each bed.
		const kit = info.layout === 'arranged' ? null : kitLayoutFor(db, buildId, userId, view);
		const placed = kit?.fits ? placeOnPlates(view, footprints, null) : null;
		if (kit?.fits && placed?.plates.length) {
			plates = placed.plates;
			notes.push(...moveNotes(placed.moves, view, placed.plates));
		} else {
			const plan = planForBuild(db, view, footprints, null);
			if (!plan) throw new ApiError(400, 'Choose a printer first.');
			plates = plan.result.plates;
			const how = `On the Files tab choose "Arrange for my bed" (or "Re-arrange plates") to match`;
			notes.push({
				code: 'arrangement',
				severity: 'info',
				message:
					info.layout === 'arranged'
						? `The colors changed since the plates were arranged, so the file uses a fresh arrangement (plate numbers may differ). Re-arrange on the Print tab to match.`
						: kit && !kit.fits
							? `The plates use MakeGood's ${kit.name} layout, made for a ${kit.bed.bedX} × ${kit.bed.bedY} mm bed, not for ${view.printer.name} (${view.printer.bedX} × ${view.printer.bedY} mm), so the file uses a fresh arrangement (plate numbers may differ). ${how} the Print tab.`
							: `The build's plates are not arranged for ${view.printer.name}, so the file uses a fresh arrangement (plate numbers may differ from the Print tab). ${how} the Print tab.`
			});
		}
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
