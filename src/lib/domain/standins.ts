/**
 * Stand-ins (pure numbers, no three.js): anchors for the generic casters and the stylized
 * harness that the 3D viewer draws procedurally because the kit's STEP files do not contain
 * them (the harness is flat-printed TPU that bends when installed; casters are bought hardware).
 *
 * Everything is derived from the world bounding boxes of the placed parts, so nudging a part in
 * the kit admin moves its stand-ins too. The constants below are tuned for the MakeGood TMT
 * (mm, y up, +z towards the front of the chair, +x the chair's left) and are generic numbers,
 * not geometry: see each comment for how it was derived from the assembly measurements.
 */

export type Vec3 = [number, number, number];
export interface Aabb {
	min: Vec3;
	max: Vec3;
}

export function aabbUnion(boxes: (Aabb | null | undefined)[]): Aabb | null {
	let out: Aabb | null = null;
	for (const b of boxes) {
		if (!b) continue;
		out = out
			? {
					min: [
						Math.min(out.min[0], b.min[0]),
						Math.min(out.min[1], b.min[1]),
						Math.min(out.min[2], b.min[2])
					],
					max: [
						Math.max(out.max[0], b.max[0]),
						Math.max(out.max[1], b.max[1]),
						Math.max(out.max[2], b.max[2])
					]
				}
			: { min: [...b.min], max: [...b.max] };
	}
	return out;
}

export const centre = (b: Aabb): Vec3 => [
	(b.min[0] + b.max[0]) / 2,
	(b.min[1] + b.max[1]) / 2,
	(b.min[2] + b.max[2]) / 2
];
export const size = (b: Aabb): Vec3 => [
	b.max[0] - b.min[0],
	b.max[1] - b.min[1],
	b.max[2] - b.min[2]
];

// ---- casters ---------------------------------------------------------------------

export interface CasterAnchor {
	kind: 'front' | 'rear';
	/** Swivel axis: x, z of the stem; `topY` is where the swivel plate meets the mount. */
	x: number;
	z: number;
	topY: number;
	/** y of the ground contact point of the tread. */
	groundY: number;
	wheelR: number;
	wheelW: number;
	/** Distance the wheel axle trails behind the swivel axis (towards -z). */
	trail: number;
	/**
	 * Swivel axis direction (unit, from the wheel up into the mount) when the mount is tilted.
	 * `topY` is then the pivot's y and the caster hangs along `-up`; absent means vertical.
	 */
	up?: Vec3;
}

/**
 * Front caster: one per front-caster-mount instance. The REV C mount is a thin tilted cap
 * (about 3 mm thick) with a square pin hole; the caster's swivel plate sits against its
 * underside with the stem through the hole and the wheel hangs below it along the plate's
 * normal (`drop` = plate to the wheel's lowest point).
 */
export const FRONT_CASTER = { wheelR: 21, wheelW: 16, drop: 48 } as const;
/**
 * Rear caster: one under the rear caster mounts (kit or McMaster, both occupy the same box).
 * From the assembly's McMaster Easy-Roll caster: wheel 98 mm across and 32 wide, swivel plate
 * 76.4 mm in front of the mount box's rear end, axle trailing the swivel axis by 36.5 mm,
 * tread on the same ground line as the big wheels.
 */
export const REAR_CASTER = { wheelR: 49, wheelW: 32, plateFromRear: 76.4, trail: 36.5 } as const;
/** Ground line when no wheel is placed (the big tire's lowest point in the assembly). */
export const DEFAULT_GROUND_Y = -29.8;

/** Where a caster attaches to a mount: a point on the mount's underside and that surface's normal. */
export interface MountFrame {
	pivot: Vec3;
	/** Unit normal of the underside, pointing into the mount (away from the wheel). */
	up: Vec3;
}

/**
 * Least-squares plane `y = a + b x + c z` through the mount's underside samples, evaluated at the
 * pin hole (centroid of the sample points that missed, `holes` as x, z pairs; `fallbackXZ` or the
 * samples' centroid when there are none). Null when there are too few or degenerate samples.
 */
export function fitMountFrame(
	under: Vec3[],
	holes: [number, number][],
	fallbackXZ?: [number, number]
): MountFrame | null {
	if (under.length < 6) return null;
	// Normal equations for [1 x z] * [a b c]^T = y.
	const m = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0]
	];
	const r = [0, 0, 0];
	for (const [x, y, z] of under) {
		const v = [1, x, z];
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) m[i][j] += v[i] * v[j];
			r[i] += v[i] * y;
		}
	}
	const det3 = (q: number[][]) =>
		q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) -
		q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) +
		q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
	const d = det3(m);
	if (Math.abs(d) < 1e-6) return null;
	const [a, b, c] = [0, 1, 2].map(
		(k) => det3(m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / d
	);
	const mean = (xs: number[]) => xs.reduce((t, v) => t + v, 0) / xs.length;
	const hx = holes.length
		? mean(holes.map((h) => h[0]))
		: (fallbackXZ?.[0] ?? mean(under.map((p) => p[0])));
	const hz = holes.length
		? mean(holes.map((h) => h[1]))
		: (fallbackXZ?.[1] ?? mean(under.map((p) => p[2])));
	const len = Math.hypot(b, 1, c);
	return { pivot: [hx, a + b * hx + c * hz, hz], up: [-b / len, 1 / len, -c / len] };
}

export function frontCasterAnchors(
	mounts: Aabb[],
	frames: (MountFrame | null | undefined)[] = []
): CasterAnchor[] {
	return mounts.map((b, i) => {
		const f = frames[i];
		const topY = f ? f.pivot[1] : b.max[1] - 4;
		return {
			kind: 'front',
			x: f ? f.pivot[0] : (b.min[0] + b.max[0]) / 2,
			z: f ? f.pivot[2] : (b.min[2] + b.max[2]) / 2,
			topY,
			groundY: topY - FRONT_CASTER.drop,
			wheelR: FRONT_CASTER.wheelR,
			wheelW: FRONT_CASTER.wheelW,
			trail: 0,
			...(f ? { up: f.up } : {})
		};
	});
}

export function rearCasterAnchor(mounts: Aabb[], groundY: number): CasterAnchor | null {
	const b = aabbUnion(mounts);
	if (!b) return null;
	return {
		kind: 'rear',
		x: (b.min[0] + b.max[0]) / 2,
		z: b.min[2] + REAR_CASTER.plateFromRear,
		topY: b.min[1],
		groundY,
		wheelR: REAR_CASTER.wheelR,
		wheelW: REAR_CASTER.wheelW,
		trail: REAR_CASTER.trail
	};
}

// ---- harness ---------------------------------------------------------------------

export interface HarnessInputs {
	/** The seat surface: cushion base, else the seat centre (top face = `max[1]`). */
	seat: Aabb;
	/** The back surface: back cushion, else the two seat-back pieces together. */
	back: Aabb;
	/** The footrest top (any variant), or null when it is not placed. */
	footrest: Aabb | null;
}

export interface Strap {
	name: 'shoulder' | 'lap' | 'crotch' | 'foot';
	/** Control points of the centre line (Catmull-Rom). */
	points: Vec3[];
	width: number;
	/** Direction the thin side faces (pointing away from the body); the ribbon lies flat to it. */
	normal: Vec3;
}
export interface Buckle {
	name: 'chest' | 'lap' | 'foot';
	pos: Vec3;
	/** Box size (x, y, z) in mm. */
	size: Vec3;
	/** Rotation about the y axis in degrees. */
	yaw: number;
}
export interface HarnessLayout {
	straps: Strap[];
	buckles: Buckle[];
}

/** Strap and buckle dimensions (mm): the kit's 2 cm and 3.2 cm webbing buckles, TPU strap 3 mm thick. */
export const HARNESS = {
	shoulderW: 32,
	lapW: 32,
	crotchW: 22,
	footW: 22,
	thickness: 3,
	standoff: 2.5,
	chestBuckle: [44, 34, 12] as Vec3,
	lapBuckle: [50, 30, 14] as Vec3,
	footBuckle: [26, 16, 10] as Vec3
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Harness anchors from the seat, back and footrest boxes.
 *
 * The backrest is modelled as the front face of the back box leaning from its bottom-front edge
 * to its top-rear edge (a 20 degree recline for the TMT's back cushion). The child's body is
 * assumed ~105 mm in front of that face at chest height and ~125 mm at the lap.
 */
export function harnessLayout(inp: HarnessInputs): HarnessLayout {
	const { seat, back, footrest } = inp;
	const seatY = seat.max[1];
	const seatFrontZ = seat.max[2];
	const backBottomY = back.min[1];
	const backTopY = back.max[1];
	const backH = Math.max(backTopY - backBottomY, 1);
	/** z of the back's front face at height y. */
	const backZ = (y: number) =>
		lerp(back.max[2] - 6, back.min[2] + 6, Math.min(1, Math.max(0, (y - backBottomY) / backH)));
	const halfW = Math.min((seat.max[0] - seat.min[0]) / 2, (back.max[0] - back.min[0]) / 2);

	const slotY = backTopY - 0.22 * backH; // shoulder slots, where the straps come through
	const chestY = seatY + 0.55 * (slotY - seatY);
	const lapY = seatY + 52;
	const sx = Math.min(52, halfW * 0.45); // shoulder strap offset from the centre line
	const chestZ = backZ(chestY) + 105;
	const lapZ = Math.min(backZ(lapY) + 125, seatFrontZ - 25);
	const st = HARNESS.standoff;

	const straps: Strap[] = [];
	const buckles: Buckle[] = [];

	for (const side of [-1, 1]) {
		const x = side * sx;
		straps.push({
			name: 'shoulder',
			width: HARNESS.shoulderW,
			normal: [0, 0.45, 1],
			points: [
				[x, slotY + 6, backZ(slotY + 6) - 12], // behind the back, entering the slot
				[x, slotY, backZ(slotY) + st],
				[x, slotY + 14, backZ(slotY) + 52], // over the shoulder
				[x * 0.85, lerp(slotY, chestY, 0.55), backZ(lerp(slotY, chestY, 0.55)) + 98],
				[x * 0.35, chestY + 8, chestZ + st]
			]
		});
	}
	buckles.push({
		name: 'chest',
		pos: [0, chestY, chestZ + st + HARNESS.chestBuckle[2] / 2],
		size: HARNESS.chestBuckle,
		yaw: 0
	});

	// Lap belt: from the seat sides across the belly.
	const lx = Math.min(halfW - 14, 118);
	straps.push({
		name: 'lap',
		width: HARNESS.lapW,
		normal: [0, 0.25, 1],
		points: [
			[-lx, lapY - 6, lapZ - 70],
			[-lx * 0.62, lapY, lapZ - 22],
			[-lx * 0.2, lapY + 3, lapZ + st],
			[lx * 0.2, lapY + 3, lapZ + st],
			[lx * 0.62, lapY, lapZ - 22],
			[lx, lapY - 6, lapZ - 70]
		]
	});
	buckles.push({
		name: 'lap',
		pos: [0, lapY + 3, lapZ + st + HARNESS.lapBuckle[2] / 2],
		size: HARNESS.lapBuckle,
		yaw: 0
	});

	// Crotch strap: from the lap buckle down between the legs to the seat's front edge.
	const crotchEndZ = Math.min(lapZ + 70, seatFrontZ - 12);
	straps.push({
		name: 'crotch',
		width: HARNESS.crotchW,
		normal: [0, 1, 0.5],
		points: [
			[0, lapY - 8, lapZ + st],
			[0, seatY + 30, lapZ + 16],
			[0, seatY + st + 6, lerp(lapZ, crotchEndZ, 0.55)],
			[0, seatY + st, crotchEndZ],
			[0, seatY - 6, seatFrontZ + 2]
		]
	});

	// Footrest straps: one over each foot, arched, with a small buckle at the outer side.
	if (footrest) {
		const fy = footrest.max[1];
		const fz = footrest.min[2] + 0.55 * (footrest.max[2] - footrest.min[2]);
		const fx0 = 16;
		const fx1 = Math.min(104, (footrest.max[0] - footrest.min[0]) / 2 - 28);
		for (const side of [-1, 1]) {
			straps.push({
				name: 'foot',
				width: HARNESS.footW,
				normal: [0, 1, 0],
				points: [
					[side * (fx0 - 6), fy + st, fz],
					[side * (fx0 + 10), fy + 24, fz],
					[side * ((fx0 + fx1) / 2), fy + 40, fz],
					[side * (fx1 - 10), fy + 24, fz],
					[side * fx1, fy + st, fz]
				]
			});
			buckles.push({
				name: 'foot',
				pos: [side * (fx1 + 6), fy + HARNESS.footBuckle[1] / 2, fz],
				size: [HARNESS.footBuckle[2], HARNESS.footBuckle[1], HARNESS.footBuckle[0]],
				yaw: 0
			});
		}
	}
	return { straps, buckles };
}
