/**
 * Turns a build's arranged plates into an export plan: which objects exist, which filament
 * slot each one uses, where every copy sits and what could not be exported. Pure (no DB,
 * no files) so the preview endpoint, the writer and the tests share it.
 */
import type { ArrangedPlate, ItemPose } from '#lib/domain/arrange.ts';
import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
import type { BuildPrinter, BuildView } from '#lib/domain/types.ts';
import { materialFamily } from '#lib/filament-catalog.ts';
import { effectiveKeepOut } from '#lib/printers/printer.ts';
import type { ExportWarning, Flavor } from '#lib/domain/export-types.ts';
import { plateOrigin } from './plate-grid';

export type { ExportWarning, ExportWarningCode, Flavor } from '#lib/domain/export-types.ts';
export { FLAVORS } from '#lib/domain/export-types.ts';

export interface PlanFilament {
	/** 1-based slot in the slicer project. */
	index: number;
	key: string;
	/** "Accent" for template roles, the filament's name for added colors. */
	label: string;
	name: string;
	material: string;
	/** Slicer filament type: PETG, TPU, PLA, ... */
	type: string;
	hex: string;
	/** Whether any exported object uses it. */
	used: boolean;
}

export interface PlannedObject {
	/** 1-based id in the file (the plain flavor renumbers per file). */
	id: number;
	slug: string;
	piece: number;
	role: string;
	filamentIndex: number;
	/** Object name in the slicer; the plain flavor adds the filament. */
	name: string;
	partName: string;
	meshFile: string;
	tris: number;
	settings: Record<string, string>;
	/** The kit author's per-volume settings (written to the part's metadata). */
	partSettings: Record<string, string>;
}

export interface PlannedItem {
	objectId: number;
	/** 0-based among the copies of this object across the whole project. */
	instanceId: number;
	/** Centre of the box in plate (bed) coordinates, mm. */
	x: number;
	y: number;
	w: number;
	d: number;
	/** Degrees counter-clockwise about z. */
	rotation: number;
	/** Offset of the turned mesh's box centre from its origin (free angles). */
	ox?: number;
	oy?: number;
	/** 3D re-orientation of the stored mesh (applied before the rotation about z); absent = as stored. */
	pose?: ItemPose;
}

export interface PlannedPlate {
	/** 1-based position in the exported file. */
	index: number;
	/** The plate's number in the build (Print tab). */
	number: number;
	name: string;
	runs: number;
	roles: string[];
	items: PlannedItem[];
	/** Offset of this plate's bed in the project's build volume (Orca/Bambu layout). */
	originX: number;
	originY: number;
	oversize: boolean;
}

export interface ExportPlan {
	flavor: Flavor;
	buildName: string;
	templateId: string;
	printer: BuildPrinter;
	filaments: PlanFilament[];
	objects: PlannedObject[];
	plates: PlannedPlate[];
	warnings: ExportWarning[];
	/** Parts left out because no print geometry is imported for them. */
	missing: { slug: string; name: string }[];
}

export interface PlanInput {
	view: BuildView;
	/** Arranged plates (positions); see arrange.README.md. */
	plates: ArrangedPlate[];
	footprints: Map<string, PrintFootprint>;
	flavor: Flavor;
	/** Plate numbers to export; default all. */
	selected?: number[];
	/** Extra notes to show with the warnings. */
	notes?: ExportWarning[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const roleLabel = (f: { key: string; name: string }) =>
	/^[a-z]+$/.test(f.key) && f.key.length <= 12 ? cap(f.key) : f.name;

/** Slicer filament type for a material string ("PETG", "TPU 95A" -> TPU). */
export function slicerType(material: string): string {
	const fam = materialFamily(material);
	if (fam === 'tpu') return 'TPU';
	if (fam === 'petg') return 'PETG';
	const w = material.trim().split(/[\s-]+/)[0];
	return (w || 'PETG').toUpperCase();
}

export class PlanError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

export function buildExportPlan(input: PlanInput): ExportPlan {
	const { view, footprints, flavor } = input;
	const printer = view.printer && { ...view.printer, keepOut: effectiveKeepOut(view.printer) };
	if (!printer)
		throw new PlanError('Choose a printer first (Print tab) so the export knows your bed.');
	const warnings: ExportWarning[] = [...(input.notes ?? [])];

	let source = [...input.plates].sort((a, b) => a.number - b.number);
	if (input.selected?.length) {
		const want = new Set(input.selected);
		const known = new Set(source.map((p) => p.number));
		const bad = [...want].filter((n) => !known.has(n));
		if (bad.length) throw new PlanError(`This build has no plate ${bad.join(', ')}.`);
		source = source.filter((p) => want.has(p.number));
	}

	const filaments: PlanFilament[] = view.filaments.map((f, i) => ({
		index: i + 1,
		key: f.key,
		label: roleLabel(f),
		name: f.name,
		material: f.material,
		type: slicerType(f.material),
		hex: /^#[0-9a-f]{6}$/i.test(f.hex) ? f.hex.toUpperCase() : '#808080',
		used: false
	}));
	const slotOf = new Map(filaments.map((f) => [f.key, f]));
	const partOf = new Map(view.parts.map((p) => [p.slug, p]));

	const objects = new Map<string, PlannedObject>();
	const instanceCount = new Map<string, number>();
	const plates: PlannedPlate[] = [];
	const missing = new Map<string, string>();

	for (const pl of source) {
		const items: PlannedItem[] = [];
		if (!pl.items.length) for (const s of pl.parts) missing.set(s, partOf.get(s)?.name ?? s);
		for (const it of pl.items) {
			const part = partOf.get(it.slug);
			const piece = footprints.get(it.slug)?.pieces[it.piece];
			const fil = slotOf.get(it.role);
			if (!piece?.mesh || !part || !fil) {
				missing.set(it.slug, part?.name ?? it.slug);
				continue;
			}
			const key = `${it.slug}#${it.piece}#${it.role}`;
			let obj = objects.get(key);
			if (!obj) {
				const fp = footprints.get(it.slug)!;
				const multi = fp.pieces.length > 1 && piece.name && piece.name !== part.name;
				obj = {
					id: objects.size + 1,
					slug: it.slug,
					piece: it.piece,
					role: it.role,
					filamentIndex: fil.index,
					partName: part.name,
					name: multi ? `${part.name} - ${piece.name}` : part.name,
					meshFile: piece.mesh,
					tris: piece.tris ?? 0,
					settings: piece.settings ?? {},
					partSettings: piece.partSettings ?? {}
				};
				objects.set(key, obj);
			}
			fil.used = true;
			const n = instanceCount.get(key) ?? 0;
			instanceCount.set(key, n + 1);
			items.push({
				objectId: obj.id,
				instanceId: n,
				x: it.x,
				y: it.y,
				w: it.w,
				d: it.d,
				rotation: it.rotation,
				...(it.ox || it.oy ? { ox: it.ox, oy: it.oy } : {}),
				...(it.pose ? { pose: it.pose } : {})
			});
		}
		if (!items.length) continue;
		for (const i of items)
			if (i.pose && i.pose.h > printer.bedZ + 1e-6)
				warnings.push({
					code: 'height',
					severity: 'error',
					plate: pl.number,
					message: `Plate ${pl.number} (${pl.name}): a re-oriented part is ${Math.round(i.pose.h)} mm tall, more than the ${printer.bedZ} mm build height.`
				});
		if (pl.oversize)
			warnings.push({
				code: 'oversize',
				severity: 'error',
				plate: pl.number,
				message: `Plate ${pl.number} (${pl.name}): a part is bigger than the ${printer.bedX} × ${printer.bedY} mm bed. It is centred and overhangs the plate.`
			});
		else if (
			items.some(
				(i) =>
					i.x - i.w / 2 < -1e-6 ||
					i.y - i.d / 2 < -1e-6 ||
					i.x + i.w / 2 > printer.bedX + 1e-6 ||
					i.y + i.d / 2 > printer.bedY + 1e-6
			)
		)
			warnings.push({
				code: 'bed',
				severity: 'error',
				plate: pl.number,
				message: `Plate ${pl.number} (${pl.name}): an item lies outside the ${printer.bedX} × ${printer.bedY} mm bed. Re-arrange the plates.`
			});
		if (pl.roles.length > printer.mmSlots)
			warnings.push({
				code: 'slots',
				severity: 'error',
				plate: pl.number,
				message: `Plate ${pl.number} (${pl.name}) needs ${pl.roles.length} filaments but ${printer.name} takes ${printer.mmSlots} at once. Re-arrange, or swap spools by hand.`
			});
		plates.push({
			index: plates.length + 1,
			number: pl.number,
			name: pl.runs > 1 ? `${pl.name} (print x${pl.runs})` : pl.name,
			runs: pl.runs,
			roles: pl.roles,
			items,
			originX: 0,
			originY: 0,
			oversize: !!pl.oversize
		});
	}

	const turned = new Map<string, { desc: string; plate: number }>();
	for (const pl of plates)
		for (const it of pl.items) {
			const o = [...objects.values()].find((x) => x.id === it.objectId);
			if (it.pose && o && !turned.has(o.slug))
				turned.set(o.slug, { desc: it.pose.desc, plate: pl.number });
		}
	for (const [slug, t] of turned)
		warnings.push({
			code: 'reoriented',
			severity: 'info',
			slug,
			plate: t.plate,
			message: `${partOf.get(slug)?.name ?? slug} is re-oriented to fit the ${printer.bedX} × ${printer.bedY} mm bed (${t.desc}); it does not sit as MakeGood prints it. Check supports in your slicer.`
		});

	if (missing.size)
		warnings.push({
			code: 'no-geometry',
			severity: 'warn',
			message: `No print geometry is imported for ${[...missing.values()].join(', ')}; left out of the file.`
		});

	if (flavor !== 'plain') {
		plates.forEach((p, i) => {
			const o = plateOrigin(i, plates.length, printer.bedX, printer.bedY);
			p.originX = o.x;
			p.originY = o.y;
		});
	}
	const usedSlots = filaments.filter((f) => f.used);
	if (usedSlots.length && usedSlots.some((f) => f.index > printer.mmSlots) && flavor !== 'plain')
		warnings.push({
			code: 'slots',
			severity: 'warn',
			message: `The project uses filament slot ${Math.max(...usedSlots.map((f) => f.index))}, but ${printer.name} has ${printer.mmSlots}. Map the slots in your slicer before printing those plates.`
		});

	return {
		flavor,
		buildName: view.build.name,
		templateId: view.build.templateId,
		printer,
		filaments,
		objects: [...objects.values()],
		plates,
		warnings,
		missing: [...missing].map(([slug, name]) => ({ slug, name }))
	};
}

/** Object name with the filament appended, for slicers that cannot store the filament per object. */
export function plainObjectName(o: PlannedObject, f: PlanFilament): string {
	return `${o.name} [${f.label} ${f.material} - ${f.name}]`;
}
