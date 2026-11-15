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
