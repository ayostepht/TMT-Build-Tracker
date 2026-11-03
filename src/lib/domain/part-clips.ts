/**
 * Half-space clips applied to a part's geometry in its own STEP frame (numbers only).
 * Keeps the part where `dot(normal, p) + constant >= 0`.
 *
 * `connectors`: the STEP file mixes bodies already in the assembly frame (J frame pins, the
 * wheel block, the front caster pin and lock; all at y >= 37) with loose bodies laid out near
 * the origin (bearing spacers, washers, wheel pins; y <= 27) that would float under the
 * footrest. One placement matrix cannot serve both, so the loose bodies are clipped away.
 */
export const PART_CLIPS: Record<string, { normal: [number, number, number]; constant: number }> = {
	connectors: { normal: [0, 1, 0], constant: -30 }
};
