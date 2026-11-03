/**
 * Column-major 4x4 matrices as plain number[16] (three.js `Matrix4.fromArray` order, mm),
 * with translation / Euler XYZ (degrees) / scale helpers for the placement editor.
 * No three.js import: usable in the admin page without loading the 3D library.
 */
export type Mat = number[];
export type Vec3 = [number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const RAD = Math.PI / 180;

type M3 = number[][]; // row-major [row][col]

function mul3(a: M3, b: M3): M3 {
	return a.map((_, r) =>
		[0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c])
	);
}

/** Rotation matrix for three.js Euler order 'XYZ' (R = Rx * Ry * Rz). */
function rotXYZ(rx: number, ry: number, rz: number): M3 {
	const [cx, sx, cy, sy, cz, sz] = [
		Math.cos(rx),
		Math.sin(rx),
		Math.cos(ry),
		Math.sin(ry),
		Math.cos(rz),
		Math.sin(rz)
	];
	const X: M3 = [
		[1, 0, 0],
		[0, cx, -sx],
		[0, sx, cx]
	];
	const Y: M3 = [
		[cy, 0, sy],
		[0, 1, 0],
		[-sy, 0, cy]
	];
	const Z: M3 = [
		[cz, -sz, 0],
		[sz, cz, 0],
		[0, 0, 1]
	];
	return mul3(mul3(X, Y), Z);
}

export interface Trs {
	pos: Vec3;
	/** Degrees, Euler XYZ. */
	rot: Vec3;
	scale: Vec3;
}

export function compose(t: Trs): Mat {
	const R = rotXYZ(t.rot[0] * RAD, t.rot[1] * RAD, t.rot[2] * RAD);
	const out = new Array<number>(16).fill(0);
	for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = R[r][c] * t.scale[c];
	out[12] = t.pos[0];
	out[13] = t.pos[1];
	out[14] = t.pos[2];
	out[15] = 1;
	return out;
}

export function determinant3(m: Mat): number {
	const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
	return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function isMirrored(m: Mat): boolean {
	return determinant3(m) < 0;
}

export function decompose(m: Mat): Trs {
	let sx = Math.hypot(m[0], m[1], m[2]);
	const sy = Math.hypot(m[4], m[5], m[6]);
	const sz = Math.hypot(m[8], m[9], m[10]);
	if (determinant3(m) < 0) sx = -sx;
	const r00 = m[0] / (sx || 1);
	const r01 = m[4] / (sy || 1);
	const r11 = m[5] / (sy || 1);
	const r12 = m[9] / (sz || 1);
	const r21 = m[6] / (sy || 1);
	const r22 = m[10] / (sz || 1);
	const r02 = Math.max(-1, Math.min(1, m[8] / (sz || 1)));
	const y = Math.asin(r02);
	let x: number;
	let z: number;
	if (Math.abs(r02) < 0.9999999) {
		x = Math.atan2(-r12, r22);
		z = Math.atan2(-r01, r00);
	} else {
		x = Math.atan2(r21, r11);
		z = 0;
	}
	return { pos: [m[12], m[13], m[14]], rot: [x / RAD, y / RAD, z / RAD], scale: [sx, sy, sz] };
}

/** Matrix product `a * b` (apply b first, then a). */
export function multiply(a: Mat, b: Mat): Mat {
	const o = new Array<number>(16).fill(0);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++)
			for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
	return o;
}

/** Flip (or restore) the X axis of the part's own frame: the mirrored copy of a left/right part. */
export function setMirrorX(m: Mat, mirrored: boolean): Mat {
	if (isMirrored(m) === mirrored) return m.slice();
	const t = decompose(m);
	t.scale = [-t.scale[0], t.scale[1], t.scale[2]];
	return compose(t);
}

export function translation(x: number, y: number, z: number): Mat {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * `count - 1` extra copies of a part spaced evenly around an axis that is parallel to
 * `axis` and passes through `center` (the main matrix is copy 0). Used for the tire
 * segments and rim halves around the wheel axle.
 */
export function ringInstances(
	base: Mat,
	count: number,
	center: Vec3,
	axis: 'x' | 'y' | 'z'
): Mat[] {
	const out: Mat[] = [];
	for (let k = 1; k < count; k++) {
		const a = (360 / count) * k;
		const rot: Vec3 = axis === 'x' ? [a, 0, 0] : axis === 'y' ? [0, a, 0] : [0, 0, a];
		const about = multiply(
			translation(center[0], center[1], center[2]),
			multiply(
				compose({ pos: [0, 0, 0], rot, scale: [1, 1, 1] }),
				translation(-center[0], -center[1], -center[2])
			)
		);
		out.push(multiply(about, base));
	}
	return out;
}

/** Round to 1e-4 and drop negative zero, for display and storage. */
export function tidy(m: Mat): Mat {
	return m.map((v) => {
		const r = Math.round(v * 1e4) / 1e4;
		return r === 0 ? 0 : r;
	});
}
