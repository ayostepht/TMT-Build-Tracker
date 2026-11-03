/**
 * Pure picking rules for the 3D view (no three.js), unit-tested in picking.test.ts.
 *
 * A pointer gesture is a tap when it moved at most `TAP_SLOP` px and lasted at most `TAP_MS`;
 * anything longer or further is an orbit/pan drag and never picks. A tap raycasts against every
 * visible part, dimmed ones included, so tapping another part while one is selected switches the
 * selection; a tap that hits no mesh is a miss (the page deselects).
 */
export const TAP_SLOP = 6;
export const TAP_MS = 600;

export interface PointerSample {
	x: number;
	y: number;
	t: number;
}

export function isTap(down: PointerSample | null, up: PointerSample): boolean {
	if (!down) return false;
	return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP && up.t - down.t <= TAP_MS;
}

export type PickResult = { kind: 'hit'; slug: string } | { kind: 'miss' };

/** First raycast hit (nearest first) that belongs to a part; hits without a slug are ignored. */
export function resolvePick(hits: readonly { slug?: string | null }[]): PickResult {
	for (const h of hits) if (h.slug) return { kind: 'hit', slug: h.slug };
	return { kind: 'miss' };
}
