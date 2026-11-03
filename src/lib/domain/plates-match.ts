/**
 * Maps object names from a slicer 3MF ("3DTMT A1 HANDLE LEFT REV A.STEP",
 * "MG_HEADREST SCREW REV B", "TMT3D - HARNESS RIGHT") to template part slugs
 * (Milestone 5). Pure: it only sees part names, source files and components.
 *
 * Strategy, strongest first: the same file name once decoration is removed
 * (case, extension, `REV x`, `Vn`, `KIT`, `MG_`, punctuation), with `KIT` and the
 * revision breaking ties between variants that share a file; a component of a
 * multi-file part (connectors, harness); then token overlap with the part's
 * name and file (letter codes such as A1/B2 and the filament material add
 * weight, left vs right is never confused); finally the part's notes for
 * oddly named objects. Below 0.45 the result has no slug.
 */
import type { VariantGroup } from './types.ts';

export interface MatchPart {
	slug: string;
	name: string;
	sourceFile: string;
	notes?: string[];
	allowedMaterials?: string[];
	components?: { name: string; file?: string }[];
	variantGroup?: string | null;
	variantOption?: string | null;
}

export interface ObjectMatch {
	slug: string | null;
	/** 0..1; >= 0.8 is a confident match, 0.45..0.8 worth a look. */
	confidence: number;
	reason: string;
}

export interface MatchContext {
	/** Filament type of the object ("PETG", "TPU"), used to tell apart parts with similar names. */
	filamentType?: string | null;
}

export const MATCH_THRESHOLD = 0.45;

const EXT = /\.(step|stp|stl|3mf|obj|iges|igs|f3d)\b/gi;
const NOISE = new Set(['3dtmt', 'tmt3d', 'tmt', '3d', 'mg', 'kit', 'xx', 'the', 'and']);

interface Norm {
	/** Tokens without decoration. */
	tokens: string[];
	core: string;
	rev: string | null;
	kit: boolean;
	code: string | null;
	side: 'left' | 'right' | null;
}

function stem(t: string): string {
	return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

export function normalizeName(raw: string): Norm {
	let s = raw.toLowerCase().replace(EXT, ' ');
	const revM = /\brev\.?\s*([a-z0-9][a-z0-9.]*)/.exec(s);
	const rev = revM ? revM[1].replace(/\.$/, '') : null;
	s = s.replace(/\brev\.?\s*[a-z0-9][a-z0-9.]*/g, ' ');
	const kit = /\bkit\b/.test(s);
	s = s.replace(/[×x]\s?\d+\b/g, ' ').replace(/\bv\d+\b/g, ' ');
	const words = s
		.replace(/[^a-z0-9.]+/g, ' ')
		.replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
	// Letter code: the first short token after the vendor prefix (A1, B2, F, ...).
	const body = words.filter((w) => !['3dtmt', 'tmt3d', 'tmt', '3d', 'mg'].includes(w));
	const code = body.length && /^[a-z]\d?$/.test(body[0]) && body[0] !== 'a' ? body[0] : null;
	const codeA = body.length && /^a\d$/.test(body[0]) ? body[0] : code;
	const tokens = words.filter((w) => !NOISE.has(w)).map(stem);
	const noCode = codeA
		? tokens.filter((t, i) => !(i === tokens.indexOf(codeA) && t === codeA))
		: tokens;
	const side = noCode.includes('left')
		? noCode.includes('right')
			? null
			: 'left'
		: noCode.includes('right')
			? 'right'
			: null;
	return { tokens: noCode, core: noCode.join(' '), rev, kit, code: codeA, side };
}

function overlap(a: string[], b: string[]): number {
	if (!a.length || !b.length) return 0;
	const sb = new Set(b);
	const inter = a.filter((t) => sb.has(t)).length;
	return (2 * inter) / (a.length + b.length);
}

function contained(a: string[], b: string[]): number {
	if (!a.length) return 0;
	const sb = new Set(b);
	return a.filter((t) => sb.has(t)).length / a.length;
}

interface Cand {
	slug: string;
	score: number;
	reason: string;
}

/** Best part for one object name. `parts` should be every template part (inactive variants included). */
export function matchObject(name: string, parts: MatchPart[], ctx: MatchContext = {}): ObjectMatch {
	const o = normalizeName(name);
	if (!o.tokens.length) return { slug: null, confidence: 0, reason: 'No usable name' };
	const type = (ctx.filamentType ?? '').toUpperCase();
	const cands: Cand[] = [];

	parts.forEach((p) => {
		const file = normalizeName(p.sourceFile);
		const best: Cand = { slug: p.slug, score: 0, reason: '' };
		const bump = (score: number, reason: string) => {
			if (score > best.score) {
				best.score = score;
				best.reason = reason;
			}
		};
		// Side must agree (left vs right) whenever both sides state one.
		const sideOk = (n: Norm) => !o.side || !n.side || o.side === n.side;

		if (file.core && file.core === o.core && sideOk(file)) {
			let s = 0.9;
			if (file.kit !== o.kit) s -= 0.25;
			else s += 0.05;
			if (file.rev && o.rev) s += file.rev === o.rev ? 0.05 : -0.1;
			bump(Math.min(1, s), `Same file as ${p.sourceFile}`);
		}
		for (const c of p.components ?? []) {
			for (const text of [c.file, c.name]) {
				if (!text) continue;
				const n = normalizeName(text);
				if (n.core && n.core === o.core && sideOk(n))
					bump(0.9 - (n.kit !== o.kit ? 0.1 : 0), `Part of ${p.name}`);
			}
		}
		if (best.score < 0.8) {
			const name2 = normalizeName(p.name);
			let s = Math.max(overlap(o.tokens, file.tokens), overlap(o.tokens, name2.tokens));
			if (!sideOk(file) || !sideOk(name2)) s = 0;
			if (o.code && file.code) s *= o.code === file.code ? 1.15 : 0.6;
			if (s > 0) bump(Math.min(0.85, s * 0.9), `Similar to ${p.name}`);
		}
		if (best.score < MATCH_THRESHOLD && p.notes?.length && o.tokens.length >= 2) {
			const corpus = normalizeName(p.notes.join(' ')).tokens;
			const c = contained(o.tokens, corpus);
			if (c === 1) bump(0.5, `Mentioned in the notes of ${p.name}`);
		}
		if (best.score > 0 && type) {
			const mats = (p.allowedMaterials ?? []).map((m) => m.toUpperCase());
			if (mats.length) {
				const fits = mats.some((m) => m.startsWith(type) || type.startsWith(m));
				best.score = Math.min(1, Math.max(0, best.score + (fits ? 0.05 : -0.3)));
			}
		}
		if (best.score > 0) cands.push(best);
	});

	cands.sort((a, b) => b.score - a.score);
	const top = cands[0];
	if (!top || top.score < MATCH_THRESHOLD)
		return { slug: null, confidence: top?.score ?? 0, reason: 'No close match' };
	const rivals = cands.filter((c) => c !== top && top.score - c.score < 0.02);
	// Ties between decorated variants (several parts sharing a file) keep the first listed part, flagged.
	if (rivals.length)
		return {
			slug: top.slug,
			confidence: Math.min(top.score, 0.6),
			reason: `${top.reason}; also fits ${rivals.map((r) => r.slug).join(', ')}`
		};
	return { slug: top.slug, confidence: top.score, reason: top.reason };
}

export interface MatchPlateInput {
	index: number;
	objects: { id: string; name: string; filamentIndex: number | null }[];
}

/** Key used for object mappings: `<plate index>:<object id>`. */
export const objectKey = (plateIndex: number, objectId: string) => `${plateIndex}:${objectId}`;

export function matchPlates(
	plates: MatchPlateInput[],
	parts: MatchPart[],
	filaments: { index: number; type: string }[]
): Record<string, ObjectMatch> {
	const typeOf = new Map(filaments.map((f) => [f.index, f.type]));
	const out: Record<string, ObjectMatch> = {};
	for (const pl of plates)
		for (const o of pl.objects)
			out[objectKey(pl.index, o.id)] = matchObject(o.name, parts, {
				filamentType: o.filamentIndex ? typeOf.get(o.filamentIndex) : null
			});
	return out;
}

/**
 * Variant choices implied by the matched parts: in each group, the option most of
 * the matched parts belong to. No suggestion when no part of the group matched
 * or when two options tie (a file that carries both, such as a profile with kit
 * and McMaster caster plates).
 */
export function suggestVariants(
	groups: VariantGroup[],
	matchedSlugs: Iterable<string>
): Record<string, string> {
	const votes = new Map<string, number>();
	for (const s of matchedSlugs) votes.set(s, (votes.get(s) ?? 0) + 1);
	const out: Record<string, string> = {};
	for (const g of groups) {
		const score = g.options.map((o) => ({
			key: o.key,
			n: o.parts.reduce((a, s) => a + (votes.get(s) ?? 0), 0)
		}));
		score.sort((a, b) => b.n - a.n);
		if (score[0] && score[0].n > 0 && (score.length < 2 || score[0].n > score[1].n))
			out[g.key] = score[0].key;
	}
	return out;
}

/** Slugs of every part a plate's objects map to (unique, in order). */
export function slugsFor(
	plateIndex: number,
	objects: { id: string }[],
	mapping: Record<string, string | null | undefined>
): string[] {
	const out: string[] = [];
	for (const o of objects) {
		const s = mapping[objectKey(plateIndex, o.id)];
		if (s && !out.includes(s)) out.push(s);
	}
	return out;
}
