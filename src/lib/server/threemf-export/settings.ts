import { catalogPrinter } from '#lib/printers/catalog.ts';

/**
 * Printer model name as slicers write it (`printer_model`), taken from the catalog entry
 * ("Elegoo Centauri Carbon", "Bambu Lab X1 Carbon"); null for custom printers, so the
 * project stays generic and the slicer keeps whatever printer the user has selected.
 */
export function catalogPrinterName(catalogId: string | null): string | null {
	const p = catalogPrinter(catalogId);
	if (!p) return null;
	return p.model.toLowerCase().startsWith(p.brand.toLowerCase())
		? p.model
		: `${p.brand} ${p.model}`;
}
