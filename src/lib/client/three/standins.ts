/**
 * three.js builders for the procedural stand-ins (casters, harness straps, buckles). Pure
 * geometry from primitives: no MakeGood geometry. Anchors come from `#lib/domain/standins.ts`.
 */
import type * as T from 'three';
import type { Buckle, CasterAnchor, Strap, Vec3 } from '#lib/domain/standins.ts';

type Three = typeof T;

/** Wheel with a bevelled tread, two fork plates, axle bolt heads, swivel plate and stem. */
export function buildCaster(
	THREE: Three,
	a: CasterAnchor,
	mats: { metal: T.Material; tread: T.Material }
): T.Group {
	const g = new THREE.Group();
	const cy = a.groundY + a.wheelR;
	const cz = a.z - a.trail;
	const add = (geo: T.BufferGeometry, m: T.Material, x: number, y: number, z: number) => {
		const mesh = new THREE.Mesh(geo, m);
		mesh.position.set(x, y, z);
		mesh.raycast = () => {};
		g.add(mesh);
		return mesh;
	};

	// Wheel: a lathe profile (tread with 12% bevel) turned about x.
	const r = a.wheelR;
	const hw = a.wheelW / 2;
	const bev = Math.min(hw * 0.5, r * 0.12);
	const profile = [
		new THREE.Vector2(0, -hw),
		new THREE.Vector2(r * 0.55, -hw),
		new THREE.Vector2(r - bev, -hw),
		new THREE.Vector2(r, -hw + bev),
		new THREE.Vector2(r, hw - bev),
		new THREE.Vector2(r - bev, hw),
		new THREE.Vector2(r * 0.55, hw),
		new THREE.Vector2(0, hw)
	];
	const wheel = new THREE.LatheGeometry(profile, 36);
	wheel.rotateZ(Math.PI / 2); // lathe axis y -> x
	add(wheel, mats.tread, a.x, cy, cz);
	// Hub discs (metal) on both faces.
	const hubR = Math.max(r * 0.38, 6);
	const hub = new THREE.CylinderGeometry(hubR, hubR, a.wheelW + 1.2, 24);
	hub.rotateZ(Math.PI / 2);
	add(hub, mats.metal, a.x, cy, cz);

	// Fork: two plates either side of the wheel from the axle up to the swivel plate.
	const forkT = 3;
	const forkX = hw + 1.2 + forkT / 2;
	const forkTop = a.topY - 3;
	const forkH = forkTop - (cy - r * 0.2);
	for (const s of [-1, 1]) {
		const plate = new THREE.BoxGeometry(forkT, forkH, r * 0.9);
		add(plate, mats.metal, a.x + s * forkX, cy - r * 0.2 + forkH / 2, a.z - a.trail * 0.5);
		// Axle bolt head outside the plate.
		const head = new THREE.CylinderGeometry(r * 0.2, r * 0.2, 3, 6);
		head.rotateZ(Math.PI / 2);
		add(head, mats.metal, a.x + s * (forkX + forkT / 2 + 1.5), cy, cz);
	}
	// Bridge between the plates and the swivel stem.
	const bridgeW = 2 * forkX + forkT;
	add(
		new THREE.BoxGeometry(bridgeW, 3, r * 0.9),
		mats.metal,
		a.x,
		forkTop - 1.5,
		a.z - a.trail * 0.5
	);
	const stem = new THREE.CylinderGeometry(4, 4, 8, 16);
	add(stem, mats.metal, a.x, forkTop + 3, a.z);
	// Swivel plate under the mount.
	const plateR = Math.min(Math.max(r * 0.5, 12), 22);
	add(new THREE.CylinderGeometry(plateR, plateR, 3, 28), mats.metal, a.x, a.topY - 1.5, a.z);
	return g;
}

/**
 * A flat ribbon (webbing) along a Catmull-Rom curve: width across, `thickness` along `normal`.
 * Rectangle cross-section swept along the curve, closed at both ends.
 */
export function buildRibbon(
	THREE: Three,
	s: Strap,
	thickness: number,
	samples = 40
): T.BufferGeometry {
	const curve = new THREE.CatmullRomCurve3(
		s.points.map((p) => new THREE.Vector3(...p)),
		false,
		'centripetal'
	);
	const hint = new THREE.Vector3(...s.normal).normalize();
	const pos: number[] = [];
	const idx: number[] = [];
	const ring = 4;
	const t = new THREE.Vector3();
	const n = new THREE.Vector3();
	const w = new THREE.Vector3();
	const c = new THREE.Vector3();
	for (let i = 0; i <= samples; i++) {
		const u = i / samples;
		curve.getPointAt(u, c);
		curve.getTangentAt(u, t);
		n.copy(hint).addScaledVector(t, -hint.dot(t));
		if (n.lengthSq() < 1e-6) n.set(0, 1, 0).addScaledVector(t, -t.y);
		n.normalize();
		w.crossVectors(t, n).normalize();
		const hw = s.width / 2;
		const ht = thickness / 2;
		for (const [a, b] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1]
		]) {
			pos.push(
				c.x + w.x * hw * a + n.x * ht * b,
				c.y + w.y * hw * a + n.y * ht * b,
				c.z + w.z * hw * a + n.z * ht * b
			);
		}
	}
	for (let i = 0; i < samples; i++) {
		for (let k = 0; k < ring; k++) {
			const a = i * ring + k;
			const b = i * ring + ((k + 1) % ring);
			const a2 = a + ring;
			const b2 = b + ring;
			idx.push(a, b, b2, a, b2, a2);
		}
	}
	// End caps.
	idx.push(0, 2, 1, 0, 3, 2);
	const e = samples * ring;
	idx.push(e, e + 1, e + 2, e, e + 2, e + 3);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setIndex(idx);
	geo.computeVertexNormals();
	return geo;
}

/** Small rounded box (extruded rounded rectangle) with a slot cut-out for the webbing. */
export function buildBuckle(THREE: Three, b: Buckle): T.BufferGeometry {
	const [sx, sy, sz] = b.size;
	// Rounded rectangle in the x-y plane, extruded along z, then centred.
	const r = Math.min(sx, sy) * 0.28;
	const shape = new THREE.Shape();
	const x0 = -sx / 2;
	const y0 = -sy / 2;
	shape.moveTo(x0 + r, y0);
	shape.lineTo(x0 + sx - r, y0);
	shape.quadraticCurveTo(x0 + sx, y0, x0 + sx, y0 + r);
	shape.lineTo(x0 + sx, y0 + sy - r);
	shape.quadraticCurveTo(x0 + sx, y0 + sy, x0 + sx - r, y0 + sy);
	shape.lineTo(x0 + r, y0 + sy);
	shape.quadraticCurveTo(x0, y0 + sy, x0, y0 + sy - r);
	shape.lineTo(x0, y0 + r);
	shape.quadraticCurveTo(x0, y0, x0 + r, y0);
	const bevel = Math.min(sz * 0.25, 2);
	const geo = new THREE.ExtrudeGeometry(shape, {
		depth: Math.max(sz - 2 * bevel, 0.5),
		bevelEnabled: true,
		bevelThickness: bevel,
		bevelSize: bevel * 0.8,
		bevelSegments: 2,
		curveSegments: 6
	});
	geo.translate(0, 0, -(sz - 2 * bevel) / 2);
	geo.rotateY((b.yaw * Math.PI) / 180);
	geo.translate(...(b.pos as Vec3));
	return geo;
}
