import type { TemplateSeed } from './types';

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
