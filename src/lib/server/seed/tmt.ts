import type { PlateSeed, TemplateSeed } from './types';

const PETG = ['PETG'];
const TPU = ['TPU 95A'];
const VELCRO = 'Attach with sticky-back velcro (not in the kit).';
const LOGOS = 'Logos face the rear when assembled (step 17).';
const WARP =
	"Front of the handle can warp off the bed and leave a gap at assembly. Use the 10 mm brim and bed adhesive, and check it's flat.";
const REVB = 'REV B. REV A is obsolete.';
const NOEXT = "File has no extension; rename to .step if the slicer won't open it.";
const NOSHEET = 'Not on the settings sheet: use the MakerWorld profile values.';
const KITCASTER = 'KIT version for the kit rear caster. Not the non-KIT';

// Column-major 4x4 matrices (three.js order), mm, y up, assembly frame of MakeGood's rendering file.
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// Mirror across the x = 0 plane (negative determinant: the importer must flip triangle winding).
const MIRROR_X = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// Hub cap STEP: axis along y, so rotate y to +x / -x and move the cap's own centre (0, 23.2, -0.1) to (+-231.4, 145, -300).
const HUB_CAP_RIGHT = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 208.2, 145, -299.9, 1];
const HUB_CAP_LEFT = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, -208.2, 144.9, -299.9, 1];
const placedAtOrigin = (...slugs: string[]) => slugs.map((slug) => ({ slug, placed: true }));

export const tmtTemplate: TemplateSeed = {
	slug: 'makegood-tmt-revb',
	name: 'MakeGood 3D TMT',
	version: 'Rev B (X/P/A series profile, 2026-08-05)',
	description:
		'Part-by-part build plan for the MakeGood 3D TMT toddler mobility chair, following the 24-plate X/P/A series print profile. Tracks filament by role (two PETG colors, two TPU 95A colors), per-plate print time, and links each part to its page in the maker build guide.',
	globalSettings: '0.4 mm nozzle, 0.2 mm layers, tree supports',
	sections: ['Seat', 'Frame', 'Accessories', 'Wheels'],
	filamentRoles: [
		{
			key: 'primary',
			name: 'Primary PETG',
			material: 'PETG',
			hex: '#034E89',
			tpu: false,
			recommendedSpools: 5
		},
		{
			key: 'accent',
			name: 'Accent PETG',
			material: 'PETG',
			hex: '#0378D0',
			tpu: false,
			recommendedSpools: 4
		},
		{
			key: 'soft',
			name: 'Soft TPU',
			material: 'TPU 95A',
			hex: '#0378D0',
			tpu: true,
			recommendedSpools: 1
		},
		{
			key: 'tire',
			name: 'Tire TPU',
			material: 'TPU 95A',
			hex: '#1c1c20',
			tpu: true,
			recommendedSpools: 2
		}
	],
	parts: [
		// ---- Seat
		{
			slug: 'seat-center',
			name: 'Seat Center',
			section: 'Seat',
			defaultRole: 'primary',
			bomGrams: 180,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT H SEAT CENTER REV A.STEP',
			notes: [],
			allowedMaterials: PETG,
			guideRefs: [{ page: 18, text: 'Steps 18-20: seat goes in' }]
		},
		{
			slug: 'seat-back-top',
			name: 'Seat Back Top',
			section: 'Seat',
			defaultRole: 'primary',
			bomGrams: 113,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT F SEAT BACK CENTER TOP REV A.STEP',
			notes: [LOGOS],
			allowedMaterials: PETG,
			guideRefs: [{ page: 18, text: 'Step 17: seat back, logos facing rear' }]
		},
		{
			slug: 'seat-back-bottom',
			name: 'Seat Back Bottom',
			section: 'Seat',
			defaultRole: 'primary',
			bomGrams: 135,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT G SEAT BACK CENTER BOTTOM REV A.STEP',
			notes: [LOGOS],
			allowedMaterials: PETG,
			guideRefs: [{ page: 18, text: 'Step 17: seat back, logos facing rear' }]
		},
		{
			slug: 'cushion-top',
			name: 'Cushion Top',
			section: 'Seat',
			defaultRole: 'soft',
			bomGrams: 224,
			qty: 1,
			walls: 2,
			infill: '2%',
			supports: 'No',
			sourceFile: 'MG_2 PART CUSHION TOP.step',
			notes: [
				'Settings sheet lists CUSHION BASE twice; the second row is the top. Same settings.',
				VELCRO
			],
			allowedMaterials: TPU,
			guideRefs: [{ page: 23, text: 'Cushions attach with sticky velcro' }]
		},
		{
			slug: 'cushion-base',
			name: 'Cushion Base',
			section: 'Seat',
			defaultRole: 'soft',
			bomGrams: 204,
			qty: 1,
			walls: 2,
			infill: '2%',
			supports: 'No',
			sourceFile: 'MG_2 PART CUSHION BASE.step',
			notes: [VELCRO],
			allowedMaterials: TPU,
			guideRefs: [{ page: 23, text: 'Cushions attach with sticky velcro' }]
		},
		{
			slug: 'soft-headrest',
			name: 'Soft Headrest',
			section: 'Seat',
			defaultRole: 'soft',
			bomGrams: 80,
			qty: 1,
			walls: 2,
			infill: '4%',
			supports: 'No',
			sourceFile: 'MG_HEADREST CUSHION.step',
			notes: [VELCRO],
			allowedMaterials: TPU,
			guideRefs: [{ page: 23, text: 'Headrest cushion attaches with sticky velcro' }]
		},
		{
			slug: 'bucket-seat',
			name: 'Foaming TPU Bucket Seat',
			section: 'Seat',
			defaultRole: 'soft',
			bomGrams: null,
			qty: 1,
			walls: 2,
			infill: '10%',
			supports: '',
			sourceFile: 'TMT 3D Seat 280, With Slots REV 05.1.STEP',
			notes: [
				"Variant: replaces the two seat cushions. MakeGood's foaming TPU 90A profile: 2 walls, 10% infill, 1 top layer, 0.2 mm layers.",
				'Weight and supports are not published; weigh it once printed.'
			],
			allowedMaterials: ['TPU 90A foaming'],
			guideRefs: []
		},

		// ---- Frame
		{
			slug: 'wing-left',
			name: 'Wing Left',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: 405,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT C1 WING LEFT REV B.step',
			notes: [REVB],
			allowedMaterials: PETG,
			symmetryGroup: 'wing',
			guideRefs: [{ page: 14, text: 'Step 1: wing onto the wheel mount' }]
		},
		{
			slug: 'wing-right',
			name: 'Wing Right',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: 405,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT C2 WING RIGHT REV B.step',
			notes: [REVB],
			allowedMaterials: PETG,
			symmetryGroup: 'wing',
			guideRefs: [{ page: 14, text: 'Step 1: wing onto the wheel mount' }]
		},
		{
			slug: 'wheel-mount-left',
			name: 'Wheel Mount Left',
			section: 'Frame',
			defaultRole: 'primary',
			bomGrams: 576,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT B1 WHEEL MOUNT LEFT REV A.STEP',
			notes: [],
			allowedMaterials: PETG,
			symmetryGroup: 'wheel-mount',
			guideRefs: [
				{ page: 14, text: 'Steps 1-3: the box everything builds on' },
				{ page: 16, text: 'Steps 10-12: front caster mounts underneath' },
				{ page: 20, text: 'Steps 25-27: wheel mounts to it' }
			]
		},
		{
			slug: 'wheel-mount-right',
			name: 'Wheel Mount Right',
			section: 'Frame',
			defaultRole: 'primary',
			bomGrams: 578,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT B2 WHEEL MOUNT RIGHT REV A.STEP',
			notes: [],
			allowedMaterials: PETG,
			symmetryGroup: 'wheel-mount',
			guideRefs: [
				{ page: 14, text: 'Steps 1-3: the box everything builds on' },
				{ page: 16, text: 'Steps 10-12: front caster mounts underneath' },
				{ page: 20, text: 'Steps 25-27: wheel mounts to it' }
			]
		},
		{
			slug: 'handle-left',
			name: 'Handle Left',
			section: 'Frame',
			defaultRole: 'primary',
			bomGrams: 446,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			brim: '10 mm',
			sourceFile: '3DTMT A1 HANDLE LEFT REV A.STEP',
			notes: [WARP],
			allowedMaterials: PETG,
			symmetryGroup: 'handle',
			guideRefs: [{ page: 14, text: "Step 4: tap lightly. Check the front isn't warped" }]
		},
		{
			slug: 'handle-right',
			name: 'Handle Right',
			section: 'Frame',
			defaultRole: 'primary',
			bomGrams: 445,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			brim: '10 mm',
			sourceFile: '3DTMT A2 HANDLE RIGHT REV A.STEP',
			notes: [WARP],
			allowedMaterials: PETG,
			symmetryGroup: 'handle',
			guideRefs: [{ page: 14, text: "Step 4: tap lightly. Check the front isn't warped" }]
		},
		{
			slug: 'footrest',
			name: 'Footrest',
			section: 'Frame',
			defaultRole: 'primary',
			bomGrams: 511,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'No',
			sourceFile: '3DTMT I FOOTREST COMBINED REV A.STEP',
			notes: [
				"One-piece footrest, on plate 24 of the X/P/A profile (plate 25 in MakeGood's original file; the small-rim plate is not used).",
				'Assembly: skip joining front and rear halves; go straight to step 15 and tighten the bolts until they show in the indicator slits.'
			],
			allowedMaterials: PETG,
			guideRefs: [
				{
					page: 17,
					text: 'One-piece footrest: skip joining halves. Step 15: tighten bolts until visible in the slits'
				}
			]
		},
		{
			slug: 'footrest-front',
			name: 'Footrest Front',
			section: 'Frame',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: '',
			sourceFile: '3DTMT I1 FOOTREST FRONT REV A.STEP',
			notes: ['Variant: two-piece footrest, replaces the one-piece footrest. Join the two halves.'],
			allowedMaterials: PETG,
			symmetryGroup: 'footrest-halves',
			guideRefs: [{ page: 17, text: 'Steps 13-16: join the footrest halves' }]
		},
		{
			slug: 'footrest-rear',
			name: 'Footrest Rear',
			section: 'Frame',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: '',
			sourceFile: '3DTMT I2 FOOTREST REAR REV A.STEP',
			notes: ['Variant: two-piece footrest, replaces the one-piece footrest. Join the two halves.'],
			allowedMaterials: PETG,
			symmetryGroup: 'footrest-halves',
			guideRefs: [{ page: 17, text: 'Steps 13-16: join the footrest halves' }]
		},
		{
			slug: 'storage-left',
			name: 'Storage Left',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: 572,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT D1 STORAGE LEFT REV A.STEP',
			notes: [],
			allowedMaterials: PETG,
			symmetryGroup: 'storage',
			guideRefs: [{ page: 14, text: 'Step 3: storage onto the side' }]
		},
		{
			slug: 'storage-right',
			name: 'Storage Right',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: 569,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT D2 STORAGE RIGHT REV A.STEP',
			notes: [],
			allowedMaterials: PETG,
			symmetryGroup: 'storage',
			guideRefs: [{ page: 14, text: 'Step 3: storage onto the side' }]
		},
		{
			slug: 'push-grip',
			name: 'Push Handle Grip',
			section: 'Frame',
			defaultRole: 'soft',
			bomGrams: 83,
			qty: 1,
			walls: 2,
			infill: '4%',
			supports: 'No',
			sourceFile: 'MG_PUSH HANDLE GRIP.step',
			notes: [
				'Named MG_PUSH HANDLE.step on plate 22.',
				'Note logo direction when installing (guide p22).'
			],
			allowedMaterials: TPU,
			guideRefs: [{ page: 22, text: 'Grip goes on last. Note logo direction' }]
		},
		{
			slug: 'push-top',
			name: 'Push Handle Top',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: 251,
			qty: 1,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT XX PUSH HANDLE TOP REV B.STEP',
			notes: [],
			allowedMaterials: PETG,
			guideRefs: [{ page: 21, text: 'Steps 28-31: push handle' }]
		},
		{
			slug: 'push-bottom',
			name: 'Push Handle Bottom',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: 459,
			qty: 1,
			walls: 4,
			infill: '20%',
			supports: 'Yes',
			sourceFile: '3DTMT XX PUSH HANDLE BOTTOM REV B V3.step',
			notes: ['Use V3. V2 and earlier are obsolete.'],
			allowedMaterials: PETG,
			guideRefs: [{ page: 21, text: 'Steps 28-29: push handle into the chair' }]
		},
		{
			slug: 'push-brace',
			name: 'Push Handle Brace',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: 166,
			qty: 2,
			walls: 10,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT XX PUSH HANDLE BRACE REV B.STEP',
			notes: [
				"Two braces print on plate 16 with the push handle top. There's no separate brace plate.",
				'The guide calls them brackets (steps 30-31).'
			],
			allowedMaterials: PETG,
			guideRefs: [{ page: 21, text: 'Steps 30-31: slide brackets around the joint' }]
		},
		{
			slug: 'push-pin',
			name: 'Push Handle Pin',
			section: 'Frame',
			defaultRole: 'accent',
			bomGrams: null,
			qty: 1,
			walls: 10,
			infill: '15%',
			supports: 'No',
			sourceFile: '3DTMT XX PUSH HANDLE PIN REV B.STEP',
			notes: ['Prints on plate 15 with the push handle bottom, in the Accent color.'],
			allowedMaterials: PETG,
			guideRefs: [{ page: 21, text: 'Steps 30-31: insert pin' }]
		},

		// ---- Accessories
		{
			slug: 'headrest-mount',
			name: 'Headrest Mount',
			section: 'Accessories',
			defaultRole: 'primary',
			bomGrams: 215,
			qty: 1,
			walls: 3,
			infill: '20%',
			supports: 'Yes',
			sourceFile: '3DTMT XX HEADREST MOUNT REV A.STEP',
			notes: ['Using headrest and push handle together: install the headrest first.'],
			allowedMaterials: PETG,
			guideRefs: [{ page: 22, text: 'Step 32: install before the push handle' }]
		},
		{
			slug: 'headrest-brace',
			name: 'Headrest Brace',
			section: 'Accessories',
			defaultRole: 'primary',
			bomGrams: 145,
			qty: 1,
			walls: null,
			infill: '',
			supports: '',
			sourceFile: 'MG_HEADREST BASE REV B',
			notes: [NOSHEET, NOEXT],
			allowedMaterials: PETG,
			guideRefs: [{ page: 22, text: 'Step 32: headrest' }]
		},
		{
			slug: 'headrest-bolt',
			name: 'Headrest Bolt',
			section: 'Accessories',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 1,
			walls: null,
			infill: '',
			supports: '',
			sourceFile: 'MG_HEADREST SCREW REV B',
			notes: [NOSHEET, NOEXT],
			allowedMaterials: PETG,
			guideRefs: [{ page: 22, text: 'Step 32: headrest' }]
		},
		{
			slug: 'connectors',
			name: 'Connectors',
			section: 'Accessories',
			defaultRole: 'primary',
			bomGrams: 451,
			qty: null,
			walls: null,
			infill: '',
			supports: 'No',
			sourceFile: 'Multiple files, see checklist',
			notes: [
				'Plate 12 also holds the two front caster mounts (REV C) and the two hub caps, which have their own rows so you can find them in the guide.',
				'Counts match plate 12 in the X/P/A profile.',
				'Print one frame pin and a washer first as a fit test.'
			],
			components: [
				{
					name: 'J Frame Pin ×6',
					file: '3DTMT J FRAME PIN REV A.STEP',
					settings: '15 walls · 15%'
				},
				{
					name: 'L Front Caster Pin ×2',
					file: '3DTMT L FRONT CASTER PIN REV A.STEP',
					settings: '15 walls · 15%'
				},
				{
					name: 'M Front Caster Pin Lock ×2',
					file: '3DTMT M FRONT CASTER PIN LOCK REV A.STEP',
					settings: '15 walls · 15%'
				},
				{
					name: 'N Wheel Block ×2',
					file: '3DTMT N WHEEL BLOCK REV A.STEP',
					settings: '30 walls · 15%'
				},
				{
					name: 'Q Wheel Pin ×8',
					file: '3DTMT Q WHEEL PIN REV A.STEP',
					settings: '15 walls · 15%'
				},
				{
					name: 'R Bearing Spacer ×2',
					file: '3DTMT R BEARING SPACER REV A.STEP',
					settings: '15 walls · 15%'
				},
				{ name: '4MM Washer ×2', file: '3DTMT 4MM WASHER.step', settings: '50 walls · 15%' }
			],
			allowedMaterials: PETG,
			guideRefs: [
				{ page: 14, text: 'Step 2: frame pin' },
				{ page: 15, text: 'Step 7: pin' },
				{ page: 16, text: 'Steps 11-12: caster pin and lock' },
				{ page: 18, text: 'Step 20: pins' },
				{ page: 19, text: 'Step 24: wheel pins' },
				{ page: 20, text: 'Steps 25-27: wheel block, spacer, washer' }
			]
		},
		{
			slug: 'buckles',
			name: 'Buckles and Slides',
			section: 'Accessories',
			defaultRole: 'primary',
			bomGrams: 131,
			qty: null,
			walls: 10,
			infill: '15%',
			supports: 'No',
			sourceFile: 'MakerWorld 3mf only (not in STEP pack)',
			notes: [
				'Plate 17: 3.2 cm buckles (side A ×2, side B ×2), 2.0 cm buckles (side A ×5, side B ×5), 30 mm slides ×4, 20 mm slides ×5.'
			],
			allowedMaterials: PETG,
			guideRefs: [
				{ page: 24, text: 'Buckles and slides' },
				{ page: 27, text: 'Large slides and large buckle' },
				{ page: 29, text: 'Storage strap buckle' }
			]
		},
		{
			slug: 'harness',
			name: 'Harness and Straps',
			section: 'Accessories',
			defaultRole: 'tire',
			bomGrams: 264,
			qty: null,
			walls: 2,
			infill: '8-15%',
			supports: 'No',
			sourceFile: 'MakerWorld 3mf only (not in STEP pack)',
			notes: [
				'The BOM lists navy TPU for the harness; the template defaults it to the Tire TPU role, but any TPU 95A color works.'
			],
			components: [
				{ name: 'Harness Right', settings: '2 walls · 8%' },
				{ name: 'Harness Left', settings: '2 walls · 8%' },
				{ name: 'Buckle Holder ×5', settings: '2 walls · 15%' },
				{ name: 'Harness Strap Long', settings: '2 walls · 15%' },
				{ name: 'Harness Strap Medium', settings: '2 walls · 15%' },
				{ name: 'Harness Strap Short', settings: '2 walls · 15%' },
				{ name: 'Lap Strap', settings: '2 walls · 15%' },
				{ name: 'Storage Strap', settings: '2 walls · 15%' },
				{ name: 'Footrest Strap ×3', settings: '2 walls · 15%' }
			],
			allowedMaterials: TPU,
			guideRefs: [
				{ page: 25, text: 'Harness: fold in half before inserting' },
				{ page: 26, text: 'Slide and buckle' },
				{ page: 27, text: 'Lap strap and footrest straps' },
				{ page: 28, text: 'Straps go under the chair' },
				{ page: 29, text: 'Storage strap' }
			]
		},

		// ---- Wheels
		{
			slug: 'tires',
			name: 'Tires',
			section: 'Wheels',
			defaultRole: 'tire',
			bomGrams: 901,
			qty: null,
			walls: 3,
			infill: '20%',
			supports: 'No',
			sourceFile: '3DTMT P TIRE REV A.STEP',
			notes: [
				'Plate 23 has 8 tire segments. Print it twice for 16.',
				'95A settings (3 walls, 20%). The KIT tire plate is for 98A TPU; skip it.',
				'2-part wheels: add tires to each half before joining (step 22).'
			],
			allowedMaterials: TPU,
			guideRefs: [{ page: 19, text: 'Step 22: tires on each half before joining' }]
		},
		{
			slug: 'rims-1-4',
			name: 'Wheel Rims 1 and 4',
			section: 'Wheels',
			defaultRole: 'accent',
			bomGrams: 477,
			qty: 2,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT O WHEEL RIM REV B.STEP',
			notes: [
				'Plate 13 holds one rim half (REV B, 2-part wheel). Print it twice in the Accent color.',
				"Weight is half the BOM's 954 g rim total.",
				'Handgrips go on the outside of the wheel (step 21).'
			],
			allowedMaterials: PETG,
			symmetryGroup: 'rims',
			guideRefs: [
				{ page: 19, text: 'Steps 21-24: handgrips on the outside' },
				{ page: 20, text: 'Steps 25-27: mount wheels' }
			]
		},
		{
			slug: 'rims-2-3',
			name: 'Wheel Rims 2 and 3',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: 477,
			qty: 2,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT O WHEEL RIM REV B.STEP',
			notes: [
				'Plate 13 holds one rim half (REV B, 2-part wheel). Print it twice in the Primary color.',
				"Weight is half the BOM's 954 g rim total."
			],
			allowedMaterials: PETG,
			symmetryGroup: 'rims',
			guideRefs: [
				{ page: 19, text: 'Steps 21-24: handgrips on the outside' },
				{ page: 20, text: 'Steps 25-27: mount wheels' }
			]
		},
		{
			slug: 'rims-small-1-4',
			name: 'Smaller Wheel Rims 1 and 4',
			section: 'Wheels',
			defaultRole: 'accent',
			bomGrams: null,
			qty: 2,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT O WHEEL RIM REV A.STEP',
			notes: [
				"Variant: smaller wheel, replaces the standard rims. MakeGood's plate 20 prints 4 halves; print 2 in the Accent color.",
				'Weight, walls and supports follow the standard rim until measured.'
			],
			allowedMaterials: PETG,
			symmetryGroup: 'rims-small',
			guideRefs: [{ page: 19, text: 'Steps 21-24: handgrips on the outside' }]
		},
		{
			slug: 'rims-small-2-3',
			name: 'Smaller Wheel Rims 2 and 3',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 2,
			walls: 2,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3DTMT O WHEEL RIM REV A.STEP',
			notes: [
				"Variant: smaller wheel, replaces the standard rims. MakeGood's plate 20 prints 4 halves; print 2 in the Primary color.",
				'Weight, walls and supports follow the standard rim until measured.'
			],
			allowedMaterials: PETG,
			symmetryGroup: 'rims-small',
			guideRefs: [{ page: 19, text: 'Steps 21-24: handgrips on the outside' }]
		},
		{
			slug: 'hub-caps',
			name: 'Hub Caps',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: 9,
			qty: 2,
			walls: 15,
			infill: '15%',
			supports: 'No',
			sourceFile: '3DTMT S BOLT CAP REV A.STEP',
			notes: ['Print with the connectors on plate 12, in the Primary color.'],
			allowedMaterials: PETG,
			guideRefs: [{ page: 20, text: 'Step 25: wheel cap on the axle bolt' }]
		},
		{
			slug: 'front-caster-mount',
			name: 'Front Caster Mount',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 2,
			walls: 10,
			infill: '15%',
			supports: 'Yes',
			sourceFile: '3D TMT K FRONT CASTER MOUNT REV C.step',
			notes: [
				"REV C, confirmed: it's what plate 12 uses. It prints on the connectors plate, so it comes out in the Primary color with the pins."
			],
			allowedMaterials: PETG,
			guideRefs: [{ page: 16, text: 'Steps 9-12: tap caster in lightly' }]
		},
		{
			slug: 'rear-caster-left',
			name: 'Rear Caster Mount Left (KIT)',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 1,
			walls: 4,
			infill: '20%',
			supports: 'Yes',
			sourceFile: '3DTMT E1 CASTER MOUNT REAR LEFT REV A KIT.step',
			notes: [`${KITCASTER} E1 file.`],
			allowedMaterials: PETG,
			symmetryGroup: 'rear-caster-mount',
			guideRefs: [{ page: 15, text: 'Steps 6-8: rear caster mounts' }]
		},
		{
			slug: 'rear-caster-right',
			name: 'Rear Caster Mount Right (KIT)',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 1,
			walls: 4,
			infill: '20%',
			supports: 'Yes',
			sourceFile: '3DTMT E2 CASTER MOUNT REAR RIGHT REV A KIT.step',
			notes: [`${KITCASTER} E2 file.`],
			allowedMaterials: PETG,
			symmetryGroup: 'rear-caster-mount',
			guideRefs: [{ page: 15, text: 'Steps 6-8: rear caster mounts' }]
		},
		{
			slug: 'rear-caster-left-mcmaster',
			name: 'Rear Caster Mount Left (McMaster)',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 1,
			walls: 4,
			infill: '20%',
			supports: 'Yes',
			sourceFile: '3DTMT E1 CASTER MOUNT REAR LEFT REV A.STEP',
			notes: ['Variant: for the McMaster-Carr caster instead of the kit caster. E1 file.'],
			allowedMaterials: PETG,
			symmetryGroup: 'rear-caster-mount-mcmaster',
			guideRefs: [{ page: 15, text: 'Steps 6-8: rear caster mounts' }]
		},
		{
			slug: 'rear-caster-right-mcmaster',
			name: 'Rear Caster Mount Right (McMaster)',
			section: 'Wheels',
			defaultRole: 'primary',
			bomGrams: null,
			qty: 1,
			walls: 4,
			infill: '20%',
			supports: 'Yes',
			sourceFile: '3DTMT E2 CASTER MOUNT REAR RIGHT REV A.STEP',
			notes: ['Variant: for the McMaster-Carr caster instead of the kit caster. E2 file.'],
			allowedMaterials: PETG,
			symmetryGroup: 'rear-caster-mount-mcmaster',
			guideRefs: [{ page: 15, text: 'Steps 6-8: rear caster mounts' }]
		}
	],
	plates: [
		{ number: 1, name: 'Handle Left', estSeconds: 47232, runs: 1, parts: ['handle-left'] },
		{ number: 2, name: 'Handle Right', estSeconds: 47304, runs: 1, parts: ['handle-right'] },
		{
			number: 3,
			name: 'Wheel Mount Left',
			estSeconds: 55764,
			runs: 1,
			parts: ['wheel-mount-left']
		},
		{
			number: 4,
			name: 'Wheel Mount Right',
			estSeconds: 55476,
			runs: 1,
			parts: ['wheel-mount-right']
		},
		{ number: 5, name: 'Wing Right', estSeconds: 44964, runs: 1, parts: ['wing-right'] },
		{ number: 6, name: 'Wing Left', estSeconds: 45036, runs: 1, parts: ['wing-left'] },
		{ number: 7, name: 'Storage Right', estSeconds: 54396, runs: 1, parts: ['storage-right'] },
		{ number: 8, name: 'Storage Left', estSeconds: 54648, runs: 1, parts: ['storage-left'] },
		{
			number: 9,
			name: 'Caster Mount (Kit)',
			estSeconds: 51948,
			runs: 1,
			parts: ['rear-caster-left', 'rear-caster-right']
		},
		{
			number: 10,
			name: 'Seat Back',
			estSeconds: 25380,
			runs: 1,
			parts: ['seat-back-top', 'seat-back-bottom']
		},
		{ number: 11, name: 'Seat Center', estSeconds: 19908, runs: 1, parts: ['seat-center'] },
		{
			number: 12,
			name: 'Connectors',
			estSeconds: 43452,
			runs: 1,
			parts: ['connectors', 'front-caster-mount', 'hub-caps']
		},
		{
			number: 13,
			name: 'Wheel Rim',
			estSeconds: 34992,
			runs: 2,
			runNote: 'Print 4 times: 2 in the Accent color, 2 in the Primary color',
			perPartRuns: true,
			parts: ['rims-1-4', 'rims-2-3']
		},
		{
			number: 14,
			name: 'Headrest',
			estSeconds: 44460,
			runs: 1,
			parts: ['headrest-mount', 'headrest-brace', 'headrest-bolt']
		},
		{
			number: 15,
			name: 'Push Handle Bottom',
			estSeconds: 51192,
			runs: 1,
			parts: ['push-bottom', 'push-pin']
		},
		{
			number: 16,
			name: 'Push Handle Top',
			estSeconds: 43416,
			runs: 1,
			parts: ['push-top', 'push-brace']
		},
		{ number: 17, name: 'Buckles and Slides', estSeconds: 15156, runs: 1, parts: ['buckles'] },
		{ number: 18, name: 'TPU Harness and Straps', estSeconds: 45036, runs: 1, parts: ['harness'] },
		{ number: 19, name: 'TPU Cushion Base', estSeconds: 37548, runs: 1, parts: ['cushion-base'] },
		{ number: 20, name: 'TPU Cushion Back', estSeconds: 41976, runs: 1, parts: ['cushion-top'] },
		{ number: 21, name: 'TPU Headrest', estSeconds: 14868, runs: 1, parts: ['soft-headrest'] },
		{ number: 22, name: 'TPU Push Handle Grip', estSeconds: 16020, runs: 1, parts: ['push-grip'] },
		{
			number: 23,
			name: 'TPU 95A Tires',
			estSeconds: 167796,
			runs: 2,
			runNote: 'Print twice',
			parts: ['tires']
		},
		{ number: 24, name: 'Footrest 1-Piece', estSeconds: 44244, runs: 1, parts: ['footrest'] }
	],
	guidePages: [
		{ page: 8, title: 'Exploded view (all parts)', sort: 0 },
		{ page: 12, title: 'Print settings overview', sort: 1 },
		{ page: 14, title: 'Steps 1-4: side assembly', sort: 2 },
		{ page: 15, title: 'Steps 5-8: rear caster', sort: 3 },
		{ page: 16, title: 'Steps 9-12: front casters', sort: 4 },
		{ page: 17, title: 'Steps 13-16: footrest', sort: 5 },
		{ page: 18, title: 'Steps 17-20: seat back', sort: 6 },
		{ page: 19, title: 'Steps 21-24: wheels', sort: 7 },
		{ page: 20, title: 'Steps 25-27: mount wheels', sort: 8 },
		{ page: 21, title: 'Steps 28-31: push handle', sort: 9 },
		{ page: 22, title: 'Step 32: headrest and grip', sort: 10 },
		{ page: 23, title: 'Cushions', sort: 11 },
		{ page: 24, title: 'Buckles and slides', sort: 12 },
		{ page: 25, title: 'Harness', sort: 13 },
		{ page: 26, title: 'Harness straps', sort: 14 },
		{ page: 27, title: 'Lap and footrest straps', sort: 15 },
		{ page: 28, title: 'Straps under the chair', sort: 16 },
		{ page: 29, title: 'Storage strap', sort: 17 },
		{ page: 31, title: 'Safety checks', sort: 18 }
	],
	hardware: [
		{ name: 'Casters', note: 'Kit hardware' },
		{ name: 'Axle bolts', note: 'Kit hardware' },
		{ name: 'Footrest bolts', note: 'Kit hardware' },
		{ name: 'Nuts', note: 'Kit hardware' },
		{ name: 'Bearings', note: 'Kit hardware' },
		{
			name: 'Sticky-back velcro',
			note: 'Not in the kit. Attaches the seat cushions and headrest cushion.'
		}
	],
	designs: [
		{
			slug: 'columbus-4691-blues',
			name: 'Columbus #4691 Blues',
			roles: [
				{ key: 'primary', name: 'Overture Blue', material: 'PETG', hex: '#034E89' },
				{ key: 'accent', name: 'Overture Digital Blue', material: 'PETG', hex: '#0378D0' },
				{ key: 'soft', name: 'Overture Digital Blue', material: 'TPU 95A', hex: '#0378D0' },
				{ key: 'tire', name: 'Overture Black', material: 'TPU 95A', hex: '#1c1c20' }
			],
			partRoles: {
				'seat-center': 'primary',
				'seat-back-top': 'primary',
				'seat-back-bottom': 'primary',
				'cushion-top': 'soft',
				'cushion-base': 'soft',
				'soft-headrest': 'soft',
				'wing-left': 'accent',
				'wing-right': 'accent',
				'wheel-mount-left': 'primary',
				'wheel-mount-right': 'primary',
				'handle-left': 'primary',
				'handle-right': 'primary',
				footrest: 'primary',
				'storage-left': 'accent',
				'storage-right': 'accent',
				'push-grip': 'soft',
				'push-top': 'accent',
				'push-bottom': 'accent',
				'push-brace': 'accent',
				'push-pin': 'accent',
				'headrest-mount': 'primary',
				'headrest-brace': 'primary',
				'headrest-bolt': 'primary',
				connectors: 'primary',
				buckles: 'primary',
				harness: 'tire',
				tires: 'tire',
				'rims-1-4': 'accent',
				'rims-2-3': 'primary',
				'hub-caps': 'primary',
				'front-caster-mount': 'primary',
				'rear-caster-left': 'primary',
				'rear-caster-right': 'primary'
			}
		}
	],
	variantGroups: [
		{
			key: 'seat',
			name: 'Seat',
			defaultOption: 'cushions',
			options: [
				{
					key: 'cushions',
					name: 'Cushions',
					description: 'Two TPU cushions (base and back) stuck on with velcro.',
					parts: ['cushion-top', 'cushion-base']
				},
				{
					key: 'bucket-seat',
					name: 'Foaming TPU bucket seat',
					description:
						'One foaming TPU 90A seat shell instead of the two cushions. The soft headrest cushion stays.',
					parts: ['bucket-seat']
				}
			]
		},
		{
			key: 'rear-caster',
			name: 'Rear caster',
			defaultOption: 'kit',
			options: [
				{
					key: 'kit',
					name: 'Kit caster',
					description: 'Mounts for the caster that comes in the MakeGood hardware kit.',
					parts: ['rear-caster-left', 'rear-caster-right']
				},
				{
					key: 'mcmaster',
					name: 'McMaster caster',
					description: 'Mounts for the McMaster-Carr caster you buy yourself.',
					parts: ['rear-caster-left-mcmaster', 'rear-caster-right-mcmaster']
				}
			]
		},
		{
			key: 'footrest',
			name: 'Footrest',
			defaultOption: 'one-piece',
			options: [
				{
					key: 'one-piece',
					name: 'One piece',
					description: 'A single large print; needs a big enough printer bed.',
					parts: ['footrest']
				},
				{
					key: 'two-piece',
					name: 'Two pieces',
					description: 'Front and rear halves that are joined at assembly; fits smaller printers.',
					parts: ['footrest-front', 'footrest-rear']
				}
			]
		},
		{
			key: 'rim',
			name: 'Wheel rim',
			defaultOption: 'standard',
			options: [
				{
					key: 'standard',
					name: 'Standard rims',
					description: 'Rim REV B, four halves in two colors.',
					parts: ['rims-1-4', 'rims-2-3']
				},
				{
					key: 'smaller',
					name: 'Smaller rims',
					description:
						'Rim REV A, a smaller wheel for printers with a smaller bed; four halves in two colors.',
					parts: ['rims-small-1-4', 'rims-small-2-3']
				}
			]
		}
	],
	// Placements from the STEP/assembly spike (numbers only; the geometry is imported per install).
	// Identity means the part's STEP file already sits in the assembly frame.
	// Wheel axis for later manual placement of rims and tires: along x, centres x = +-208.3, y = 145, z = -300.
	// Not placed: no STEP in the assembly frame or not measured. The variant parts (bucket seat, two-piece
	// footrest, McMaster rear casters, smaller rims) were not measured in the spike, so they are not placed
	// yet; they also sit on no plate until Milestone 5 adds per-printer plate layouts.
	placements: [
		...placedAtOrigin(
			'seat-center',
			'seat-back-top',
			'seat-back-bottom',
			'wing-left',
			'wing-right',
			'wheel-mount-left',
			'wheel-mount-right',
			'handle-left',
			'handle-right',
			'storage-left',
			'storage-right',
			'cushion-top',
			'cushion-base',
			'rear-caster-left',
			'rear-caster-right',
			'footrest', // about 2 mm off the assembly, fine
			'push-top',
			'push-bottom',
			'push-pin',
			'headrest-mount' // plausible, not verified
		),
		// Single brace at x = -46 (the file spans x -92..0). A mirrored second brace is not supported by the data.
		{ slug: 'push-brace', matrix: IDENTITY, placed: true },
		// Derived from the assembly: hub caps at x = +-231.4 on the wheel axis.
		{ slug: 'hub-caps', matrix: HUB_CAP_RIGHT, instances: [HUB_CAP_LEFT], placed: true },
		// GUESS: the connector files (J frame pin, L front caster pin, M pin lock, N wheel block) are identity,
		// and the second instance mirrors all of them across x = 0. Exact for J, L and M; N may be off by 0.5 mm.
		{ slug: 'connectors', matrix: IDENTITY, instances: [MIRROR_X], placed: true },
		...[
			'push-grip',
			'soft-headrest',
			'headrest-brace',
			'headrest-bolt',
			'front-caster-mount',
			'buckles',
			'harness',
			'rims-1-4',
			'rims-2-3',
			'tires',
			'bucket-seat',
			'footrest-front',
			'footrest-rear',
			'rear-caster-left-mcmaster',
			'rear-caster-right-mcmaster',
			'rims-small-1-4',
			'rims-small-2-3'
		].map((slug) => ({ slug, matrix: IDENTITY, placed: false }))
	]
};

/**
 * The H-series profile (Bambu H2D / H2S): 21 plates. Names and groupings follow
 * MakeGood's profile; the file is unsliced, so no times. The foaming bucket seat
 * has no plate in either profile (it ships as a separate foaming-TPU file).
 */
const H2D_PLATES: PlateSeed[] = [
	{
		number: 1,
		name: 'Handle Left and Storage Right',
		estSeconds: null,
		runs: 1,
		parts: ['handle-left', 'storage-right']
	},
	{
		number: 2,
		name: 'Handle Right and Storage Left',
		estSeconds: null,
		runs: 1,
		parts: ['storage-left', 'handle-right']
	},
	{ number: 3, name: 'Wheel Mount Left', estSeconds: null, runs: 1, parts: ['wheel-mount-left'] },
	{ number: 4, name: 'Wheel Mount Right', estSeconds: null, runs: 1, parts: ['wheel-mount-right'] },
	{ number: 5, name: 'Wing Left', estSeconds: null, runs: 1, parts: ['wing-left'] },
	{ number: 6, name: 'Wing Right', estSeconds: null, runs: 1, parts: ['wing-right'] },
	{
		number: 7,
		name: 'Seat Back and Center',
		estSeconds: null,
		runs: 1,
		parts: ['seat-back-top', 'seat-back-bottom', 'seat-center']
	},
	{
		number: 8,
		name: 'Caster Mount (McMaster)',
		estSeconds: null,
		runs: 1,
		parts: ['rear-caster-left-mcmaster', 'rear-caster-right-mcmaster']
	},
	{
		number: 9,
		name: 'Caster Mount (Kit)',
		estSeconds: null,
		runs: 1,
		parts: ['rear-caster-left', 'rear-caster-right']
	},
	{
		number: 10,
		name: 'Headrest and Footrest',
		estSeconds: null,
		runs: 1,
		parts: ['headrest-mount', 'headrest-brace', 'headrest-bolt', 'footrest-front', 'footrest-rear']
	},
	{
		number: 11,
		name: 'Connectors, Buckles and Slides',
		estSeconds: null,
		runs: 1,
		parts: ['connectors', 'front-caster-mount', 'hub-caps', 'buckles']
	},
	{
		number: 12,
		name: 'Wheel Rim',
		estSeconds: null,
		runs: 2,
		runNote: 'Print 4 times: 2 in the Accent color, 2 in the Primary color',
		perPartRuns: true,
		parts: ['rims-1-4', 'rims-2-3']
	},
	{
		number: 13,
		name: 'Push Handle',
		estSeconds: null,
		runs: 1,
		parts: ['push-top', 'push-bottom', 'push-brace', 'push-pin']
	},
	{ number: 14, name: 'TPU Harness and Straps', estSeconds: null, runs: 1, parts: ['harness'] },
	{ number: 15, name: 'TPU Cushion Base', estSeconds: null, runs: 1, parts: ['cushion-base'] },
	{ number: 16, name: 'TPU Cushion Back', estSeconds: null, runs: 1, parts: ['cushion-top'] },
	{ number: 17, name: 'TPU Headrest', estSeconds: null, runs: 1, parts: ['soft-headrest'] },
	{ number: 18, name: 'TPU Push Handle Grip', estSeconds: null, runs: 1, parts: ['push-grip'] },
	{
		number: 19,
		name: 'TPU 95A Tires',
		estSeconds: null,
		runs: 1,
		runNote: 'All 16 tire segments are on this one plate',
		parts: ['tires']
	},
	{
		number: 20,
		name: 'Wheel Rim Smaller',
		estSeconds: null,
		runs: 1,
		runNote: 'Two halves per print: once in the Accent color, once in the Primary color',
		perPartRuns: true,
		parts: ['rims-small-1-4', 'rims-small-2-3']
	},
	{ number: 21, name: 'Footrest 1-Piece', estSeconds: null, runs: 1, parts: ['footrest'] }
];

tmtTemplate.plateLayouts = [
	{
		key: 'xpa',
		name: 'Bambu X1 / P1 / A1',
		printerNote: 'MakeGood X/P/A series profile: 24 plates for 256 mm class beds.',
		isDefault: true,
		plates: tmtTemplate.plates
	},
	{
		key: 'h2d',
		name: 'Bambu H2D / H2S',
		printerNote: 'MakeGood H series profile: 21 plates for the larger H2D / H2S bed.',
		plates: H2D_PLATES
	}
];

/**
 * Print footprints (numbers only) per part: the kit author's H-series print orientation,
 * turned about z to the smallest bounding box, in mm. Measured from the profile 3MF by the
 * print geometry import, so installs without the import can still plan plates.
 * `copies` is per unit; `unitsPerPlate` is how many units one plate run holds (rims: 1 of 2).
 * Some parts are bigger than a 256 mm bed in this orientation (wings, footrest, bucket seat):
 * MakeGood's X/P/A profile prints them differently.
 */
tmtTemplate.printFootprints = [
	{
		slug: 'bucket-seat',
		w: 279.1,
		d: 215.1,
		h: 324.7,
		unitsPerPlate: 1,
		hull: [
			[-142, -104.5],
			[-136.5, -110],
			[136.5, -110],
			[142, -104.5],
			[142, 8.2],
			[140.6, 24.7],
			[129.9, 56.3],
			[115.8, 76.4],
			[107.3, 84.6],
			[82.6, 100.7],
			[63.3, 107.3],
			[40.2, 110],
			[-40.1, 110],
			[-67.5, 106.3],
			[-86.3, 99],
			[-108.4, 83.7],
			[-124.5, 65.2],
			[-132.1, 51.9],
			[-139.6, 30.1],
			[-142, 8.2]
		]
	},
	{
		slug: 'buckles',
		unitsPerPlate: 1,
		pieces: [
			{ name: '3.2 cm - Side A.stl', w: 53.5, d: 44, h: 12, copies: 2 },
			{ name: '3.2 cm - Side B.stl', w: 49.3, d: 46, h: 12, copies: 2 },
			{ name: '2.0 cm - Side A.stl', w: 53.5, d: 32.4, h: 10, copies: 5 },
			{ name: '2.0 cm - Side B.stl', w: 46, d: 37.7, h: 10, copies: 5 },
			{ name: 'TMT3D - SLIDE 30MM.step', w: 38, d: 28, h: 2.5, copies: 4 },
			{ name: 'TMT3D - SLIDE 20MM.step', w: 26, d: 26, h: 2.5, copies: 5 }
		]
	},
	{
		slug: 'connectors',
		unitsPerPlate: 1,
		pieces: [
			{ name: '3DTMT J FRAME PIN REV A.STEP', w: 25.1, d: 20.1, h: 21.6, copies: 6 },
			{ name: '3DTMT L FRONT CASTER PIN REV A.STEP', w: 40, d: 18.4, h: 10.1, copies: 2 },
			{ name: '3DTMT M FRONT CASTER PIN LOCK REV A.STEP', w: 30, d: 25, h: 10.1, copies: 2 },
			{ name: '3DTMT N WHEEL BLOCK REV A.STEP', w: 58.5, d: 28.4, h: 46.1, copies: 2 },
			{ name: '3DTMT R BEARING SPACER REV A.STEP', w: 13, d: 13, h: 27, copies: 2 },
			{ name: '3DTMT Q WHEEL PIN REV A.STEP', w: 20, d: 16.1, h: 38.8, copies: 8 },
			{ name: '3DTMT 4MM WASHER.step', w: 35, d: 35, h: 4, copies: 2 }
		]
	},
	{
		slug: 'cushion-base',
		w: 278.3,
		d: 20.1,
		h: 214.7,
		unitsPerPlate: 1,
		hull: [
			[135.3, 10.7],
			[-135.1, 10.7],
			[-137.1, 10.3],
			[-139.4, 7.7],
			[-139.7, 5.3],
			[-137.9, 0.4],
			[-133.5, -5.5],
			[-130.3, -7.7],
			[-124.4, -10.2],
			[-119.8, -10.6],
			[-40, -10.7],
			[87, -10.7],
			[119.9, -10.6],
			[124.4, -10.2],
			[130.2, -7.7],
			[133.5, -5.5],
			[135.5, -3.3],
			[138, 0.4],
			[139.7, 6.3],
			[138.5, 9.2]
		]
	},
	{
		slug: 'cushion-top',
		w: 274.8,
		d: 82.8,
		h: 224.7,
		unitsPerPlate: 1,
		hull: [
			[-134.9, -43.3],
			[134.9, -43.3],
			[139.5, -38.4],
			[135.8, -24.8],
			[128.8, -9],
			[120.6, 3.4],
			[107, 18],
			[98.4, 24.7],
			[83.1, 33.7],
			[65.4, 40.1],
			[40, 43.3],
			[-40, 43.3],
			[-61.9, 40.9],
			[-80.9, 34.7],
			[-92.1, 28.9],
			[-107.3, 17.8],
			[-116.9, 8.1],
			[-124.8, -2.4],
			[-133.2, -18.1],
			[-139.5, -38.4]
		]
	},
	{
		slug: 'footrest',
		w: 276,
		d: 220,
		h: 64,
		unitsPerPlate: 1,
		hull: [
			[-141.2, -76.3],
			[-138.4, -90.3],
			[-128.7, -103.9],
			[-104.5, -113.2],
			[104.5, -113.2],
			[128.7, -103.9],
			[138.4, -90.3],
			[141.2, -76.3],
			[141.2, 50.2],
			[139.6, 64.2],
			[126.9, 90],
			[113.1, 102.6],
			[92.2, 111.6],
			[78.2, 113.2],
			[-78.2, 113.2],
			[-92.2, 111.6],
			[-113.1, 102.6],
			[-126.9, 90],
			[-139.6, 64.2],
			[-141.2, 50.2]
		]
	},
	{
		slug: 'footrest-front',
		w: 276,
		d: 57.5,
		h: 148.1,
		unitsPerPlate: 1,
		hull: [
			[133, -28.9],
			[133.9, -28.8],
			[135.1, -28.4],
			[135.9, -27.8],
			[137.2, -26.2],
			[137.8, -25.2],
			[138.2, -22.9],
			[138.2, 26.8],
			[136.2, 28.7],
			[135.2, 28.9],
			[-135.2, 28.9],
			[-136.2, 28.7],
			[-138.2, 26.8],
			[-138.2, -22.9],
			[-137.9, -24.7],
			[-137.6, -25.7],
			[-137, -26.5],
			[-135.8, -27.9],
			[-134.3, -28.7],
			[-133, -28.9]
		]
	},
	{
		slug: 'footrest-rear',
		w: 276,
		d: 64,
		h: 168.3,
		unitsPerPlate: 1,
		hull: [
			[135.2, -32.2],
			[136.2, -31.9],
			[138.2, -30],
			[138.2, 27],
			[138, 28.4],
			[137.1, 30.1],
			[136.1, 31.1],
			[135.3, 31.6],
			[134, 32.1],
			[133, 32.2],
			[-133, 32.2],
			[-134, 32.1],
			[-135.3, 31.6],
			[-136.1, 31.1],
			[-137.1, 30.1],
			[-138, 28.4],
			[-138.2, 27],
			[-138.2, -30],
			[-136.2, -31.9],
			[-135.2, -32.2]
		]
	},
	{
		slug: 'front-caster-mount',
		w: 112.1,
		d: 56.6,
		h: 37.5,
		unitsPerPlate: 2,
		hull: [
			[-56.7, 2.5],
			[-55.6, -12.4],
			[-54.9, -13.8],
			[-40, -28.2],
			[-39, -28.6],
			[39.1, -28.9],
			[40.4, -28.2],
			[55, -13.7],
			[55.6, -12.4],
			[56.7, 2.5],
			[55.5, 5.8],
			[33.7, 22.3],
			[32, 23.4],
			[19.4, 27],
			[8.4, 28.6],
			[-3.8, 28.9],
			[-14.9, 27.8],
			[-27.3, 25],
			[-32, 23.4],
			[-55.5, 5.7]
		]
	},
	{
		slug: 'handle-left',
		w: 231.6,
		d: 140.1,
		h: 244.9,
		unitsPerPlate: 1,
		hull: [
			[113.5, -70.6],
			[115.8, -69.3],
			[116.4, -67.8],
			[116.4, -52.7],
			[114.5, -47.7],
			[25.1, 60.2],
			[15.9, 69.8],
			[14.4, 70.6],
			[-53.5, 70.6],
			[-54.4, 70.4],
			[-73.6, 60.4],
			[-74, 60],
			[-115.6, -33.4],
			[-116.4, -36.7],
			[-116.4, -49.5],
			[-114.7, -53.2],
			[-109.8, -58.4],
			[-108.4, -59.3],
			[-84, -70.3],
			[-82.5, -70.6]
		]
	},
	{
		slug: 'handle-right',
		w: 231.6,
		d: 140.1,
		h: 244.9,
		unitsPerPlate: 1,
		hull: [
			[-53, -70.6],
			[14.4, -70.6],
			[15.9, -69.9],
			[25.2, -60.2],
			[114.3, 47.5],
			[115.7, 49.5],
			[116.4, 52.6],
			[116.4, 67.8],
			[115.4, 69.9],
			[113.5, 70.6],
			[-82.5, 70.6],
			[-84, 70.3],
			[-108.5, 59.3],
			[-114.7, 53.2],
			[-116.4, 49.5],
			[-116.4, 36.7],
			[-115.6, 33.3],
			[-74, -60],
			[-73.6, -60.4],
			[-54.5, -70.4]
		]
	},
	{
		slug: 'harness',
		unitsPerPlate: 1,
		pieces: [
			{ name: 'TMT3D - HARNESS RIGHT', w: 227.9, d: 103.5, h: 10, copies: 1 },
			{ name: 'TMT3D - HARNESS LEFT', w: 228.1, d: 69.7, h: 10, copies: 1 },
			{ name: 'TMT3D - BUCKLE HOLDER.step', w: 43.6, d: 20, h: 16.5, copies: 5 },
			{ name: '3DTMT - STORAGE STRAP', w: 74.6, d: 73.7, h: 30, copies: 1 },
			{ name: '3DTMT - HARNESS STRAP LONG', w: 91.3, d: 90.6, h: 19.5, copies: 1 },
			{ name: '3DTMT - FOOTREST STRAP', w: 45.9, d: 44.9, h: 20, copies: 3 },
			{ name: '3DTMT - HARNESS STRAP MEDIUM', w: 45.9, d: 44.9, h: 20, copies: 1 },
			{ name: '3DTMT - HARNESS STRAP SHORT', w: 45.9, d: 44.9, h: 20, copies: 1 },
			{ name: '3DTMT - LAP STRAP', w: 91.3, d: 90.6, h: 30, copies: 1 }
		]
	},
	{
		slug: 'headrest-bolt',
		w: 51,
		d: 39.5,
		h: 25,
		unitsPerPlate: 1,
		hull: [
			[-16.1, -19.8],
			[-7.5, -18.8],
			[24.4, -6.6],
			[25.7, -5.6],
			[25.7, 5.4],
			[25.3, 6],
			[-7.6, 18.2],
			[-8, 18.3],
			[-15.9, 19.8],
			[-17.1, 19.8],
			[-23.3, 18.3],
			[-23.8, 18.1],
			[-25.1, 17],
			[-25.7, 15.2],
			[-25.7, -15.8],
			[-25.3, -17.3],
			[-24.7, -17.9],
			[-23.8, -18.7],
			[-23, -18.9],
			[-16.9, -19.8]
		]
	},
	{
		slug: 'headrest-brace',
		w: 250.4,
		d: 86.7,
		h: 76.2,
		unitsPerPlate: 1,
		hull: [
			[111.7, -44.6],
			[114.5, -43.9],
			[125.1, -37.4],
			[125.8, -30.5],
			[103, 9],
			[96.6, 17.4],
			[92.3, 21.2],
			[85.7, 25.3],
			[76.5, 28.5],
			[7.1, 44.6],
			[-7.1, 44.6],
			[-76.5, 28.5],
			[-85.7, 25.3],
			[-94.5, 19.3],
			[-98.5, 15.3],
			[-102.9, 9],
			[-125.8, -30.5],
			[-125.1, -37.4],
			[-114.5, -43.9],
			[-111.7, -44.6]
		]
	},
	{
		slug: 'headrest-mount',
		w: 226.3,
		d: 160,
		h: 208.8,
		unitsPerPlate: 1,
		hull: [
			[10.9, -81.1],
			[20.1, -78.1],
			[105.3, -24.1],
			[110.3, -19.2],
			[112.8, -13.7],
			[114, -8.5],
			[114.2, 5],
			[112.9, 13.7],
			[110.3, 19.2],
			[105.3, 24.1],
			[20.1, 78.1],
			[10.9, 81.1],
			[-102.7, 81.1],
			[-107.7, 79.4],
			[-112.9, 72.3],
			[-114.2, 65.1],
			[-114.2, -65.1],
			[-112.9, -72.3],
			[-107.7, -79.4],
			[-102.7, -81.1]
		]
	},
	{
		slug: 'hub-caps',
		w: 36.8,
		d: 36.8,
		h: 8.2,
		unitsPerPlate: 2,
		hull: [
			[-19.1, -0.5],
			[-17.8, -7],
			[-16.6, -9.6],
			[-12.2, -14.7],
			[-7.3, -17.7],
			[-3.2, -18.9],
			[5, -18.5],
			[12.2, -14.7],
			[16.6, -9.6],
			[17.8, -7],
			[19.1, -0.5],
			[17.9, 6.6],
			[15.1, 11.8],
			[12.7, 14.3],
			[8.7, 17.1],
			[3.7, 18.8],
			[-1.8, 19],
			[-8.7, 17.1],
			[-15, 11.8],
			[-17.9, 6.7]
		]
	},
	{
		slug: 'push-bottom',
		w: 193,
		d: 160.1,
		h: 249.2,
		unitsPerPlate: 1,
		hull: [
			[-85.3, -80.6],
			[83.2, -80.6],
			[84.7, -79.9],
			[89.5, -74.4],
			[96.9, -59],
			[97.1, -58],
			[97.1, 58],
			[96.9, 59],
			[89.5, 74.4],
			[84.7, 79.9],
			[83.2, 80.6],
			[-85.3, 80.6],
			[-88.9, 79.8],
			[-93.2, 76.5],
			[-96.4, 70.4],
			[-97.1, 65],
			[-97.1, -65],
			[-96.3, -70.7],
			[-93.2, -76.6],
			[-89.2, -79.7]
		]
	},
	{
		slug: 'push-brace',
		w: 92.1,
		d: 54.1,
		h: 40.1,
		unitsPerPlate: 2,
		hull: [
			[-46.3, 4.2],
			[-46.3, -8.2],
			[-45.8, -11.8],
			[-45.2, -13.9],
			[-43.9, -16],
			[-42.1, -18.3],
			[-37.2, -23.1],
			[-34.3, -25.4],
			[-31.7, -26.6],
			[-27.2, -27.3],
			[46.3, -27.3],
			[46.3, 27.3],
			[-23.2, 27.3],
			[-25.6, 27.1],
			[-27.7, 26.6],
			[-30.3, 25.4],
			[-33.3, 23.1],
			[-42.1, 14.3],
			[-44.8, 10.6],
			[-46, 7]
		]
	},
	{
		slug: 'push-grip',
		w: 50.2,
		d: 50.1,
		h: 200.1,
		unitsPerPlate: 1,
		hull: [
			[-25.8, -4],
			[-24, -10.5],
			[-17.7, -19.3],
			[-11.1, -23.6],
			[-6.2, -25.3],
			[0.1, -26.1],
			[11, -23.7],
			[17.7, -19.3],
			[24, -10.5],
			[25.8, -4],
			[25.8, 4],
			[24, 10.4],
			[21.7, 14.5],
			[15, 21.4],
			[7.4, 25],
			[-2.4, 26],
			[-11.1, 23.7],
			[-20.1, 16.8],
			[-24, 10.6],
			[-25.8, 4]
		]
	},
	{
		slug: 'push-pin',
		w: 26.1,
		d: 20.1,
		h: 47.2,
		unitsPerPlate: 1,
		hull: [
			[-5.5, -10.2],
			[5.5, -10.2],
			[6.3, -9.9],
			[12.3, -6.3],
			[12.8, -5.8],
			[13.2, -5],
			[13.2, 5],
			[12.7, 6],
			[12.3, 6.3],
			[6.3, 9.9],
			[5.5, 10.2],
			[-5.5, 10.2],
			[-6.3, 9.9],
			[-12.3, 6.3],
			[-12.7, 6],
			[-13.2, 5],
			[-13.2, -5],
			[-12.7, -6],
			[-12.3, -6.3],
			[-6.3, -10]
		]
	},
	{
		slug: 'push-top',
		w: 211.8,
		d: 160,
		h: 209,
		unitsPerPlate: 1,
		hull: [
			[91.1, -80.9],
			[98.9, -70.8],
			[104.7, -59.4],
			[106.8, -51.2],
			[105, 58.1],
			[98.9, 70.8],
			[92.4, 80],
			[91, 80.9],
			[-84.3, 80.9],
			[-89.7, 80],
			[-94.5, 77.6],
			[-99.7, 72.7],
			[-105.1, 61.9],
			[-106.8, 52.5],
			[-106.8, -52.5],
			[-105.1, -62.2],
			[-101.5, -70],
			[-98.3, -74.2],
			[-93.3, -78.3],
			[-84.3, -80.9]
		]
	},
	{
		slug: 'rear-caster-left',
		w: 207.6,
		d: 93.6,
		h: 104.8,
		unitsPerPlate: 1,
		hull: [
			[-123.5, -46.4],
			[-119.9, -53.6],
			[-107, -66.5],
			[111.4, -66.5],
			[123.5, -54.4],
			[123.5, -45.5],
			[118.6, 50],
			[116.1, 57.3],
			[110.5, 62.9],
			[103.3, 66.5],
			[69.1, 66.5],
			[-107.9, 1.7],
			[-112.6, 0.5],
			[-115.2, -2.1],
			[-115.5, -2.3],
			[-119.5, -6.3],
			[-120.5, -8.3],
			[-120.7, -8.6],
			[-122.5, -12.2],
			[-123.5, -17.2]
		]
	},
	{
		slug: 'rear-caster-left-mcmaster',
		w: 207.6,
		d: 93.6,
		h: 104.8,
		unitsPerPlate: 1,
		hull: [
			[-123.5, -50],
			[-117.6, -55.8],
			[-107, -66.5],
			[111.4, -66.5],
			[119.9, -58],
			[123.5, -50.8],
			[123.5, -45.5],
			[118.5, 51.4],
			[113.5, 61.4],
			[103.3, 66.5],
			[69.1, 66.5],
			[-107.9, 1.7],
			[-112.6, 0.5],
			[-115.2, -2.1],
			[-115.5, -2.3],
			[-119.5, -6.3],
			[-120.5, -8.3],
			[-120.7, -8.6],
			[-122.5, -12.2],
			[-123.5, -17.2]
		]
	},
	{
		slug: 'rear-caster-right',
		w: 207.6,
		d: 93.6,
		h: 105.2,
		unitsPerPlate: 1,
		hull: [
			[-109.2, 18.7],
			[-108.9, 16.9],
			[-108.6, 16.4],
			[-108.3, 15.3],
			[-106.4, 13.4],
			[-106.1, 13.2],
			[-105.4, 12.5],
			[-104, 12.1],
			[71.6, -52.2],
			[99.9, -52.2],
			[102, -51.2],
			[103.7, -49.5],
			[104.4, -47.3],
			[109.2, 45.9],
			[109.2, 47.4],
			[108.2, 49.5],
			[105.5, 52.2],
			[-101.1, 52.2],
			[-108.2, 45.1],
			[-109.2, 43]
		]
	},
	{
		slug: 'rear-caster-right-mcmaster',
		w: 207.6,
		d: 93.6,
		h: 105.2,
		unitsPerPlate: 1,
		hull: [
			[-123.5, 17.2],
			[-122.5, 12.2],
			[-120.7, 8.6],
			[-120.5, 8.3],
			[-119.5, 6.3],
			[-115.5, 2.3],
			[-115.2, 2.1],
			[-112.6, -0.5],
			[-107.9, -1.7],
			[69.1, -66.5],
			[103.3, -66.5],
			[113.5, -61.4],
			[118.5, -51.4],
			[123.5, 45.5],
			[123.5, 50.8],
			[119.9, 58],
			[111.4, 66.5],
			[-107, 66.5],
			[-117.6, 55.8],
			[-123.5, 50]
		]
	},
	{
		slug: 'rims-1-4',
		w: 280,
		d: 154,
		h: 48.5,
		unitsPerPlate: 1,
		hull: [
			[-116.5, 18.4],
			[-133.5, -14],
			[-139.4, -35.5],
			[-142.3, -64],
			[-114.1, -79.1],
			[21.7, -79.1],
			[141.8, -64.2],
			[139, -33.3],
			[132.2, -10.7],
			[124.4, 5.9],
			[114.5, 21.3],
			[96.2, 41.7],
			[79.7, 54.6],
			[62.8, 64.5],
			[38.4, 73.9],
			[4.8, 79.1],
			[-25.2, 76.9],
			[-44.3, 72.1],
			[-76.1, 57.1],
			[-93, 44.6]
		]
	},
	{
		slug: 'rims-2-3',
		w: 280,
		d: 154,
		h: 48.5,
		unitsPerPlate: 1,
		hull: [
			[-116.5, 18.4],
			[-133.5, -14],
			[-139.4, -35.5],
			[-142.3, -64],
			[-114.1, -79.1],
			[21.7, -79.1],
			[141.8, -64.2],
			[139, -33.3],
			[132.2, -10.7],
			[124.4, 5.9],
			[114.5, 21.3],
			[96.2, 41.7],
			[79.7, 54.6],
			[62.8, 64.5],
			[38.4, 73.9],
			[4.8, 79.1],
			[-25.2, 76.9],
			[-44.3, 72.1],
			[-76.1, 57.1],
			[-93, 44.6]
		]
	},
	{
		slug: 'rims-small-1-4',
		w: 156.7,
		d: 139.2,
		h: 48.6,
		unitsPerPlate: 2,
		hull: [
			[65.5, 70.1],
			[43.5, 69.2],
			[34.4, 67.8],
			[21.8, 64.8],
			[5.8, 59.2],
			[-5.9, 53.6],
			[-23.4, 42.4],
			[-34.4, 33.3],
			[-42.7, 25.1],
			[-51.1, 15.2],
			[-60.6, 1.2],
			[-70.3, -18.6],
			[-74.5, -31],
			[-79.1, -52.9],
			[-55, -69.8],
			[-53.7, -70.2],
			[53.8, -70.2],
			[76.9, -52.8],
			[77.9, -50.8],
			[79, 69]
		]
	},
	{
		slug: 'rims-small-2-3',
		w: 156.7,
		d: 139.2,
		h: 48.6,
		unitsPerPlate: 2,
		hull: [
			[65.5, 70.1],
			[43.5, 69.2],
			[34.4, 67.8],
			[21.8, 64.8],
			[5.8, 59.2],
			[-5.9, 53.6],
			[-23.4, 42.4],
			[-34.4, 33.3],
			[-42.7, 25.1],
			[-51.1, 15.2],
			[-60.6, 1.2],
			[-70.3, -18.6],
			[-74.5, -31],
			[-79.1, -52.9],
			[-55, -69.8],
			[-53.7, -70.2],
			[53.8, -70.2],
			[76.9, -52.8],
			[77.9, -50.8],
			[79, 69]
		]
	},
	{
		slug: 'seat-back-bottom',
		w: 215.8,
		d: 38,
		h: 80.1,
		unitsPerPlate: 1,
		hull: [
			[114.7, 13.4],
			[113.4, 16],
			[110.4, 19],
			[107.6, 19],
			[-21.4, 25.8],
			[-22.7, 25.8],
			[-109.9, 2.4],
			[-111.7, 1.5],
			[-114.6, -1.4],
			[-114.6, -2.7],
			[-114.7, -2.9],
			[-114.7, -20.2],
			[-113.4, -22.8],
			[-111.7, -24.5],
			[-109.1, -25.8],
			[107.4, -25.8],
			[110.3, -25.8],
			[112.4, -23.7],
			[112.5, -23.6],
			[114.7, -21.4]
		]
	},
	{
		slug: 'seat-back-top',
		w: 192.1,
		d: 31.2,
		h: 80.1,
		unitsPerPlate: 1,
		hull: [
			[-101, 5.9],
			[-100.6, -7.1],
			[-99.2, -9.8],
			[-87.5, -20],
			[-85.3, -20.5],
			[39, -15.6],
			[39.4, -15.6],
			[93.1, -11.6],
			[95.9, -10.9],
			[99.4, -8],
			[100.9, -4.5],
			[100.8, -0.5],
			[98.3, 6.8],
			[95.9, 12.5],
			[95, 14.3],
			[92.8, 16.4],
			[90.6, 17.7],
			[87.4, 18.4],
			[-88.7, 20.5],
			[-100, 8.6]
		]
	},
	{
		slug: 'seat-center',
		w: 260,
		d: 71.4,
		h: 79.8,
		unitsPerPlate: 1,
		hull: [
			[129.6, 36.1],
			[104.3, 36.1],
			[-121.1, 10.5],
			[-123.5, 9.9],
			[-126, 8.6],
			[-127.9, 7],
			[-129.2, 4.9],
			[-130.3, 1.8],
			[-130.1, -2.4],
			[-128.5, -5.9],
			[-126.1, -9.1],
			[-124, -11.1],
			[-121.1, -13],
			[-118, -14.4],
			[-113.1, -15.6],
			[109.3, -36.1],
			[128, -36.1],
			[129.3, -35.7],
			[130.4, -33.8],
			[130.4, 35.3]
		]
	},
	{
		slug: 'soft-headrest',
		w: 217.2,
		d: 60,
		h: 76.2,
		unitsPerPlate: 1,
		hull: [
			[-108.8, -24],
			[-107.4, -25.5],
			[-99.5, -30],
			[-97.9, -30.5],
			[97.9, -30.5],
			[99.5, -30],
			[107.4, -25.5],
			[108.8, -24],
			[108.7, -20.8],
			[83.6, 22.7],
			[80, 27],
			[77.6, 28.6],
			[73.6, 30.2],
			[70.1, 30.5],
			[-70.1, 30.5],
			[-73.6, 30.2],
			[-77.6, 28.6],
			[-80, 27],
			[-83.6, 22.7],
			[-108.7, -20.8]
		]
	},
	{
		slug: 'storage-left',
		w: 251.9,
		d: 242.7,
		h: 140.2,
		unitsPerPlate: 1,
		hull: [
			[-128.6, -74.2],
			[-128.4, -75.7],
			[-127.5, -77.4],
			[-105.9, -113.9],
			[-104.9, -114.7],
			[-87, -123.8],
			[-85.2, -123.8],
			[11.5, -92.4],
			[12.6, -91.7],
			[127.9, 91.7],
			[128.5, 93.7],
			[128.5, 116.7],
			[127.9, 118],
			[122.6, 123.3],
			[121.3, 123.9],
			[-82.2, 123.9],
			[-105.3, 100.7],
			[-106, 99.2],
			[-106.6, 97.6],
			[-128.4, -73.2]
		]
	},
	{
		slug: 'storage-right',
		w: 251.9,
		d: 242.7,
		h: 140.2,
		unitsPerPlate: 1,
		hull: [
			[-128.5, 93.7],
			[-127.9, 91.7],
			[-12.6, -91.7],
			[-11.5, -92.4],
			[85.2, -123.8],
			[87, -123.8],
			[104.9, -114.7],
			[105.9, -113.9],
			[127.5, -77.4],
			[128.4, -75.7],
			[128.6, -74.2],
			[128.4, -73.2],
			[106.6, 97.6],
			[106, 99.2],
			[105.3, 100.7],
			[82.2, 123.9],
			[-121.3, 123.9],
			[-122.6, 123.3],
			[-127.9, 118],
			[-128.5, 116.7]
		]
	},
	{
		slug: 'tires',
		w: 85.7,
		d: 60.5,
		h: 122.7,
		copies: 16,
		unitsPerPlate: 1,
		hull: [
			[-43.3, -18.3],
			[-31.7, -30.7],
			[23, -30.7],
			[27.5, -30.2],
			[30.4, -29.3],
			[36.3, -25.6],
			[41.1, -19.5],
			[42.9, -14.4],
			[43.3, -11.4],
			[43.3, -0.9],
			[42.2, 4.7],
			[41.2, 7.3],
			[36.6, 13.3],
			[33.1, 16],
			[10.8, 28.5],
			[5.1, 30.4],
			[0.1, 30.7],
			[-2.6, 30.1],
			[-31.8, 18.7],
			[-43.3, 6.4]
		]
	},
	{
		slug: 'wheel-mount-left',
		w: 242.1,
		d: 229.3,
		h: 140.2,
		unitsPerPlate: 1,
		hull: [
			[150.2, -173.2],
			[196.8, -134.4],
			[196.8, 50.1],
			[194.2, 64.6],
			[188.4, 80],
			[179.7, 93],
			[142.8, 133.2],
			[122.9, 139.8],
			[-12.7, 180.5],
			[-20.6, 188.4],
			[-98, 190.7],
			[-114.1, 186.7],
			[-159.4, 168.4],
			[-187.7, 133],
			[-197, -96.8],
			[-194.3, -117.4],
			[-185.6, -134.8],
			[-175.6, -148.8],
			[-138.6, -178.6],
			[-112.3, -191.7]
		]
	},
	{
		slug: 'wheel-mount-right',
		w: 242.1,
		d: 229.3,
		h: 140.2,
		unitsPerPlate: 1,
		hull: [
			[-98, -190.7],
			[-20.6, -188.4],
			[-12.7, -180.5],
			[122.9, -139.8],
			[142.8, -133.2],
			[179.7, -93],
			[188.4, -80],
			[194.2, -64.6],
			[196.8, -50.1],
			[196.8, 134.4],
			[150.2, 173.2],
			[-112.3, 191.7],
			[-138.6, 178.6],
			[-175.6, 148.8],
			[-185.6, 134.8],
			[-194.3, 117.4],
			[-197, 96.8],
			[-187.7, -133],
			[-159.4, -168.4],
			[-114.1, -186.7]
		]
	},
	{
		slug: 'wing-left',
		w: 330.9,
		d: 189.7,
		h: 50.1,
		unitsPerPlate: 1,
		hull: [
			[-90.5, -88.2],
			[-83.8, -93.1],
			[-68.2, -97.2],
			[11.5, -97.2],
			[25.2, -94.8],
			[76.4, -75.6],
			[168.8, 47],
			[141.4, 62.9],
			[99.7, 80.9],
			[76.2, 87.9],
			[35.1, 95.3],
			[-8.9, 97],
			[-41.1, 94.2],
			[-82, 85.5],
			[-103.5, 77],
			[-124.1, 63.9],
			[-140, 48.8],
			[-165.8, 12.2],
			[-166.8, -7.7],
			[-158.2, -22.3]
		]
	},
	{
		slug: 'wing-right',
		w: 330.9,
		d: 189.7,
		h: 50,
		unitsPerPlate: 1,
		hull: [
			[-168.8, 47],
			[-76.4, -75.6],
			[-25.2, -94.8],
			[-11.5, -97.2],
			[68.2, -97.2],
			[83.8, -93.1],
			[90.5, -88.2],
			[158.2, -22.3],
			[166.8, -7.7],
			[165.8, 12.2],
			[140, 48.8],
			[124.1, 63.9],
			[103.5, 77],
			[82, 85.5],
			[41.1, 94.2],
			[8.9, 97],
			[-35.1, 95.3],
			[-76.2, 87.9],
			[-99.7, 80.9],
			[-141.4, 62.9]
		]
	}
];
