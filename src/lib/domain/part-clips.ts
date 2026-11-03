/**
 * Half-space rules for a part, in its own STEP frame (numbers only), applied by body: see `keepBodiesIndex`.
 * Bodies whose bbox centre satisfies `dot(normal, p) + constant >= 0` are kept.
 *
 * `connectors`: the STEP file mixes bodies already in the assembly frame (J frame pins, the
 * wheel block, the front caster pin and lock; all at y >= 37) with loose bodies laid out near
 * the origin (bearing spacers, washers, wheel pins; y <= 27) that would float under the
 * footrest. One placement matrix cannot serve both, so the loose bodies are left out.
 */
export const PART_CLIPS: Record<string, { normal: [number, number, number]; constant: number }> = {
	connectors: { normal: [0, 1, 0], constant: -30 }
};

/**
 * Triangle index that keeps only the connected bodies on the kept side of a clip. A body is kept
 * when the centre of its bounding box (positions taken through the column-major 4x4 `matrix`,
 * i.e. in the clip's frame) satisfies `dot(normal, p) + constant >= 0`. Whole bodies are dropped
 * rather than sliced, so no cut face or sliver is ever drawn. Vertices are welded by position
 * (STEP export duplicates them per face). Returns null when every body is kept.
 */
export function keepBodiesIndex(
	positions: ArrayLike<number>,
	index: ArrayLike<number> | null,
	matrix: ArrayLike<number>,
	clip: { normal: [number, number, number]; constant: number }
): Uint32Array | null {
	const n = Math.floor(positions.length / 3);
	const tris = index ? Math.floor(index.length / 3) : Math.floor(n / 3);
	const vert = (t: number, k: number) => (index ? index[3 * t + k] : 3 * t + k);
	const m = matrix;
	const world = (i: number): [number, number, number] => {
		const x = positions[3 * i];
		const y = positions[3 * i + 1];
		const z = positions[3 * i + 2];
		return [
			m[0] * x + m[4] * y + m[8] * z + m[12],
			m[1] * x + m[5] * y + m[9] * z + m[13],
			m[2] * x + m[6] * y + m[10] * z + m[14]
		];
	};
	// Union-find over welded vertices.
	const parent = new Int32Array(n).map((_, i) => i);
	const find = (a: number) => {
		while (parent[a] !== a) {
			parent[a] = parent[parent[a]];
			a = parent[a];
		}
		return a;
	};
	const weld = new Map<string, number>();
	const rep = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		const key = `${positions[3 * i].toFixed(4)},${positions[3 * i + 1].toFixed(4)},${positions[3 * i + 2].toFixed(4)}`;
		const first = weld.get(key);
		if (first === undefined) weld.set(key, i);
		rep[i] = first ?? i;
	}
	for (let t = 0; t < tris; t++) {
		const a = find(rep[vert(t, 0)]);
		for (const k of [1, 2]) {
			const b = find(rep[vert(t, k)]);
			if (b !== a) parent[b] = a;
		}
	}
	const lo = new Map<number, number[]>();
	const hi = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const root = find(rep[i]);
		const p = world(i);
		const l = lo.get(root) ?? [Infinity, Infinity, Infinity];
		const h = hi.get(root) ?? [-Infinity, -Infinity, -Infinity];
		for (let k = 0; k < 3; k++) {
			l[k] = Math.min(l[k], p[k]);
			h[k] = Math.max(h[k], p[k]);
		}
		lo.set(root, l);
		hi.set(root, h);
	}
	const keep = new Map<number, boolean>();
	for (const [root, l] of lo) {
		const h = hi.get(root)!;
		const d =
			clip.normal[0] * (l[0] + h[0]) * 0.5 +
			clip.normal[1] * (l[1] + h[1]) * 0.5 +
			clip.normal[2] * (l[2] + h[2]) * 0.5 +
			clip.constant;
		keep.set(root, d >= 0);
	}
	if ([...keep.values()].every(Boolean)) return null;
	const out: number[] = [];
	for (let t = 0; t < tris; t++) {
		if (!keep.get(find(rep[vert(t, 0)]))) continue;
		out.push(vert(t, 0), vert(t, 1), vert(t, 2));
	}
	return Uint32Array.from(out);
}
