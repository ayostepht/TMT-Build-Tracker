# Plate arranger: how to use it (for the 3MF exporter)

`arrange.ts` decides which parts go on which plate for one printer bed, grouped by
filament, and where each part sits. It is pure and deterministic: the same input gives
the same plates. The server applies the result to a build (`build_plates`), and an
exporter can turn each plate into a 3MF.

## The kit layout comes first

The app does not call `arrange()` straight for a build. `planArrangement(..., kit)` in
`builds/arrange-plan.ts` hands the kit's own plate layout (or the plates of the file the maker
uploaded) to `arrangeFromSource` in `arrange-source.ts`, and `arrange()` only places what the source
cannot (`loadKitSource` picks the layout: the build's own MakeGood profile, else the one whose bed is
the biggest the printer still holds):

- **A plate stays** (same number, name, parts, positions) while its parts still print together: one
  filament, or different filaments that the kit already printed in different colors, and the printer's
  slots and materials allow it. It is placed alone (never merged, no brim margin: "as authored"); the
  pack stores membership only, so positions come from `arrange()` of that one plate, at a gap that steps
  down to 2 mm and with a few-parts order/turn search and an outline nester (`options.thorough`) so the
  plate fits where the author's did. A source that carries positions (`SourcePlate.items`) keeps them.
- **Only what must move moves**: a part whose filament no longer matches the rest of its plate (a design
  that colors two parts of one kit color differently), a part that does not fit this bed, and parts the
  source does not list go off their plate. The largest same-filament group stays in place. A part that left
  for its filament first tries to **join an existing plate** (below); the rest go to NEW plates numbered
  after the last, packed together by `arrange()`.
- **A moved part may join a multi-part plate** (planner 3, `tryJoin`): a plate that already had several parts
  in the source, that now prints in the part's own filament only (the same role key: never mixing, never
  PETG with TPU), that prints as often as the part needs (`runs`), and that is not a run plate. Parts
  already on it do not move or turn; the newcomer's outline (brim counted) is nested into the free space with
  the printer's normal gap to the plate's items (their brims counted too), the edge margin and the keep-outs;
  there is no step-down to the kit's 2 mm gap. The plate's used share of the usable bed after joining
  (`ArrangedPlate.utilisation`, boxes with brims) must stay at or under `JOIN_MAX_UTILISATION` (60 %).
  Several candidates: most room left first, ties to the lowest plate number. A part with rigid source groups
  does not join. A plate with a single part in the source never receives one (below). Nothing fits: a new plate.
- **Crowding limit, grounded in the kit** (xpa layout, Centauri Carbon 256 x 256 + cutter keep-out; used
  share of the usable bed, boxes with brims): Seat Back 22 %, Connectors 47 %, Push Handle Bottom 49 %,
  Caster Mount (Kit) 60 %, Push Handle Top 68 %, Headrest 94 % (median 54.5 %; the wheel rim plate shows 89 %
  for its one print and is not a multi-part plate). The cap is a little above the typical multi-part plate and
  below the fullest one; 60 % is also where `arrange()` stops calling a plate underfilled (`mergeBelow`).
- **A plate printed in runs of its own is one plate** (planner 3, `isRunPlate`): a source plate that lists 2+
  parts of the SAME geometry (same pieces, sizes, copies, outline, units per plate) and either says so
  (`perPartRuns`) or is printed more than once (`runs` > 1). The wheel rims are one object, `3DTMT O WHEEL RIM
REV B`, printed twice in Accent (`rims-1-4`) and twice in Primary (`rims-2-3`): one plate, one rim on the
  bed per print. It is laid out for ONE print (the first part's items for one run: `unitsPerPlate`), stays
  whole in the kit's number and name, is never split because its parts "do not fit together" (they are never on
  the bed at once) or because their colors cannot share a printer, and the result carries
  `ArrangedPlate.perPartRuns` (the build's plate is stored `perPartRuns`, like the kit's own). `items` show one
  print, `parts` all parts, `roles` the filament of that print, `runs` the runs of each part. A plate that
  stays whole is printed as often as the source says (the tires: 8 segments per print, `runs` 2). Plates with
  different geometry, or printed once and not flagged, are not run plates.
- **A plate with one part in the source is sacred** (`soloParts`, `options.solo`): it never gets another
  part, and may use the relaxed edge margin (`SOLO_MARGIN`, 1 mm) when the printer's margin leaves no room.
- **Brims count** for parts the arranger places (`ArrangePart.brims`, from `pieceBrimMm`): the footprint
  used for the gap to neighbours, the bed edge and keep-outs is the outline grown by the brim; the item
  box `w` x `d` includes it. A part that fits only without its brim is placed without it (warning `brim`).
- **No layout for the bed** (a layout for a bigger bed than the printer's, a custom kit): plain
  `arrange()` with `options.solo` from the nearest layout.
- Plates carry `v` (`PLANNER_VERSION` 3). A planner change must never flag or rewrite an existing build: the
  "stale" check compares a stored arrangement with the planner that made it. Version 3 = run plates and joins
  (`RULES_V3`); version 2 = the kit layout first, movers always on new plates (`RULES_V2`,
  `planArrangement(..., kit, 2)`); no version = the plain arranger (`planArrangement(..., 'legacy')`). Only
  an explicit "Arrange"/"Re-arrange" or an automatic re-arrange after a design change writes version 3.

Plain `arrange()` without `solo`, `brims` and `thorough` is unchanged (`arrange-tmt-snapshot.test.ts`).

## Getting the arranged plates for a build

Server side (preferred):

```ts
import { loadBuildView } from '#lib/server/builds/view.ts';
import { buildArrangement } from '#lib/server/builds/plates.ts';

const info = buildArrangement(db, buildId, userId); // ArrangementInfo (see arrange.ts)
info.printer; // BuildPrinter: bed, margin, spacing, mmSlots, nozzle
info.plates; // ArrangedPlate[] as stored (only plates with source 'arranged')
info.stale; // colors / variants / printer changed since the plates were arranged
info.footprints; // slug -> PrintFootprint (pieces with hull, mesh file names, author settings)
```

`GET /api/builds/[id]/arrangement` returns the same JSON. If `info.plates` is empty or
stale, call `arrangeForPrinter(db, buildId, userId, { convertRuns })` (or
`POST /api/builds/[id]/plates/arrange`) first. Arranged plates are also the build's
normal plates: `BuildView.plates` (`source === 'arranged'`) and `builds.plate_layout =
'arranged'`; the positions live in `build_plates.arrangement` (json `ArrangedPlate`).

To compute a plan without writing it: `planArrangement(view, loadFootprints(db, templateId))`
in `src/lib/server/builds/arrange-plan.ts` (returns `{ result: ArrangeResult, unsized }`).

## What a plate contains

```ts
ArrangedPlate {
  number, name, runs,              // runs: print the plate this many times (rims: 2)
  perPartRuns?,                    // true: one print holds ONE part's items; every part is printed `runs` times (rims)
  parts: string[],                 // part slugs
  roles: string[],                 // filament role keys on the plate
  estGrams: Record<role, number>,  // per run, from BOM grams (an estimate)
  utilisation,                     // 0..1 of the usable bed
  oversize?: true,                 // a part is bigger than the bed; items are centred
  bed: { x, y, margin },
  items: ArrangedItem[]
}
ArrangedItem { slug, piece, copy, x, y, w, d, rotation, role }
```

- `piece` indexes `footprints[slug].pieces`. Most parts have one piece; connectors, buckles
  and the harness have several, each with `copies` per unit.
- `copy` numbers copies of the same piece on the plate (0-based, per part).
- `x`, `y` is the **centre** of the placed box in bed coordinates: millimetres, origin at
  the bed's front-left corner, x right, y away from the viewer, z up. `w` x `d` is the box
  after rotation. Items stay inside bed minus `margin`, at least `spacing` apart.
- `rotation` is degrees counter-clockwise about z. Normally 0 or 90; any angle appears
  only for long parts that fit the bed diagonally, and where the optimiser leaves a part rotated a little more for edge clearance (the legend shows "rotated N°"; no warning).

## Transforming a mesh onto the plate

Each piece's mesh is stored already **dropped to the bed and centred**: z = 0 at its
lowest vertex, XY bounding-box centre at the origin, and already turned about z to its
smallest box (so `w >= d`). To place it:

```
p' = Rz(rotation) * p + (x, y, 0)       // no z change
```

Triangle winding is already counter-clockwise from outside (mirrored build items were
flipped on import). Units are millimetres. A plate printed `runs` times is one 3MF.

## Mesh and settings storage

- Table `template_print_geometry` (one row per part slug): `footprint` json
  (`PrintFootprint`: `pieces[{ name, w, d, h, copies, hull, tris, mesh, settings }]`,
  `unitsPerPlate`), `hull`, `height`, `tris`, `settings`, `mesh_path`, `source_note`
  (`'seed'` = numbers only, no mesh; otherwise the imported file's name).
- Mesh files: `uploadsDir()/print/<templateId>/<slug>.bin` for piece 0 and
  `<slug>__<n>.bin` for piece n. `PrintPiece.mesh` holds the file name. Read with
  `readPieceMesh(templateId, meshName)` from `src/lib/server/print-geometry/store.ts`;
  the binary layout (header "TMTP", version, vertex and triangle counts, float32
  positions, uint32 indices) is documented in `mesh-format.ts`. A piece without `mesh`
  (seed footprints, no import yet) has no geometry: the exporter must tell the user to
  import the profile in the kit admin page or fall back to boxes.
- `PrintPiece.settings` is the kit author's per-object slicer settings from
  `model_settings.config` (`wall_loops`, `sparse_infill_density`, `enable_support`,
  `support_type`, `brim_type`, `brim_width`, `layer_height`, `extruder`, ...), all strings.
  Write them as object metadata in the exported 3MF.
- `unitsPerPlate`: units of the part per plate run. The part's total quantity is
  `PartDef.qty ?? 1`, so the plate runs `ceil(qty / unitsPerPlate)` times (`ArrangedPlate.runs`).

## Where filament colors come from

`BuildView.filaments` (`FilamentRole`: `key`, `name`, `material`, `hex`, `tpu`) is the
build's colors; `ArrangedItem.role` and `ArrangedPlate.roles` are `FilamentRole.key`s.
A part's role is `BuildView.parts[].role` (the build's design snapshot). For the 3MF,
map each plate's roles to slots in order: `ArrangedPlate.roles` is sorted by the build's
filament order, and a plate never holds more roles than the printer's `mmSlots` (PETG and
TPU never share a plate).

## Rules the arranger follows

- Parts are grouped by role (filament) and by run count. Roles may share a plate only if
  `mmSlots` allows, the materials are the same family (PETG never with TPU) and the plate
  would otherwise be underfilled (< 60 %).
- Oversize parts (bigger than the bed in every orientation) get a plate of their own with
  `oversize: true` plus a warning, so they still show up for tracking.
- Parts without a known footprint get a plate without items (`items: []`).
- A part whose copies do not fit one plate (16 tires) is split over plates and reported
  with a `split` warning.
- Hulls are used to draw outlines and to find a free angle for long parts; packing itself
  uses bounding boxes.

## Rigid source groups

A footprint with `groups` (pieces laid out on one plate of the kit author's profile, see
`docs/kit-pack.md`) is arranged group by group: the whole group is one packing item (its combined
outline, turned flat about z by 0/90 or a free angle) and its pieces come out as ordinary
`ArrangedItem`s at group transform x piece offset (`rotation`, `x`/`y` box centre, `ox`/`oy` pivot as
for free angles), tagged with the same `group` number. Spacing applies between items, not inside a
group. Pieces are packed one by one first (densest); a part's group is used only when that would split the part
over plates and the group gives fewer plates (or fewer split parts). A group that does not fit the bed
(margin, keep-outs) is packed piece by piece, and only then does the part get the `split` note. Groups are ignored when they hold more objects than the part's copies call for.

## Flat rotation only (no 3D re-orientation)

HARD RULE: parts are never re-oriented in 3D. Every mesh keeps the face-down orientation of its
source file; the arranger and the exporter only rotate it about z (0/90 degrees, or a free in-plane
angle when only that fits): a mesh vertex goes `p' = Rz(rotation) * p + (x - ox, y - oy, 0)`. `ox, oy`
is the offset of the turned outline's box centre from the mesh origin (free angles only; absent for
0/90). A part that does not fit flat is reported as oversize with advice. The 3D pose search
(`orient.ts`, `ArrangedItem.pose`) was removed on 2026-11-11; stored arrangements that still carry a
`pose` are treated as stale and re-arranged flat, and legacy `orient` data on stored footprints is
ignored.
