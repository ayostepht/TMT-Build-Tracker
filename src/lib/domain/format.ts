/** Number, duration and date helpers shared by the UI and the domain logic. */

/** Whole number with thousands separators (en-US so server and client agree). */
export function fmt(n: number): string {
	return Math.round(n).toLocaleString('en-US');
}

/** Spool count without trailing zeros: 4.5, 3, 0.25 (at most 2 decimals). */
export function fmtSpools(n: number): string {
	return String(Math.round(n * 100) / 100);
}

/** Hours from seconds: "12 h" at 10 h and over, "4.5 h" below. */
export function fmtH(seconds: number): string {
	const h = seconds / 3600;
	return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`;
}

/** Elapsed/remaining time from milliseconds: "3h 05m" or "42m". Negative clamps to 0. */
export function fmtDur(ms: number): string {
	const m = Math.max(0, Math.round(ms / 60000));
	const h = Math.floor(m / 60);
	return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** Seconds as "13h 04m". */
export function fmtHM(seconds: number): string {
	const m = Math.round(seconds / 60);
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Parse a duration typed by a person into seconds. Accepts "12:30" (h:mm),
 * "12:30:15", "1.5" (hours), and unit forms like "2h 15m", "1d 2h", "45m".
 * Returns null when empty or unparseable.
 */
export function parseDur(s: string): number | null {
	s = String(s ?? '')
		.trim()
		.toLowerCase();
	if (!s) return null;
	let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
	if (m) return +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0);
	if (/^\d*\.?\d+$/.test(s)) return Math.round(parseFloat(s) * 3600);
	const unit: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
	let sec = 0;
	let any = false;
	for (m of s.matchAll(/(\d*\.?\d+)\s*(d|h|m|s)/g) as Iterable<RegExpMatchArray>) {
		any = true;
		sec += parseFloat(m[1]) * unit[m[2]];
	}
	return any ? Math.round(sec) : null;
}

const z = (n: number) => String(n).padStart(2, '0');

/** Value for an `<input type="datetime-local">` in the Date's local time. */
export function toLocalInput(d: Date): string {
	return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** Local calendar date as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
	return `${now.getFullYear()}-${z(now.getMonth() + 1)}-${z(now.getDate())}`;
}

/**
 * Parse a slicer time typed by a person into whole seconds: "14h20m", "14h 20" (a bare number after
 * hours is minutes), "14:20", "14.3" (hours), "90m". Returns null when empty, unparseable or zero.
 */
export function parseSlicerTime(s: string): number | null {
	const t = String(s ?? '')
		.trim()
		.toLowerCase();
	const hm = t.match(/^(\d+)\s*h(?:ours?|rs?)?[\s,]*(\d{1,2})$/);
	const sec = hm ? +hm[1] * 3600 + +hm[2] * 60 : parseDur(t);
	return sec && sec > 0 ? Math.round(sec) : null;
}
