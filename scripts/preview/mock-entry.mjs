// Bundled by preview-demo.mjs (esbuild) into data/preview/mock.mjs: the repo's own mock Elegoo
// printer and the printer catalog, so the preview needs no copy of their logic.
export { MockSdcp } from '../../src/lib/server/printers/mock-sdcp.ts';
export { catalogPrinter, PRINTER_CATALOG } from '../../src/lib/printers/catalog.ts';
export { printerFromCatalog } from '../../src/lib/printers/printer.ts';
