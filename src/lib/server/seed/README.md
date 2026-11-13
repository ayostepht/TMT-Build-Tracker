# Seed templates

Each file here describes one printable kit as a `TemplateSeed` (see `types.ts`). `index.ts` exports `templateSeeds`, the list the app loads into the database on first run.

## Format

- **Template**: `slug`, `name`, `version`, `description`, optional `sourceUrl`, `globalSettings` (printer-wide slicer notes), and ordered `sections` used to group parts.
- **filamentRoles**: generic roles (for example `primary`, `accent`, `soft`, `tire`) with a default hex, material, TPU flag and recommended spool count. Roles are not tied to a brand or color.
- **parts**: one per printable item. `slug` is the stable id; `defaultRole` points at a filament role; `allowedMaterials` limits what can be chosen; `symmetryGroup` links left/right pairs; `components` lists sub-pieces of a multi-file part; `guideRefs` point at `guidePages`.
- **plates**: print plates in profile order. `parts` lists slugs, `runs` is how many times the plate is printed, and `perPartRuns` means each part on the plate is its own unit printed `runs` times.
- **plateLayouts** (optional): built-in plate layouts per printer family, each `{ key, name, printerNote, isDefault?, plates }` with the same plate shape as `plates`. The default layout (`isDefault`) should equal `plates`. A build picks one at creation or later (Files tab, Settings tab); its plates are copied into the build, so later seed changes never touch existing builds. Seeding upserts layouts by `key` (idempotent) and never deletes one. Each layout lists every part it prints at most once; parts of variant options may be missing from plates of other options, and a part may be on no plate at all (the foaming bucket seat; the one-piece push handle on the X/P/A layout, as it needs a bigger bed): it then shows under "Other". The H2D layout has a plate for the one-piece handle that is empty, and so dropped, unless that option is chosen.
- **guidePages**: page number, title and display order (`sort`).
- **hardware**: purchased or non-printed items. `qty` is only set when the source states it.
- **designs**: named color schemes. Each maps every part slug to a role key and gives the role a brand-specific name, material and hex.
- **variantGroups** (optional): alternatives for one function, for example seat cushions or a bucket seat. Each group has a `defaultOption` and options listing the part `slugs` they use; a part may be listed in several options of one group when they share it (the one-piece push handle keeps the TPU grip); `PartDef.variantGroup/variantOption` then name the first option that lists it, and the part is active whenever any chosen option lists it. Parts in no option are always used. A build picks one option per group and parts of the other options are left out of its parts, plates and totals.
- **placements** (optional): where each part sits in the assembled 3D model: a column-major 4x4 `matrix` (identity when the STEP file is already in the assembly frame), extra `instances` (mirrored copies), and `placed`. Numbers only; the model geometry is imported per install and never stored in the repo.

## Adding a kit

1. Copy `tmt.ts` to `<kit>.ts` and export a `TemplateSeed` with a unique `slug`.
2. Define roles, parts, plates, guide pages, hardware and at least one design.
3. Import it in `index.ts` and add it to `templateSeeds`.

Every part slug must appear on exactly one plate, every `defaultRole` and design `partRoles` key must exist, and every `guideRefs.page` must be in `guidePages`.

- **printFootprints** (optional): per part, the bed area one printed unit takes in the kit author's print orientation: `w`/`d`/`h` in mm (or `pieces` for parts made of several objects), `copies` per unit and `unitsPerPlate` (how many units one plate run holds). Numbers only. Stored in `template_print_geometry` with `source_note = 'seed'`; an admin's geometry import replaces them and later seeding never overwrites imported rows.
