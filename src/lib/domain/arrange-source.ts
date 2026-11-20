/**
 * Source-first plate planning: the kit's own plate layout (or the layout of the file the maker
 * uploaded) comes first, the arranger is the exception. Pure and deterministic, no DB or Node.
 *
 * Rules (maintainer, 2026-11-20):
 *  A. A source plate stays exactly as it is (same parts, same positions) while its parts still print
 *     together: they share one filament, or they were already printed in different filaments in the
 *     kit's own colors (a multi-color plate) and still are, and the printer's slots and materials allow
 *     it. It is not re-packed, merged with another plate or given a brim margin ("trusted as authored").
 *  B. Only what must move moves. A part leaves its source plate when its filament no longer matches
 *     the rest (a design that gives two parts of one kit color different colors), or when the plate
 *     cannot be used on the chosen bed. The largest same-filament group stays in place. A part that left
 *     for its filament first tries to JOIN an existing plate (rule F); the movers that do not join, and
 *     parts the source does not know (e.g. a variant), go to NEW plates, packed together by the arranger
 *     with their brims counted.
 *  C. A plate with exactly one part in the source is sacred: it keeps the relaxed safe area, never
 *     receives another part and keeps its place.
 *  F. (planner 3) A moved part may join a plate that was already a multi-part plate in the source, when the
 *     plate prints in the part's own filament only, prints as often as the part needs, and stays at or
 *     under `JOIN_MAX_UTILISATION` of the usable bed. The plate's parts keep their places; the newcomer
 *     is fitted into the free space with the printer's normal gap (brims counted on both sides, bed
 *     margin and keep-outs kept). Most room left first, then the lowest plate number.
 *  G. (planner 3) A plate that is printed in runs of its own is ONE plate with the footprint of ONE print
 *     (see `isRunPlate`): the wheel rims, one object printed in two colors. Never split for "not fitting
 *     together": its parts are never on the bed at the same time.
 *
 * Plates keep the source's numbers (so they match the kit's guide); new plates continue after the last.
 * Flat rotations about Z only (see `arrange.ts`): nothing here can tilt or stand a part up.
 */
import { boxOrients, fitOutline, inflateOutline, type Pt } from './geom2d.ts';
import { nestOutlines, type OptItem } from './plate-optimize.ts';
import { sameGeometry } from './print-footprint.ts';
import {
	arrange,
	defaultCompatible,
	type ArrangeInput,
	type ArrangedItem,
	type ArrangedPlate,
	type ArrangePart,
	type ArrangeResult,
	type ArrangeRole,
	type ArrangeWarning
} from './arrange.ts';

/** One plate of the source layout: what is on it. `items` are the source's own positions, when it has them. */
export interface SourcePlate {
	number: number;
	name: string;
	runs?: number;
	/** Each part of the plate is printed in runs of its own (`runs` each), never together on one bed. */
	perPartRuns?: boolean;
	/** Part slugs on the plate. */
	parts: string[];
	items?: ArrangedItem[];
}

/** Which rules a plan follows: an arrangement is checked for staleness by the planner that made it. */
export interface PlannerRules {
	/** G: a plate printed in runs of its own is one plate with the footprint of one print. */
	perRun: boolean;
	/** F: a part that left its plate for its filament may join an existing multi-part plate. */
	join: boolean;
}
/** Planner 2 (the kit layout comes first): no run plates, no joining. */
export const RULES_V2: PlannerRules = { perRun: false, join: false };
/** Planner 3: run plates stay one plate, moved parts may join. */
export const RULES_V3: PlannerRules = { perRun: true, join: true };

/**
 * Crowding limit for a part that joins a plate: the plate's used share of its usable bed (the sum of
 * its items' boxes with brims over the bed inside the edge margin, `ArrangedPlate.utilisation` unrounded)
 * may not pass this after the join. The kit author's own multi-part plates (xpa layout, 256 x 256 bed,
 * boxes with brims) measure 22, 47, 49, 60, 68 and 94 % (median 54.5 %, see `arrange.README.md`): joining
 * stops a little above the typical multi-part plate, not at the fullest one. 60 % is also where `arrange()`
 * stops calling a plate underfilled (`mergeBelow`). The normal gap between parts (`printer.spacing`) is kept
 * as well: a join never steps down to the 2 mm gap of the kit's own plates.
 */
export const JOIN_MAX_UTILISATION = 0.6;

export type MoveReason = 'filament' | 'bed' | 'new';
export interface SourceMove {
	slug: string;
	/** Source plate number the part came from (null: the source layout does not have it). */
	from: number | null;
	/** Plate number it is on now. */
	to: number;
	reason: MoveReason;
	/** True when the part joined a plate that already existed in the layout (rule F) instead of a new plate. */
	joined?: boolean;
}

export interface SourceArrangeResult extends ArrangeResult {
	/** Numbers of the plates that are exactly the source plate (same parts). */
	kept: number[];
	moves: SourceMove[];
}

/** Gaps (mm) a kit plate may step down to when its parts do not share one plate at the printer's gap. */
const KIT_GAPS = [6, 5, 4, 3, 2];
const MIN_KIT_GAP = 2;
/** Most items on a plate for which the arranger also searches orders and turns. */
const THOROUGH_ITEMS = 6;

/**
 * A source plate that is printed in runs of its own (rule G): it lists 2+ parts that share ONE geometry
 * (the same object repeated) and either says so (`perPartRuns`) or is printed several times. One print
 * of it holds one of the parts; the parts follow each other in successive runs. A plate of the same
 * parts printed once (`runs` 1, not flagged) is a plate whose parts share the bed.
 */
export function isRunPlate(
	pl: Pick<SourcePlate, 'perPartRuns' | 'runs'>,
	parts: readonly ArrangePart[]
): boolean {
	if (parts.length < 2) return false;
	if (!pl.perPartRuns && !((pl.runs ?? 1) > 1)) return false;
	return parts.every((p) => sameGeometry(p.footprint, parts[0].footprint));
}

/** Slugs that are alone on their plate in the source layout (rule C). */
export function soloParts(source: readonly SourcePlate[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const pl of source) {
		const parts = [...new Set(pl.parts)].filter((s) => !seen.has(s));
		parts.forEach((s) => seen.add(s));
		if (new Set(pl.parts).size === 1 && parts.length === 1) out.push(parts[0]);
	}
	return out;
}

/** Units of a part in one plate run, and how many runs it needs: as `arrange()` counts them. */
const unitsPerRunOf = (p: ArrangePart) =>
	Math.min(Math.max(1, p.units), Math.max(1, p.footprint.unitsPerPlate ?? p.units));
const runsOfPart = (p: ArrangePart) =>
	Math.max(1, Math.ceil(Math.max(1, p.units) / Math.max(1, p.footprint.unitsPerPlate ?? p.units)));
const rectOutline = (w: number, d: number): Pt[] => [
	[-w / 2, -d / 2],
	[w / 2, -d / 2],
	[w / 2, d / 2],
	[-w / 2, d / 2]
];

const area = (p: ArrangePart) =>
	p.footprint.pieces.reduce((a, pc) => a + pc.w * pc.d * Math.max(1, pc.copies), 0);

/** Items of the source layout are usable as they are when they sit on the bed outside the keep-outs. */
function sourceItemsUsable(
	items: readonly ArrangedItem[],
	want: ArrangedPlate,
	input: ArrangeInput
): boolean {
	const key = (i: { slug: string; piece: number; copy: number }) =>
		`${i.slug}|${i.piece}|${i.copy}`;
	if (items.length !== want.items.length) return false;
	const have = new Set(items.map(key));
	if (have.size !== items.length || want.items.some((i) => !have.has(key(i)))) return false;
	const { bedX, bedY, keepOut } = input.printer;
	const E = 0.05;
	for (const i of items) {
		const x0 = i.x - i.w / 2;
		const x1 = i.x + i.w / 2;
		const y0 = i.y - i.d / 2;
		const y1 = i.y + i.d / 2;
		if (x0 < -E || y0 < -E || x1 > bedX + E || y1 > bedY + E) return false;
		for (const z of keepOut ?? [])
			if (x1 > z.x + E && x0 < z.x + z.w - E && y1 > z.y + E && y0 < z.y + z.d - E) return false;
	}
	for (let a = 0; a < items.length; a++)
		for (let b = a + 1; b < items.length; b++) {
			const p = items[a];
			const q = items[b];
			if (p.group !== undefined && p.group === q.group) continue;
			// turned or nested outlines may share box area: only axis-aligned boxes are compared
			if (p.rotation % 90 !== 0 || q.rotation % 90 !== 0 || p.rotation >= 180 || q.rotation >= 180)
				continue;
			if (Math.abs(p.x - q.x) < (p.w + q.w) / 2 - E && Math.abs(p.y - q.y) < (p.d + q.d) / 2 - E)
				return false;
		}
	return true;
}

/**
 * Plan the plates of a build from a source layout. `input.parts` are the build's active parts with
 * their current roles (`ArrangePart.role`) and the kit's own (`baseRole`).
 */
export function arrangeFromSource(
	input: ArrangeInput,
	source: readonly SourcePlate[],
	rules: PlannerRules = RULES_V3
): SourceArrangeResult {
	const { printer } = input;
	const warnings: ArrangeWarning[] = [];
	const partOf = new Map(input.parts.map((p) => [p.slug, p]));
	const roleOf = new Map(input.roles.map((r) => [r.key, r]));
	const getRole = (key: string): ArrangeRole =>
		roleOf.get(key) ?? { key, name: key, material: 'PETG' };
	const compat = input.options?.compatible ?? defaultCompatible;
	const slots = Math.max(1, Math.floor(printer.mmSlots || 1));
	const solo = new Set(soloParts(source));

	// every part belongs to the first source plate that lists it
	const homeOf = new Map<string, number>();
	source.forEach((pl, i) => {
		for (const s of pl.parts) if (partOf.has(s) && !homeOf.has(s)) homeOf.set(s, i);
	});

	const canShare = (keys: Iterable<string>): boolean => {
		const list = [...new Set(keys)].map(getRole);
		if (list.length > slots) return false;
		for (let i = 0; i < list.length; i++)
			for (let j = i + 1; j < list.length; j++) if (!compat(list[i], list[j])) return false;
		return true;
	};
	/** Two parts of one source plate in different colors now that the kit printed in one color. */
	const clash = (a: string, b: string): boolean => {
		const p = partOf.get(a)!;
		const q = partOf.get(b)!;
		if (p.role === q.role) return false;
		return p.baseRole === undefined || q.baseRole === undefined || p.baseRole === q.baseRole;
	};

	/** Which members of a source plate stay together and which must leave. */
	function split(members: string[]): { stay: string[]; leave: string[] } {
		const groups = new Map<string, string[]>();
		for (const s of members) {
			const r = partOf.get(s)!.role;
			groups.set(r, [...(groups.get(r) ?? []), s]);
		}
		const ordered = [...groups.values()]
			.map((g, k) => ({
				g,
				k,
				n: g.length,
				a: g.reduce((t, s) => t + area(partOf.get(s)!), 0)
			}))
			.sort((x, y) => y.n - x.n || y.a - x.a || x.k - y.k);
		const stay: string[] = [];
		const stayRoles = new Set<string>();
		const leave: string[] = [];
		for (const { g } of ordered) {
			const role = partOf.get(g[0])!.role;
			const ok =
				!stay.length ||
				(!g.some((s) => stay.some((t) => clash(s, t))) && canShare([...stayRoles, role]));
			if (ok) {
				stay.push(...g);
				stayRoles.add(role);
			} else leave.push(...g);
		}
		const rank = new Map(members.map((s, i) => [s, i]));
		stay.sort((a, b) => rank.get(a)! - rank.get(b)!);
		leave.sort((a, b) => rank.get(a)! - rank.get(b)!);
		return { stay, leave };
	}

	/**
	 * Put the parts of one source plate on one plate. The kit author's plates are tighter than the
	 * arranger's default gap, and the pack stores no positions, so the gap steps down (never below
	 * `MIN_KIT_GAP`) until all parts share one plate; keep-outs and the edge margin are never relaxed.
	 * Parts that fit at no gap are placed at the printer's own gap, the overflow goes to extra plates.
	 */
	function placeOnePlate(parts: ArrangePart[], soloParts: string[]): ArrangeResult {
		const itemCount = parts.reduce(
			(n, p) =>
				n +
				p.footprint.pieces.reduce((a, pc) => a + Math.max(1, pc.copies), 0) *
					Math.max(1, Math.min(p.units, p.footprint.unitsPerPlate ?? p.units)),
			0
		);
		const gaps = [printer.spacing, ...KIT_GAPS.filter((g) => g < printer.spacing)];
		let base: ArrangeResult | null = null;
		for (const gap of gaps) {
			const r = arrange({
				...input,
				parts,
				unsized: [],
				printer: { ...printer, spacing: Math.max(MIN_KIT_GAP, gap) },
				options: {
					...input.options,
					solo: soloParts,
					mergeBelow: Infinity,
					// the search tries orders and turns of a few items: pointless for a plate of many
					thorough: itemCount >= 2 && itemCount <= THOROUGH_ITEMS
				}
			});
			base ??= r;
			if (r.plates.length === 1 && !r.plates[0].oversize) return r;
			if (parts.length === 1) break;
		}
		return base!;
	}

	const keptPlates: {
		number: number;
		plate: ArrangedPlate;
		whole: boolean;
		/** The plate has several parts in the source layout and they share the bed: rule F may add a part to it. */
		multi: boolean;
	}[] = [];
	const extras: { plate: ArrangedPlate; from: number }[] = [];
	const leaving = new Set<string>();
	const moveReasonOf = new Map<string, { from: number | null; reason: MoveReason }>();

	source.forEach((pl, i) => {
		const members = [...new Set(pl.parts)].filter((s) => homeOf.get(s) === i);
		if (!members.length) return;
		// a plate printed in runs of its own is laid out for ONE print: one part's items; all its parts stay
		const runPlate =
			rules.perRun &&
			isRunPlate(
				pl,
				members.map((s) => partOf.get(s)!)
			);
		const { stay, leave } = runPlate ? { stay: members, leave: [] as string[] } : split(members);
		for (const s of leave) {
			leaving.add(s);
			moveReasonOf.set(s, { from: pl.number, reason: 'filament' });
		}
		// the parts that are on the bed in one print
		const onBed = runPlate ? [stay[0]] : stay;
		const parts = onBed.map((s) => ({ ...partOf.get(s)!, brims: undefined }));
		// each source plate is placed on its own, exactly as the plate alone: deterministic and independent
		const r = placeOnePlate(parts, solo.has(onBed[0]) && onBed.length === 1 ? onBed : []);
		warnings.push(...r.warnings);
		if (!r.plates.length) return;
		// the plate that stays is the one with most parts (ties: the first); the rest overflowed this bed
		let ki = 0;
		r.plates.forEach((p, k) => {
			if (p.parts.length > r.plates[ki].parts.length) ki = k;
		});
		const kept = r.plates[ki];
		const whole =
			!leave.length &&
			r.plates.length === 1 &&
			pl.parts.every((s) => partOf.has(s) && homeOf.get(s) === i);
		// positions: the source's own; else, when parts left the plate, where the stay parts sit on the whole plate
		let base: ArrangedItem[] | undefined = pl.items?.filter((it) => onBed.includes(it.slug));
		if (!base?.length && leave.length && r.plates.length === 1) {
			const full = placeOnePlate(
				members.map((s) => ({ ...partOf.get(s)!, brims: undefined })),
				[]
			);
			if (full.plates.length === 1 && !full.plates[0].oversize)
				base = full.plates[0].items.filter((it) => stay.includes(it.slug));
		}
		let items = kept.items;
		if (base?.length && r.plates.length === 1 && sourceItemsUsable(base, kept, input))
			items = base.map((it) => ({ ...it, role: partOf.get(it.slug)?.role ?? it.role }));
		const name = whole ? pl.name : kept.name;
		// a plate that stays whole is printed as often as the source says (tires: 8 segments per print, twice)
		const runs = rules.perRun && whole && (pl.runs ?? 0) >= 1 ? Math.round(pl.runs!) : kept.runs;
		// `estGrams` is per run: when the source says the plate is printed more often than the part's own
		// count implies (tires: the part is one unit of 901 g, printed twice), one run is that share
		const estGrams =
			runs > 1 && runs !== kept.runs
				? Object.fromEntries(
						Object.entries(kept.estGrams).map(([r, g]) => [
							r,
							Math.round(((g * Math.max(1, kept.runs)) / runs) * 10) / 10
						])
					)
				: kept.estGrams;
		keptPlates.push({
			number: pl.number,
			plate: {
				...kept,
				runs,
				estGrams,
				items,
				name,
				...(runPlate && r.plates.length === 1
					? { parts: [...stay], perPartRuns: true as const }
					: {})
			},
			whole,
			multi: !runPlate && new Set(pl.parts).size >= 2
		});
		r.plates.forEach((p, k) => {
			if (k === ki) return;
			extras.push({ plate: p, from: pl.number });
			for (const s of p.parts) moveReasonOf.set(s, { from: pl.number, reason: 'bed' });
		});
	});

	// parts the source does not list (a variant, a new part) and the parts that left their plate
	const allMovers = input.parts.filter((p) => !homeOf.has(p.slug) || leaving.has(p.slug));
	for (const p of allMovers)
		if (!moveReasonOf.has(p.slug)) moveReasonOf.set(p.slug, { from: null, reason: 'new' });

	// rule F: a part that left its plate for its filament may join an existing multi-part plate
	const joinedTo = new Map<string, number>();
	if (rules.join)
		for (const p of allMovers)
			if (leaving.has(p.slug)) {
				const to = tryJoin(p);
				if (to != null) joinedTo.set(p.slug, to);
			}
	const movers = allMovers.filter((p) => !joinedTo.has(p.slug));

	/** Items of a part for one run, as outlines (brim counted), largest first; null when one cannot be placed whole. */
	function joinItems(p: ArrangePart):
		| {
				slug: string;
				piece: number;
				copy: number;
				outline: Pt[];
				angles: number[];
				w: number;
				d: number;
		  }[]
		| null {
		const list: {
			slug: string;
			piece: number;
			copy: number;
			outline: Pt[];
			angles: number[];
			w: number;
			d: number;
		}[] = [];
		const ux = printer.bedX - 2 * printer.margin;
		const uy = printer.bedY - 2 * printer.margin;
		const per = unitsPerRunOf(p);
		for (const [pi, pc] of p.footprint.pieces.entries()) {
			const b = Math.max(0, p.brims?.[pi] ?? 0);
			const outline = b > 0 ? inflateOutline(fitOutline(pc), b) : fitOutline(pc);
			const orients = boxOrients(
				{ w: pc.w + 2 * b, d: pc.d + 2 * b, hull: outline },
				p.rotate !== false,
				ux,
				uy
			);
			if (!orients.some((o) => o.w <= ux + 1e-6 && o.d <= uy + 1e-6)) return null;
			for (let c = 0; c < Math.max(1, pc.copies) * per; c++)
				list.push({
					slug: p.slug,
					piece: pi,
					copy: c,
					outline,
					angles: p.rotate === false ? [0] : [0, 90, 180, 270, ...orients.map((o) => o.rot)],
					w: pc.w + 2 * b,
					d: pc.d + 2 * b
				});
		}
		return list.sort((a, b) => b.w * b.d - a.w * a.d || a.piece - b.piece || a.copy - b.copy);
	}

	/** Fit the mover into the first plate (most room first, then lowest number) that takes it; its number, or null. */
	function tryJoin(p: ArrangePart): number | null {
		if (p.footprint.groups?.length || solo.has(p.slug)) return null;
		const items = joinItems(p);
		if (!items?.length) return null;
		const usable = (printer.bedX - 2 * printer.margin) * (printer.bedY - 2 * printer.margin);
		if (!(usable > 0)) return null;
		const own = homeOf.get(p.slug);
		const used = (pl: ArrangedPlate) => pl.items.reduce((a, i) => a + i.w * i.d, 0) / usable;
		const runs = runsOfPart(p);
		const candidates = keptPlates
			.filter(
				(k) =>
					k.multi &&
					!k.plate.oversize &&
					k.plate.items.length > 0 &&
					k.plate.runs === runs &&
					k.plate.roles.length === 1 &&
					k.plate.roles[0] === p.role &&
					k.number !== (own === undefined ? null : source[own].number)
			)
			.sort((a, b) => used(a.plate) - used(b.plate) || a.number - b.number);
		const newArea = items.reduce((a, i) => a + i.w * i.d, 0);
		for (const k of candidates) {
			// cheap test first: the boxes alone must stay under the cap
			if (used(k.plate) + newArea / usable > JOIN_MAX_UTILISATION + 1e-9) continue;
			const fixed: OptItem[] = k.plate.items.map((it) => {
				const owner = partOf.get(it.slug);
				const pc = owner?.footprint.pieces[it.piece];
				const b = Math.max(0, owner?.brims?.[it.piece] ?? 0);
				const base = pc ? fitOutline(pc) : null;
				return {
					outline: base ? (b > 0 ? inflateOutline(base, b) : base) : rectOutline(it.w, it.d),
					rotatable: false,
					rot: it.rotation,
					x: it.x,
					y: it.y,
					ox: it.ox,
					oy: it.oy,
					w: it.w,
					d: it.d
				};
			});
			const nest = nestOutlines(
				items.map((i) => ({ outline: i.outline, angles: i.angles })),
				{
					bedX: printer.bedX,
					bedY: printer.bedY,
					margin: printer.margin,
					spacing: printer.spacing,
					keepOut: printer.keepOut
				},
				fixed
			);
			if (!nest) continue;
			const added: ArrangedItem[] = items.map((it, n) => ({
				slug: it.slug,
				piece: it.piece,
				copy: it.copy,
				x: nest[n].x,
				y: nest[n].y,
				w: nest[n].w,
				d: nest[n].d,
				rotation: nest[n].rot,
				role: p.role,
				...(nest[n].ox || nest[n].oy ? { ox: nest[n].ox, oy: nest[n].oy } : {})
			}));
			// exact boxes after turning
			const total = used(k.plate) + added.reduce((a, i) => a + i.w * i.d, 0) / usable;
			if (total > JOIN_MAX_UTILISATION + 1e-9) continue;
			const order = new Map(input.parts.map((x, i) => [x.slug, i]));
			const parts = [...k.plate.parts, p.slug].sort((a, b) => order.get(a)! - order.get(b)!);
			const estGrams = { ...k.plate.estGrams };
			if (p.grams != null)
				estGrams[p.role] =
					Math.round(((estGrams[p.role] ?? 0) + p.grams * unitsPerRunOf(p)) * 10) / 10;
			k.plate = {
				...k.plate,
				items: [...k.plate.items, ...added],
				parts,
				estGrams,
				utilisation: Math.min(1, Math.round(total * 100) / 100)
			};
			k.whole = false;
			return k.number;
		}
		return null;
	}

	let pooled: ArrangedPlate[] = [];
	if (movers.length || (input.unsized ?? []).length) {
		const r = arrange({
			...input,
			parts: movers,
			options: { ...input.options, solo: [...solo].filter((s) => movers.some((m) => m.slug === s)) }
		});
		pooled = r.plates;
		warnings.push(...r.warnings);
	}

	// numbering: the source's numbers stay; new plates continue after the last
	let next = Math.max(0, ...source.map((p) => p.number)) + 1;
	const out: ArrangedPlate[] = keptPlates.map((k) => ({ ...k.plate, number: k.number }));
	for (const e of extras) out.push({ ...e.plate, number: next++ });
	for (const p of pooled) out.push({ ...p, number: next++ });
	out.sort((a, b) => a.number - b.number);

	// the same name twice: number them
	const count = new Map<string, number>();
	for (const p of out) count.set(p.name, (count.get(p.name) ?? 0) + 1);
	const seen = new Map<string, number>();
	for (const p of out)
		if ((count.get(p.name) ?? 0) > 1) {
			const n = (seen.get(p.name) ?? 0) + 1;
			seen.set(p.name, n);
			p.name = `${p.name} ${n}/${count.get(p.name)}`;
		}

	const kept = keptPlates.filter((k) => k.whole).map((k) => k.number);
	const keptSet = new Set(kept);
	const moves: SourceMove[] = [];
	for (const pl of out) {
		if (keptSet.has(pl.number)) continue;
		for (const s of pl.parts) {
			const why = moveReasonOf.get(s);
			// a part on its own source plate (the plate lost others or a variant) did not move
			const home = homeOf.get(s);
			if (home !== undefined && source[home].number === pl.number) continue;
			moves.push({
				slug: s,
				from: why?.from ?? null,
				to: pl.number,
				reason: why?.reason ?? 'new',
				...(joinedTo.get(s) === pl.number ? { joined: true } : {})
			});
		}
	}
	return { plates: out, warnings, kept, moves };
}
