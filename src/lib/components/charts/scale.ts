/** Small, dependency-free scale helpers shared by the chart components. Pure; safe on the server. */

/** Round `v` up to a "nice" number (1, 2, 2.5, 5 times a power of ten). */
export function niceCeil(v: number): number {
	if (!Number.isFinite(v) || v <= 0) return 1;
	const exp = Math.floor(Math.log10(v));
	const base = 10 ** exp;
	const f = v / base;
	const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
	return round(nice * base);
}

/**
 * Tick values from 0 to a nice maximum that covers `max`, at most about `count` intervals.
 * `max` <= 0 (no data) gives 0..1 so an empty chart still has an axis.
 */
export function niceTicks(max: number, count = 4): { ticks: number[]; max: number } {
	const m = Number.isFinite(max) && max > 0 ? max : 1;
	const step = niceCeil(m / count);
	const n = Math.max(1, Math.ceil(m / step - 1e-9));
	const ticks: number[] = [];
	for (let i = 0; i <= n; i++) ticks.push(round(i * step));
	return { ticks, max: ticks[ticks.length - 1] };
}

/** Linear map from a domain to a range (the range may run backwards, as for a y axis). */
export function linearScale(
	domain: [number, number],
	range: [number, number]
): (v: number) => number {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0;
	if (span === 0) return () => r0;
	return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Round away binary noise (0.1 + 0.2) without changing real values. */
export function round(v: number, digits = 6): number {
	const f = 10 ** digits;
	return Math.round(v * f) / f;
}

/** A number for a label: at most `digits` decimals, no trailing zeros, grouped thousands. */
export function formatValue(v: number, digits = 1): string {
	if (!Number.isFinite(v)) return '0';
	return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Unit suffix for a value: `%` hugs the number ("50%"), other units keep a space ("12 h"). */
export function unitSuffix(unit: string | undefined): string {
	if (!unit) return '';
	return unit === '%' ? '%' : ` ${unit}`;
}

/** Text anchor that keeps a label of about `labelPx` centred on `x` inside 0..width. */
export function edgeAnchor(x: number, labelPx: number, width: number): 'start' | 'middle' | 'end' {
	if (x + labelPx / 2 > width) return 'end';
	if (x - labelPx / 2 < 0) return 'start';
	return 'middle';
}

/** Horizontal extent [left, right] of a label of `labelPx` at `x`, as `edgeAnchor` places it. */
export function labelExtent(x: number, labelPx: number, width: number): [number, number] {
	const a = edgeAnchor(x, labelPx, width);
	if (a === 'end') return [x - labelPx, x];
	if (a === 'start') return [x, x + labelPx];
	return [x - labelPx / 2, x + labelPx / 2];
}

/**
 * Which labels to draw so none overlaps its neighbour (`gap` px apart at least). The first and the
 * last are always kept (when they would collide with each other the last wins); the labels between
 * are taken from the end backwards, each one only if it clears every label already kept.
 * `xs[i]` is the centre of label i, `widths[i]` its width, `width` the chart width.
 */
export function visibleLabels(xs: number[], widths: number[], width: number, gap = 6): boolean[] {
	const n = xs.length;
	const show = new Array<boolean>(n).fill(false);
	if (n === 0) return show;
	const ext = xs.map((x, i) => labelExtent(x, widths[i] ?? 0, width));
	const kept: number[] = [n - 1];
	const clear = (i: number) =>
		kept.every((k) => ext[i][1] + gap <= ext[k][0] || ext[k][1] + gap <= ext[i][0]);
	if (n > 1 && clear(0)) kept.push(0);
	for (let i = n - 2; i >= 1; i--) if (clear(i)) kept.push(i);
	for (const k of kept) show[k] = true;
	return show;
}

/** Keep every `step`-th label so labels of about `labelPx` fit in slots of `slotPx`. */
export function labelStep(slotPx: number, labelPx: number): number {
	if (slotPx <= 0) return 1;
	return Math.max(1, Math.ceil(labelPx / slotPx));
}

/** Shorten `s` to at most `max` characters with an ellipsis. */
export function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Move a roving index for the arrow keys, Home and End; null when the key is not one of those. */
export function rovingIndex(key: string, i: number, count: number): number | null {
	if (count <= 0) return null;
	switch (key) {
		case 'ArrowRight':
		case 'ArrowDown':
			return Math.min(count - 1, i + 1);
		case 'ArrowLeft':
		case 'ArrowUp':
			return Math.max(0, i - 1);
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
