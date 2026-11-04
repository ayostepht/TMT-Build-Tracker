# Plate arranger: how to use it (for the 3MF exporter)

`arrange.ts` decides which parts go on which plate for one printer bed, grouped by
filament, and where each part sits. It is pure and deterministic: the same input gives
the same plates. The server applies the result to a build (`build_plates`), and an
exporter can turn each plate into a 3MF.

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

## Re-orientation (parts bigger than the bed)

When a piece does not fit in its profile orientation (0/90 degrees or a free in-plane angle),
and its footprint carries `orient` (poses computed on import by `orient.ts`), the arranger uses
the best fitting resting pose: `ArrangedItem.pose` = `{ m, t, h, hull, desc, ... }`, so a mesh
vertex goes `p' = Rz(rotation) * (m * p + t) + (x - ox, y - oy, 0)`. `ox, oy` is the offset of
the turned outline's box centre from the mesh origin (free angles only; absent for 0/90). Items
without `pose` use the stored mesh as is. Seed footprints (no meshes) cannot be re-oriented.
