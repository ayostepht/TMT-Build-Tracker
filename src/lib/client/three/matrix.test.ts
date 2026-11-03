import { describe, expect, it } from 'vitest';
import {
	compose,
	decompose,
	isMirrored,
	multiply,
	ringInstances,
	setMirrorX,
	translation
} from './matrix';
import { fitDistance, fitDistanceBox } from './fit';

const close = (a: number[], b: number[], eps = 1e-6) =>
	a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));

describe('matrix helpers', () => {
	it('round-trips translation, rotation and mirroring', () => {
		for (const t of [
			{ pos: [10, -20, 30], rot: [10, 20, 30], scale: [1, 1, 1] },
			{ pos: [0, 145, -300], rot: [-90, 0, 45], scale: [-1, 1, 1] },
			{ pos: [1, 2, 3], rot: [170, -80, 5], scale: [1, 1, 1] }
		] as const) {
			const m = compose({ pos: [...t.pos], rot: [...t.rot], scale: [...t.scale] });
			close(compose(decompose(m)), m);
			expect(isMirrored(m)).toBe(t.scale[0] < 0);
		}
	});
	it('matches three.js Euler XYZ for a 90 degree turn about X', () => {
		// y -> z, z -> -y
		const m = compose({ pos: [0, 0, 0], rot: [90, 0, 0], scale: [1, 1, 1] });
		close(m, [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
	});
	it('toggles the mirror without moving the part', () => {
		const m = compose({ pos: [5, 6, 7], rot: [0, 30, 0], scale: [1, 1, 1] });
		const mir = setMirrorX(m, true);
		expect(isMirrored(mir)).toBe(true);
		close(mir.slice(12, 15), [5, 6, 7]);
		close(setMirrorX(mir, false), m);
	});
	it('spaces ring instances around an axis through a centre', () => {
		const base = translation(208.3, 145, -300 + 100); // 100 mm above the axle centre in z
		const ring = ringInstances(base, 4, [208.3, 145, -300], 'x');
		expect(ring).toHaveLength(3);
		// quarter turn about x moves z+100 to y-100 (rotation by +90 maps z to -y)
		close(ring[0].slice(12, 15), [208.3, 45, -300], 1e-6);
		close(multiply(translation(1, 0, 0), translation(2, 0, 0)).slice(12, 15), [3, 0, 0]);
	});
});

describe('fitDistance', () => {
	it('is farther for portrait canvases', () => {
		expect(fitDistance(500, 32, 390 / 700)).toBeGreaterThan(fitDistance(500, 32, 1280 / 720));
	});
});

describe('fitDistanceBox', () => {
	const box: [number, number, number][] = [];
	for (const x of [-100, 100])
		for (const y of [-300, 300]) for (const z of [-100, 100]) box.push([x, y, z]);
	it('keeps every corner inside the frustum and is tighter than the sphere fit', () => {
		const dir: [number, number, number] = [0, 0, 1];
		const d = fitDistanceBox(box, dir, 32, 0.5, 1);
		// vertical extent 300 at depth d-100 must fit: 300 / tan(16deg) = 1046 -> d = 1146
		expect(d).toBeCloseTo(300 / Math.tan((16 * Math.PI) / 180) + 100, 0);
		expect(d).toBeLessThan(fitDistance(Math.hypot(100, 300, 100), 32, 0.5));
	});
});
