/**
 * Curated catalog of popular FDM printers: facts only (bed size, multi-material
 * system), written by hand for this project. No slicer profiles are copied.
 * Browser-safe: no Node imports.
 *
 * Sources are the manufacturers' own product / spec pages (domains listed
 * below). Figures were entered from the published specs as known when written and
 * were not re-fetched page by page; anything uncertain carries a `check` note and
 * the UI asks the user to verify. The user can always edit the bed. Bed sizes are the
 * printable XY area in mm. Round (delta) beds are stored as the largest
 * inscribed square (`round: diameter`), which is what a rectangle packer can use.
 *
 * Brand pages: elegoo.com, bambulab.com, prusa3d.com, creality.com, anycubic.com,
 * qidi3d.com, sovol3d.com, docs.vorondesign.com, flsun3d.com, snapmaker.com,
 * flashforge.com, artillery3d.com, ankermake.com.
 */

export interface MultiMaterialOption {
	/** e.g. "CANVAS", "AMS", "AMS Lite", "MMU3", "CFS". */
	name: string;
	/** Filaments one print can use with this system (one plate, no manual swaps). */
	slots: number;
	/** What the number means: "up to 16 with 4 AMS units". */
	note?: string;
}

import type { KeepOut } from '#lib/domain/types.ts';

export interface CatalogPrinter {
	/** Stable id: `<brand>-<model>` in kebab case. Never reuse an id. */
	id: string;
	brand: string;
	model: string;
	/** Build volume in mm. */
	bedX: number;
	bedY: number;
	bedZ: number;
	heatedBed: boolean;
	/** Maximum hotend temperature in C, null when unknown. */
	maxNozzleC: number | null;
	/** Add-ons / built-in systems that print several filaments in one job. Empty: single filament only. */
	mm: MultiMaterialOption[];
	/** The system is part of the machine (toolchangers, dual nozzle): preselect `mm[0]`. */
	mmBuiltIn?: boolean;
	nozzle: number;
	/** Diameter in mm when the bed is round (bedX/bedY then hold the inscribed square). */
	round?: number;
	notes?: string;
	/** Parts keep off these bed rectangles (the slicer's `bed_exclude_area`). */
	keepOut?: KeepOut[];
	/** Where the keep-out came from (the slicer profile file). */
	keepOutSource?: string;
	/** Specs we could not confirm; the UI asks the user to verify. */
	check?: string;
}

export const CUSTOM_PRINTER_ID = 'custom';

type Row = [
	brand: string,
	model: string,
	x: number,
	y: number,
	z: number,
	maxC: number | null,
	mm?: MultiMaterialOption[],
	extra?: Partial<CatalogPrinter>
];

const mmo = (name: string, slots: number, note?: string): MultiMaterialOption => ({
	name,
	slots,
	...(note ? { note } : {})
});
const AMS = mmo('AMS', 4, 'up to 16 filaments with 4 AMS units');
const AMS_LITE = mmo('AMS Lite', 4);
const CANVAS = mmo('CANVAS', 4);
const MMU3 = mmo('MMU3', 5);
const CFS = mmo('CFS', 4, 'up to 16 filaments with 4 CFS units');
const ACE = mmo('ACE Pro', 4);
const IFS = mmo('IFS', 4);
const QIDI_BOX = mmo('QIDI Box', 4);

// Keep-out rectangles come from the slicers' own machine profiles (`bed_exclude_area`, points
// "XxY", origin front-left). Only printers whose profile defines one get an entry.
const ORCA_ECC =
	'OrcaSlicer resources/profiles/Elegoo/machine/ECC/Elegoo Centauri Carbon 0.4 nozzle.json: bed_exclude_area ["246x0","256x0","256x20","246x20"]';
const ORCA_BBL =
	'OrcaSlicer resources/profiles/BBL/machine/Bambu Lab <model> 0.4 nozzle.json: bed_exclude_area ["0x0","18x0","18x28","0x28"]';
const BBL_KEEP: Partial<CatalogPrinter> = {
	keepOut: [{ x: 0, y: 0, w: 18, d: 28, label: 'Front-left corner' }],
	keepOutSource: ORCA_BBL
};

const kebab = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

const rows: Row[] = [
	// Elegoo (elegoo.com): Centauri Carbon spec page: 256x256x256, 320 C hotend, CANVAS 4-color add-on
	[
		'Elegoo',
		'Centauri Carbon',
		256,
		256,
		256,
		320,
		[CANVAS],
		{
			notes: 'CANVAS is the optional 4-color multi-material add-on.',
			keepOut: [{ x: 246, y: 0, w: 10, d: 20, label: 'Filament cutter' }],
			keepOutSource: ORCA_ECC
		}
	],
	['Elegoo', 'Neptune 4', 225, 225, 265, 300],
	['Elegoo', 'Neptune 4 Pro', 225, 225, 265, 300],
	['Elegoo', 'Neptune 4 Plus', 320, 320, 385, 300],
	['Elegoo', 'Neptune 4 Max', 420, 420, 480, 300],
	['Elegoo', 'Neptune 3 Pro', 225, 225, 280, 260],
	// Bambu Lab (bambulab.com)
	['Bambu Lab', 'X1 Carbon', 256, 256, 256, 300, [AMS], BBL_KEEP],
	['Bambu Lab', 'X1E', 256, 256, 256, 320, [AMS], BBL_KEEP],
	['Bambu Lab', 'P1S', 256, 256, 256, 300, [AMS], BBL_KEEP],
	['Bambu Lab', 'P1P', 256, 256, 256, 300, [AMS], BBL_KEEP],
	[
		'Bambu Lab',
		'P2S',
		256,
		256,
		256,
		300,
		[AMS],
		{ check: 'Newer model: confirm the build volume.' }
	],
	['Bambu Lab', 'A1', 256, 256, 256, 300, [AMS_LITE]],
	['Bambu Lab', 'A1 mini', 180, 180, 180, 300, [AMS_LITE]],
	[
		'Bambu Lab',
		'H2D',
		350,
		320,
		325,
		350,
		[mmo('AMS', 4, 'dual nozzle; up to 24 filaments with AMS units')],
		{ mmBuiltIn: true, notes: 'Dual nozzle: 350 x 320 mm with both, a little less with one.' }
	],
	[
		'Bambu Lab',
		'H2S',
		340,
		320,
		340,
		350,
		[AMS],
		{ check: 'Single-nozzle H2 variant: confirm the build volume.' }
	],
	// Prusa Research (prusa3d.com)
	['Prusa', 'MK4', 250, 210, 220, 290, [MMU3]],
	['Prusa', 'MK4S', 250, 210, 220, 290, [MMU3]],
	['Prusa', 'MK3S+', 250, 210, 210, 280, [MMU3]],
	[
		'Prusa',
		'Core One',
		250,
		220,
		270,
		290,
		[mmo('MMU3', 5, 'Core One MMU upgrade')],
		{ check: 'Confirm Z height and MMU availability.' }
	],
	['Prusa', 'XL (1 tool)', 360, 360, 360, 290],
	['Prusa', 'XL (2 tools)', 360, 360, 360, 290, [mmo('Toolchanger', 2)], { mmBuiltIn: true }],
	['Prusa', 'XL (3 tools)', 360, 360, 360, 290, [mmo('Toolchanger', 3)], { mmBuiltIn: true }],
	['Prusa', 'XL (4 tools)', 360, 360, 360, 290, [mmo('Toolchanger', 4)], { mmBuiltIn: true }],
	['Prusa', 'XL (5 tools)', 360, 360, 360, 290, [mmo('Toolchanger', 5)], { mmBuiltIn: true }],
	['Prusa', 'MINI+', 180, 180, 180, 280],
	// Creality (creality.com)
	['Creality', 'K1', 220, 220, 250, 300],
	['Creality', 'K1C', 220, 220, 250, 300, [CFS]],
	['Creality', 'K1 Max', 300, 300, 300, 300, [CFS]],
	[
		'Creality',
		'K2 Plus',
		350,
		350,
		350,
		350,
		[CFS],
		{ check: 'Confirm the CFS slot count for your bundle.' }
	],
	['Creality', 'Hi', 260, 240, 300, 300, [CFS], { check: 'Confirm the bed size.' }],
	['Creality', 'Ender-3 V3', 220, 220, 250, 300],
	['Creality', 'Ender-3 V3 SE', 220, 220, 250, 260],
	['Creality', 'Ender-3 V3 KE', 220, 220, 240, 300],
	['Creality', 'Ender-3 V3 Plus', 300, 300, 330, 300],
	['Creality', 'Ender-3 V2', 220, 220, 250, 260],
	['Creality', 'Ender-3 S1', 220, 220, 270, 260],
	['Creality', 'Ender-5 Max', 400, 400, 400, 300],
	// Anycubic (anycubic.com)
	['Anycubic', 'Kobra 3', 250, 250, 260, 300, [ACE]],
	['Anycubic', 'Kobra S1', 250, 250, 250, 320, [ACE]],
	['Anycubic', 'Kobra 2 Pro', 220, 220, 250, 260],
	['Anycubic', 'Kobra 2 Max', 420, 420, 500, 260],
	['Anycubic', 'Kobra Neo', 220, 220, 250, 260],
	// Qidi Tech (qidi3d.com)
	['Qidi', 'Q1 Pro', 245, 245, 240, 350, [QIDI_BOX]],
	['Qidi', 'Plus4', 305, 305, 280, 370, [QIDI_BOX]],
	['Qidi', 'X-Max 3', 325, 325, 315, 350, [QIDI_BOX]],
	['Qidi', 'X-Plus 3', 280, 280, 270, 350],
	// Sovol (sovol3d.com)
	['Sovol', 'SV06', 220, 220, 250, 300],
	['Sovol', 'SV06 Plus', 300, 300, 340, 300],
	['Sovol', 'SV07', 220, 220, 250, 300],
	['Sovol', 'SV08', 350, 350, 345, 300],
	// Voron Design (docs.vorondesign.com): self-sourced; the number is the model's bed size
	[
		'Voron',
		'2.4 (250)',
		250,
		250,
		250,
		null,
		undefined,
		{ notes: 'Self-built. Bed size is the model variant.' }
	],
	['Voron', '2.4 (300)', 300, 300, 300, null],
	['Voron', '2.4 (350)', 350, 350, 350, null],
	['Voron', 'Trident (250)', 250, 250, 250, null],
	['Voron', 'Trident (300)', 300, 300, 300, null],
	['Voron', 'Trident (350)', 350, 350, 350, null],
	['Voron', 'V0.2', 120, 120, 120, null],
	// FLSUN (flsun3d.com): delta printers with round beds; bedX/bedY = inscribed square
	[
		'FLSUN',
		'V400',
		212,
		212,
		410,
		300,
		undefined,
		{ round: 300, check: 'Round bed, 300 mm diameter.' }
	],
	[
		'FLSUN',
		'T1 Pro',
		180,
		180,
		330,
		300,
		undefined,
		{ round: 255, check: 'Round bed, 255 mm diameter.' }
	],
	[
		'FLSUN',
		'SR',
		184,
		184,
		330,
		300,
		undefined,
		{ round: 260, check: 'Round bed, 260 mm diameter.' }
	],
	// Snapmaker (snapmaker.com)
	[
		'Snapmaker',
		'U1',
		270,
		270,
		270,
		300,
		[mmo('Toolchanger', 4, '4 independent tool heads')],
		{ mmBuiltIn: true, check: 'Confirm the build volume.' }
	],
	// Others
	['Flashforge', 'Adventurer 5M', 220, 220, 220, 280],
	['Flashforge', 'AD5X', 220, 220, 220, 300, [IFS], { check: 'Confirm IFS slot count and bed.' }],
	['Artillery', 'Sidewinder X3 Plus', 300, 300, 400, 300],
	['AnkerMake', 'M5', 235, 235, 250, 260],
	['Two Trees', 'SK1', 256, 256, 256, 300],
	['BIQU', 'B1', 235, 235, 270, 260]
];

export const PRINTER_CATALOG: CatalogPrinter[] = rows.map(
	([brand, model, bedX, bedY, bedZ, maxNozzleC, mm, extra]) => ({
		id: kebab(`${brand} ${model}`),
		brand,
		model,
		bedX,
		bedY,
		bedZ,
		heatedBed: true,
		maxNozzleC,
		mm: mm ?? [],
		nozzle: 0.4,
		...extra
	})
);

export function catalogPrinter(id: string | null | undefined): CatalogPrinter | null {
	return PRINTER_CATALOG.find((p) => p.id === id) ?? null;
}

/** Brands in alphabetical order with their models in catalog order. */
export function printerBrands(): { brand: string; printers: CatalogPrinter[] }[] {
	const map = new Map<string, CatalogPrinter[]>();
	for (const p of PRINTER_CATALOG) {
		const list = map.get(p.brand) ?? [];
		list.push(p);
		map.set(p.brand, list);
	}
	return [...map.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([brand, printers]) => ({ brand, printers }));
}

/** Case-insensitive search over brand + model + multi-material names. */
export function searchPrinters(q: string): CatalogPrinter[] {
	const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return PRINTER_CATALOG;
	return PRINTER_CATALOG.filter((p) => {
		const hay = `${p.brand} ${p.model} ${p.mm.map((m) => m.name).join(' ')}`.toLowerCase();
		return terms.every((t) => hay.includes(t));
	});
}
