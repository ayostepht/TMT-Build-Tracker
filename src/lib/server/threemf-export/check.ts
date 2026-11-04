/**
 * Placement guard for the export: transforms every item's real mesh vertices with the exact
 * 3MF transform the writer emits and checks them against the plate: inside the bed, resting on
 * z = 0, below the build height, and clear of the other items (bounding boxes). Catches pivot
 * mistakes that symmetric test shapes hide. Pure apart from the mesh reader it is given.
 */
import { convexHull, polygonDistance, type Pt } from '#lib/domain/geom2d.ts';
import type { PrintMesh } from '../print-geometry/mesh-format';
import type { ExportWarning, ExportPlan } from './plan';
import { itemTransform } from './writer';

export interface Placed {
	plate: number;
	object: string;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	z0: number;
	z1: number;
	/** Convex hull of the item's footprint on the bed. */
	hull?: Pt[];
	/** Rigid source group on the plate, if any. */
	group?: number;
}

/** Bounding box of one item in the plate's own (bed) coordinates. */
export function placedBounds(mesh: PrintMesh, transform: string) {
	const t = transform.split(' ').map(Number);
	const b = {
		x0: Infinity,
		x1: -Infinity,
		y0: Infinity,
		y1: -Infinity,
		z0: Infinity,
		z1: -Infinity
	};
	const p = mesh.positions;
	for (let i = 0; i < p.length; i += 3) {
		const x = p[i];
		const y = p[i + 1];
		const z = p[i + 2];
		const X = x * t[0] + y * t[3] + z * t[6] + t[9];
		const Y = x * t[1] + y * t[4] + z * t[7] + t[10];
		const Z = x * t[2] + y * t[5] + z * t[8] + t[11];
		if (X < b.x0) b.x0 = X;
		if (X > b.x1) b.x1 = X;
		if (Y < b.y0) b.y0 = Y;
		if (Y > b.y1) b.y1 = Y;
		if (Z < b.z0) b.z0 = Z;
		if (Z > b.z1) b.z1 = Z;
	}
	return b;
}

/** Convex hull of the transformed mesh's XY footprint. */
export function placedHull(mesh: PrintMesh, transform: string): Pt[] {
	const t = transform.split(' ').map(Number);
	const p = mesh.positions;
	const pts: Pt[] = [];
	for (let i = 0; i < p.length; i += 3)
		pts.push([
			p[i] * t[0] + p[i + 1] * t[3] + p[i + 2] * t[6] + t[9],
			p[i] * t[1] + p[i + 1] * t[4] + p[i + 2] * t[7] + t[10]
		]);
	return convexHull(pts);
}

/** True when a mesh vertex lies inside the rectangle (shrunk by `tol` on every side). */
export function placedInKeepOut(
	mesh: PrintMesh,
	transform: string,
	z: { x: number; y: number; w: number; d: number },
	tol: number
): boolean {
	const t = transform.split(' ').map(Number);
	const p = mesh.positions;
	for (let i = 0; i < p.length; i += 3) {
		const X = p[i] * t[0] + p[i + 1] * t[3] + p[i + 2] * t[6] + t[9];
		const Y = p[i] * t[1] + p[i + 1] * t[4] + p[i + 2] * t[7] + t[10];
		if (X > z.x + tol && X < z.x + z.w - tol && Y > z.y + tol && Y < z.y + z.d - tol) return true;
	}
	return false;
}

export function checkPlacement(
	plan: ExportPlan,
	readMesh: (file: string) => PrintMesh,
	tol = 0.3
): { warnings: ExportWarning[]; placed: Placed[] } {
	const warnings: ExportWarning[] = [];
	const placed: Placed[] = [];
	const meshes = new Map<number, PrintMesh | null>();
	const mesh = (id: number) => {
		if (!meshes.has(id)) {
			const o = plan.objects.find((x) => x.id === id);
			try {
				meshes.set(id, o ? readMesh(o.meshFile) : null);
			} catch {
				meshes.set(id, null);
			}
		}
		return meshes.get(id) ?? null;
	};
	const { bedX, bedY, bedZ } = plan.printer;
	for (const pl of plan.plates) {
		const here: Placed[] = [];
		for (const it of pl.items) {
			const m = mesh(it.objectId);
			if (!m) continue;
			const o = plan.objects.find((x) => x.id === it.objectId)!;
			const b = placedBounds(m, itemTransform(it, 0, 0));
			const cur: Placed = {
				plate: pl.number,
				object: o.partName,
				...b,
				hull: placedHull(m, itemTransform(it, 0, 0)),
				...(it.group !== undefined ? { group: it.group } : {})
			};
			here.push(cur);
			const problems: string[] = [];
			for (const z of plan.printer.keepOut ?? [])
				if (placedInKeepOut(m, itemTransform(it, 0, 0), z, 0.05))
					problems.push(
						`reaches into the ${z.label || 'keep-out'} area (x ${z.x}..${z.x + z.w}, y ${z.y}..${z.y + z.d} mm)`
					);
			if (b.x0 < -tol || b.y0 < -tol || b.x1 > bedX + tol || b.y1 > bedY + tol)
				problems.push(
					`reaches ${b.x0.toFixed(1)}..${b.x1.toFixed(1)} x ${b.y0.toFixed(1)}..${b.y1.toFixed(1)} mm on a ${bedX} x ${bedY} mm bed`
				);
			if (Math.abs(b.z0) > 0.1)
				problems.push(`does not rest on the bed (lowest point z = ${b.z0.toFixed(2)})`);
			if (b.z1 > bedZ + tol)
				problems.push(`is ${b.z1.toFixed(0)} mm tall, above the ${bedZ} mm build height`);
			if (problems.length)
				warnings.push({
					code: b.z1 > bedZ + tol ? 'height' : 'bed',
					severity: 'error',
					plate: pl.number,
					slug: o.slug,
					message: `Plate ${pl.number} (${pl.name}): ${o.partName} ${problems.join('; ')}. Check its placement in your slicer.`
				});
		}
		for (let i = 0; i < here.length; i++)
			for (let j = i + 1; j < here.length; j++) {
				const a = here[i];
				const c = here[j];
				// pieces of one source group keep the kit author's layout, which may nest them (convex hulls overlap)
				if (a.group !== undefined && a.group === c.group) continue;
				// bounding boxes may overlap when parts nest on a diagonal: compare the real footprints (convex hulls)
				if (
					a.x1 > c.x0 + 0.05 &&
					c.x1 > a.x0 + 0.05 &&
					a.y1 > c.y0 + 0.05 &&
					c.y1 > a.y0 + 0.05 &&
					(!a.hull ||
						!c.hull ||
						a.hull.length < 3 ||
						c.hull.length < 3 ||
						polygonDistance(a.hull, c.hull) < 0)
				)
					warnings.push({
						code: 'bed',
						severity: 'error',
						plate: pl.number,
						message: `Plate ${pl.number} (${pl.name}): ${a.object} and ${c.object} overlap. Re-arrange the plates.`
					});
			}
		placed.push(...here);
	}
	return { warnings, placed };
}
