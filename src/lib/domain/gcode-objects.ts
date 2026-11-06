/**
 * Incremental scanner that measures what each printed object costs in one plate's G-code:
 * extruded filament (mm per filament, from the active tool and the E axis) and print time.
 *
 * Works on raw bytes, one chunk at a time, so a plate's G-code (tens of MB, millions of lines)
 * is never held in memory. Only motion lines (`G0/G1/G2/G3`), `G92`, tool changes (`Tn`),
 * `M82/M83`, `M73` progress lines and object markers are looked at.
 *
 * Object markers understood:
 * - Klipper style, written by Elegoo/Orca: `EXCLUDE_OBJECT_START NAME=<name>` ... `EXCLUDE_OBJECT_END`
 * - Orca/Prusa comments: `; printing object <name> id:N copy M` ... `; stop printing object <name> ...`
 *
 * Time is measured in two steps: each move gets a nominal duration (length / feed rate, no
 * acceleration), then `M73 ... R<minutes left>` lines, which carry the slicer's own time model at one
 * minute resolution, rescale the moves between two of them so that they add up to the time the slicer
 * says passed. Time not inside any object (prime tower, purging, filament changes) goes to the `''` owner.
 *
 * Pure: no Node imports.
 */

export interface ObjectCost {
	/** Seconds spent inside the object's markers (slicer time scale). */
	seconds: number;
	/** Extruded filament in mm by tool index (0-based, as in the G-code), net of retractions. */
	mmByTool: Record<string, number>;
}

export interface GcodeObjectResult {
	/** By object name exactly as written in the G-code (`..._id_0_copy_0`); `''` is everything outside objects. */
	objects: Map<string, ObjectCost>;
	/** Whether any object marker was seen. */
	hasMarkers: boolean;
	/** Total seconds attributed (all owners). */
	totalSeconds: number;
	/** `; filament used [mm]` and `[g]` from the footer, by tool index. */
	footerMm: number[];
	footerGrams: number[];
	lines: number;
}

const NL = 10;
const SP = 32;

function isDigit(c: number) {
	return c >= 48 && c <= 57;
}

export class GcodeObjectScanner {
	private carry: Uint8Array | null = null;
	private owner = '';
	private tool = 0;
	private relative = true;
	private x = 0;
	private y = 0;
	private z = 0;
	private e = 0;
	private f = 3000;
	private lastR = -1;
	private acc = new Map<string, number>();
	private accSum = 0;
	private scale = 1;
	private res: GcodeObjectResult = {
		objects: new Map(),
		hasMarkers: false,
		totalSeconds: 0,
		footerMm: [],
		footerGrams: [],
		lines: 0
	};
	private dec = new TextDecoder();

	private cost(name: string): ObjectCost {
		let c = this.res.objects.get(name);
		if (!c) this.res.objects.set(name, (c = { seconds: 0, mmByTool: {} }));
		return c;
	}

	/** Feed the next chunk of the inflated G-code. */
	push(chunk: Uint8Array): void {
		let start = 0;
		if (this.carry) {
			const nl = chunk.indexOf(NL);
			if (nl < 0) {
				// a very long line (thumbnails, polygons): keep a bounded amount of it
				if (this.carry.length + chunk.length < 1 << 20) {
					const j = new Uint8Array(this.carry.length + chunk.length);
					j.set(this.carry);
					j.set(chunk, this.carry.length);
					this.carry = j;
				}
				return;
			}
			const j = new Uint8Array(this.carry.length + nl);
			j.set(this.carry);
			j.set(chunk.subarray(0, nl), this.carry.length);
			this.line(j, 0, j.length);
			this.carry = null;
			start = nl + 1;
		}
		const n = chunk.length;
		while (start < n) {
			const nl = chunk.indexOf(NL, start);
			if (nl < 0) {
				this.carry = chunk.slice(start);
				return;
			}
			this.line(chunk, start, nl);
			start = nl + 1;
		}
	}

	/** Call after the last chunk. */
	finish(): GcodeObjectResult {
		if (this.carry && this.carry.length) this.line(this.carry, 0, this.carry.length);
		this.carry = null;
		this.flush(0);
		let total = 0;
		for (const c of this.res.objects.values()) total += c.seconds;
		this.res.totalSeconds = total;
		return this.res;
	}

	// ---- lines

	private line(b: Uint8Array, s: number, e: number): void {
		if (e > s && b[e - 1] === 13) e--; // CR
		if (e <= s) return;
		this.res.lines++;
		const c = b[s];
		if (c === 71) {
			// G
			const d = b[s + 1];
			const g2 = b[s + 2];
			if (d === 49 || d === 48) {
				if (g2 === SP) this.move(b, s + 3, e, 0);
				return;
			}
			if (d === 50 || d === 51) {
				if (g2 === SP) this.move(b, s + 3, e, d === 50 ? 2 : 3);
				return;
			}
			if (d === 57 && g2 === 50 && b[s + 3] === SP) this.g92(b, s + 4, e);
			return;
		}
		if (c === 84) {
			// T<n>
			let i = s + 1;
			let v = 0;
			while (i < e && isDigit(b[i])) v = v * 10 + b[i++] - 48;
			if (i > s + 1 && (i === e || b[i] === SP || b[i] === 59)) this.tool = v;
			return;
		}
		if (c === 77) {
			// M
			if (b[s + 1] === 56 && b[s + 2] === 51) this.relative = true;
			else if (b[s + 1] === 56 && b[s + 2] === 50) this.relative = false;
			else if (b[s + 1] === 55 && b[s + 2] === 51 && b[s + 3] === SP) this.m73(b, s + 4, e);
			return;
		}
		if (c === 69) {
			// EXCLUDE_OBJECT_START / _END
			if (e - s > 18 && b[s + 1] === 88 && (b[s + 15] === 83 || b[s + 15] === 69)) {
				const t = this.dec.decode(b.subarray(s, Math.min(e, s + 400)));
				if (t.startsWith('EXCLUDE_OBJECT_START')) {
					const m = /NAME=(\S+)/.exec(t);
					if (m) {
						this.res.hasMarkers = true;
						this.setOwner(m[1]);
					}
				} else if (t.startsWith('EXCLUDE_OBJECT_END')) this.setOwner('');
			}
			return;
		}
		if (c === 59) {
			// ; comments of interest: "; printing object", "; stop printing object", "; filament used"
			const c1 = b[s + 2];
			if (c1 === 112 && b[s + 3] === 114) {
				const t = this.dec.decode(b.subarray(s, Math.min(e, s + 400)));
				const m = /^; printing object (.+?) id:\d+ copy \d+/.exec(t);
				if (m) {
					this.res.hasMarkers = true;
					this.setOwner(m[1]);
				}
			} else if (c1 === 115 && b[s + 3] === 116) {
				if (
					this.dec.decode(b.subarray(s, Math.min(e, s + 40))).startsWith('; stop printing object')
				)
					this.setOwner('');
			} else if (c1 === 102 && b[s + 3] === 105 && e - s < 2000) {
				const t = this.dec.decode(b.subarray(s, e));
				const m = /^; filament used \[(mm|g)\] = (.*)$/.exec(t);
				if (m) {
					const list = m[2].split(',').map((x) => Number(x.trim()) || 0);
					if (m[1] === 'mm') this.res.footerMm = list;
					else this.res.footerGrams = list;
				}
			}
		}
	}

	private setOwner(name: string) {
		if (name === this.owner) return;
		this.owner = name;
	}

	private g92(b: Uint8Array, i: number, e: number) {
		while (i < e) {
			const c = b[i];
			if (c === 69) this.e = this.num(b, i + 1, e)[0];
			else if (c === 59) return;
			i++;
		}
	}

	/** Parses a number at i; returns [value, next index]. Absent digits give NaN. */
	private num(b: Uint8Array, i: number, e: number): [number, number] {
		let neg = false;
		if (b[i] === 45) {
			neg = true;
			i++;
		} else if (b[i] === 43) i++;
		let v = 0;
		let any = false;
		while (i < e && isDigit(b[i])) {
			v = v * 10 + b[i++] - 48;
			any = true;
		}
		if (i < e && b[i] === 46) {
			i++;
			let p = 0.1;
			while (i < e && isDigit(b[i])) {
				v += (b[i++] - 48) * p;
				p /= 10;
				any = true;
			}
		}
		return [any ? (neg ? -v : v) : NaN, i];
	}

	private move(b: Uint8Array, i: number, e: number, arc: 0 | 2 | 3) {
		let nx = this.x;
		let ny = this.y;
		let nz = this.z;
		let ne = NaN;
		let ai = 0;
		let aj = 0;
		let hasXY = false;
		while (i < e) {
			const c = b[i];
			if (c === 59) break;
			if (c === SP) {
				i++;
				continue;
			}
			const [v, nxt] = this.num(b, i + 1, e);
			if (c === 88) {
				if (v === v) {
					nx = v;
					hasXY = true;
				}
			} else if (c === 89) {
				if (v === v) {
					ny = v;
					hasXY = true;
				}
			} else if (c === 90) {
				if (v === v) nz = v;
			} else if (c === 69) ne = v;
			else if (c === 70) {
				if (v > 0) this.f = v;
			} else if (c === 73) ai = v === v ? v : 0;
			else if (c === 74) aj = v === v ? v : 0;
			i = nxt > i ? nxt : i + 1;
		}
		const dx = nx - this.x;
		const dy = ny - this.y;
		const dz = nz - this.z;
		let len: number;
		if (arc && (ai !== 0 || aj !== 0)) {
			const cx = this.x + ai;
			const cy = this.y + aj;
			const r = Math.hypot(ai, aj);
			const a0 = Math.atan2(this.y - cy, this.x - cx);
			const a1 = Math.atan2(ny - cy, nx - cx);
			let d = arc === 2 ? a0 - a1 : a1 - a0;
			while (d <= 0) d += 2 * Math.PI;
			if (!hasXY || Math.hypot(dx, dy) < 1e-6) d = 2 * Math.PI;
			len = Math.hypot(r * d, dz);
		} else len = Math.hypot(dx, dy, dz);
		this.x = nx;
		this.y = ny;
		this.z = nz;
		// extruded amount (net of retraction)
		let ext = 0;
		if (ne === ne) {
			if (this.relative) ext = ne;
			else {
				ext = ne - this.e;
				this.e = ne;
			}
		}
		if (len > 0) {
			const sec = len / (this.f / 60);
			this.acc.set(this.owner, (this.acc.get(this.owner) ?? 0) + sec);
			this.accSum += sec;
		}
		if (ext > 0 && (hasXY || arc)) {
			const c = this.cost(this.owner);
			const k = String(this.tool);
			c.mmByTool[k] = (c.mmByTool[k] ?? 0) + ext;
		}
	}

	private m73(b: Uint8Array, i: number, e: number) {
		let r = NaN;
		while (i < e) {
			const c = b[i];
			if (c === 59) break;
			if (c === 82) {
				r = this.num(b, i + 1, e)[0];
				break;
			}
			i++;
		}
		if (r !== r) return;
		if (this.lastR < 0) {
			this.lastR = r;
			return;
		}
		const elapsed = (this.lastR - r) * 60;
		if (elapsed <= 0) return; // not moved yet: keep collecting
		this.lastR = r;
		this.flush(elapsed);
	}

	/** Gives the moves collected since the last M73 the time the slicer says passed (0: nominal times). */
	private flush(elapsed: number) {
		if (this.accSum > 0) {
			const k = elapsed > 0 ? elapsed / this.accSum : this.scale;
			if (elapsed > 0) this.scale = k;
			for (const [name, sec] of this.acc) this.cost(name).seconds += sec * k;
		}
		this.acc.clear();
		this.accSum = 0;
	}
}

/** Convenience for tests and small inputs. */
export function scanGcode(text: string): GcodeObjectResult {
	const s = new GcodeObjectScanner();
	s.push(new TextEncoder().encode(text));
	return s.finish();
}
