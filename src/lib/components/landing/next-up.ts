/**
 * The landing's "Next up" rule (no domain rule existed): the lowest-numbered plate that still has a
 * part To print or Reprint, skipping plates with a part on the printer. Pure.
 */
import type { BuildView, Plate } from '#lib/domain/types.ts';

export function nextUpPlate(view: BuildView): Plate | null {
	for (const plate of [...view.plates].sort((a, b) => a.number - b.number)) {
		const states = plate.parts.map((s) => view.state[s]?.status).filter(Boolean);
		if (states.includes('Printing')) continue;
		if (states.some((s) => s === 'To print' || s === 'Reprint')) return plate;
	}
	return null;
}
