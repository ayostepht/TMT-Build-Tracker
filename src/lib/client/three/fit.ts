/**
 * Camera distance that keeps a bounding sphere of `radius` fully in view for a vertical
 * field of view `fovDeg` and the canvas `aspect` (width / height). Portrait canvases are
 * limited by the horizontal field of view, which is what made the first spike's fit too
 * tight at 390 px.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number, margin = 1.12): number {
	const v = (fovDeg * Math.PI) / 180;
	const h = 2 * Math.atan(Math.tan(v / 2) * Math.max(aspect, 0.05));
	return (radius * margin) / Math.sin(Math.min(v, h) / 2);
}

type V3 = [number, number, number];

/**
 * Tighter than the sphere fit: the distance at which every corner of a box (given relative
 * to the look-at point) is inside the frustum when viewed along `dir` (unit vector from the
 * target towards the camera, world up = +y). Works for any aspect ratio.
 */
export function fitDistanceBox(
	corners: V3[],
	dir: V3,
	fovDeg: number,
	aspect: number,
	margin = 1.06
): number {
	const f: V3 = [-dir[0], -dir[1], -dir[2]];
	// right = f x up(0,1,0)
	let r: V3 = [-f[2], 0, f[0]];
	const rl = Math.hypot(...r) || 1;
	r = [r[0] / rl, r[1] / rl, r[2] / rl];
	const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
	const tanV = Math.tan((fovDeg * Math.PI) / 360);
	const tanH = tanV * Math.max(aspect, 0.05);
	let d = 0;
	for (const c of corners) {
		const x = Math.abs(c[0] * r[0] + c[1] * r[1] + c[2] * r[2]);
		const y = Math.abs(c[0] * u[0] + c[1] * u[1] + c[2] * u[2]);
		const t = c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2];
		d = Math.max(d, t + x / tanH, t + y / tanV);
	}
	return d * margin;
}
