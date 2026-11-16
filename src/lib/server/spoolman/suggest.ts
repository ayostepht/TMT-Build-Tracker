/**
 * Rank Spoolman filaments for a build slot (name, material, hex, plus the bundled catalog's
 * SpoolmanDB id when `resolveSlotOrigin` knows the colour). Pure; the route fetches the list.
 */
import { materialFamily } from '#lib/filament-catalog.ts';
import type { SlotOrigin } from '../filaments/types';
import type { FilamentWithSpools } from './client';
import { openSpools } from './cache';

export type MatchLevel = 'exact' | 'likely' | 'possible' | 'other';

export interface Suggestion {
	filament: FilamentWithSpools;
	score: number;
	level: MatchLevel;
	reasons: string[];
	/** Spools that can still be used (not archived, grams left). */
	openSpoolCount: number;
}

export interface SlotQuery {
	name: string;
	material?: string | null;
	hex?: string | null;
}

const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

function rgb(hex: string | null | undefined): [number, number, number] | null {
	const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
	if (!m) return null;
	const v = parseInt(m[1], 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** Euclidean RGB distance, 0 (same) .. ~441. */
export function hexDistance(
	a: string | null | undefined,
	b: string | null | undefined
): number | null {
	const x = rgb(a);
	const y = rgb(b);
	if (!x || !y) return null;
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function scoreFilament(
	f: FilamentWithSpools,
	slot: SlotQuery,
	origin: SlotOrigin | null
): { score: number; reasons: string[] } {
	let score = 0;
	const reasons: string[] = [];
	if (origin?.sdbId && f.externalId && f.externalId === origin.sdbId) {
		score += 100;
		reasons.push('Same SpoolmanDB filament');
	}
	const slotName = norm(slot.name);
	const full = norm(`${f.vendor ?? ''} ${f.name}`);
	const bare = norm(f.name);
	if (slotName && (slotName === full || slotName === bare)) {
		score += 45;
		reasons.push('Same name');
	} else if (
		slotName &&
		(full.includes(slotName) || slotName.includes(full) || (bare && slotName.includes(bare)))
	) {
		score += 25;
		reasons.push('Similar name');
	}
	const mat = slot.material?.trim().toLowerCase();
	if (mat && f.material) {
		const fm = f.material.toLowerCase();
		if (fm === mat) {
			score += 15;
			reasons.push('Same material');
		} else if (materialFamily(fm) !== 'other' && materialFamily(fm) === materialFamily(mat)) {
			score += 8;
			reasons.push('Same kind of material');
		} else score -= 10;
	}
	const d = hexDistance(slot.hex, f.colorHex);
	if (d !== null) {
		if (d <= 12) {
			score += 25;
			reasons.push('Same colour');
		} else if (d <= 40) {
			score += 12;
			reasons.push('Close colour');
		} else if (d <= 80) score += 4;
	}
	if (openSpools(f).length) score += 3;
	return { score, reasons };
}

const level = (score: number): MatchLevel =>
	score >= 90 ? 'exact' : score >= 45 ? 'likely' : score >= 20 ? 'possible' : 'other';

/** Every filament, best match first (ties: name). */
export function rankFilaments(
	filaments: FilamentWithSpools[],
	slot: SlotQuery,
	origin: SlotOrigin | null,
	limit = 300
): Suggestion[] {
	return filaments
		.map((filament) => {
			const { score, reasons } = scoreFilament(filament, slot, origin);
			return {
				filament,
				score,
				level: level(score),
				reasons,
				openSpoolCount: openSpools(filament).length
			};
		})
		.sort((a, b) => b.score - a.score || a.filament.name.localeCompare(b.filament.name))
		.slice(0, limit);
}
