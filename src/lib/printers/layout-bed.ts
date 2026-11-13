/**
 * The bed a built-in MakeGood plate layout is made for. Choosing such a layout counts as
 * choosing the bed: the setup wizard and the export use this preset when the build has no
 * printer of its own. "Arrange for my bed" and uploaded 3MF files still need a real printer.
 * Browser-safe; no schema: derived from the layout key, never stored.
 */
import type { BuildPrinter } from '#lib/domain/types.ts';
import { catalogPrinter } from './catalog.ts';
import { printerFromCatalog } from './printer.ts';

/** Layout key -> catalog printer that stands for the profile's whole printer family. */
const LAYOUT_BEDS: Record<string, { catalogId: string; name: string }> = {
	xpa: { catalogId: 'bambu-lab-x1-carbon', name: 'Bambu X1 / P1 / A1' },
	h2d: { catalogId: 'bambu-lab-h2d', name: 'Bambu H2D / H2S' }
};

/** The bed preset of a built-in layout key, or null (arranged, upload, custom or unknown layouts). */
export function layoutBed(layoutKey: string | null | undefined): BuildPrinter | null {
	const m = layoutKey ? LAYOUT_BEDS[layoutKey] : undefined;
	const c = m && catalogPrinter(m.catalogId);
	if (!m || !c) return null;
	return { ...printerFromCatalog(c, c.mm.length ? 0 : null), name: m.name };
}

/** "Bambu X1 / P1 / A1 (256 × 256 mm)" for the layout card. */
export const layoutBedLabel = (p: BuildPrinter) => `${p.name} (${p.bedX} × ${p.bedY} mm)`;
