# Kit pack

A kit pack carries the converted MakeGood 3D TMT files (3D model, hardware model, part
placements, print geometry) so a fresh install has the standard kit without uploading anything.

MakeGood's files are released as **Creative Commons Public Domain (CC0)**; the pack credits
MakeGood (`CREDITS.md` and `license` in `manifest.json`). The maker guide PDF is not part of the
pack. The pack is too big for git (about 30 MB), so it is a **release asset**
(`kitpack-<template slug>-<version>`), baked into the Docker image, and also downloadable at runtime.

## Format `tmt-kitpack-1`

`<template slug>-<version>.kitpack` is a plain zip (fflate; entries deflate level 9, GLBs stored).

| Entry                          | Content                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`                | `format`, `templateSlug`, `version`, `createdAt`, `sources[{file, sha256, role}]` (every other entry), `license`, `contents`, `appMinVersion` |
| `CREDITS.md`                   | Credit and license text                                                                                                                       |
| `model/model.glb`              | The assembled chair, one node per part slug (as the STEP converter writes it)                                                                 |
| `model/model.json`             | `{ slugs }`: part slugs present in the GLB                                                                                                    |
| `model/hardware.glb`           | Optional neutral hardware (casters, bolts, bearings)                                                                                          |
| `placements.json`              | `template_part_placements` rows: `slug`, `matrix`, `instances`, `placed`                                                                      |
| `print/geometry.json`          | `template_print_geometry` rows: `slug`, `footprint`, `hull`, `height`, `tris`, `settings`                                                     |
| `print/meshes/<name>.qmesh.br` | One print mesh per piece in the quantized format below                                                                                        |

`license`: `{ name: 'CC0 1.0 (Creative Commons Public Domain)', holder: 'MakeGood', url?, note: 'Credit: 3D model and print files by MakeGood' }`.

### Source groups (since 1.0.1)

A part whose pieces share a plate in the kit author's profile (connectors, buckles, harness, tires, rims)
carries `footprint.groups` in `print/geometry.json`: one group per source plate with at least two of the
part's objects. A group stores each object's position and flat rotation relative to the group origin (the
centre of the combined outline's box), the source printer's bed size (`printable_area`), the combined true
outline (the pieces' silhouettes at those positions) and its box. The arranger packs pieces one by one first (densest) and uses a part's group, as one rigid item (moved and
turned flat about z only, keeping the source's own gaps), only when per-piece packing would split that part
over plates and the group gives fewer plates or fewer split parts. A group that does not fit the bed is never
used. Pieces on different source plates are different groups. No schema
change: the data lives in the existing footprint JSON. Pack 1.0.1 also fixes the part matching of the
footrest straps (they belong to the harness, not the footrest).

**Installs that imported a profile themselves** (kit admin, or `scripts/import-print-geometry.mjs`) hold rows
without groups; the installer never touches admin rows, and groups cannot be rebuilt without the source
file. Re-importing the profile 3MF (kit drop zone or the CLI) stores groups and the corrected matching.

### What is dropped or reduced

- **Poses** (the removed 3D re-orientation search: `orient`, `sil.poses`) are left out of new packs.
  Packs up to 1.0.1 still carry empty stubs of them; readers ignore these keys. Silhouettes keep
  only the profile outline.
- **Settings** are limited to the per-object MakeGood print settings (walls, infill, supports,
  brim, layer height, shells). Machine, filament, temperature, speed and project-level keys are
  removed (`cleanSettings` in `src/lib/server/kitpack/build.ts`).
- **Meshes** (`TMTQ`, `format.ts`): positions are rounded to 0.01 mm (int32), vertices renumbered in order of first use, delta coded per
  axis as zigzag varints; indices are coded against the highest vertex seen; per-triangle paint
  (supports, seam) is stored verbatim, so painted faces are bit-exact. The installer expands them
  to the usual float32 `TMTP` files. The worst position error is 0.005 mm plus float32 rounding. Each mesh entry is brotli compressed (`.qmesh.br`, stored in the zip).

## Index and sha256

`kitpacks/index.json` is committed: `{ "format": "tmt-kitpack-index-1", "packs": [{ slug, version, file, sha256, size }] }`.
A pack file is installed only if its sha256 and size match the index; every entry inside is checked against
`manifest.sources` as well.

## Installer (`src/lib/server/kitpack/install.ts`)

Called from `startup.ts` after migrations and the seed, in the background (start-up never waits).
For each template with an index entry:

1. Skip if the marker `<uploads>/kitpack/<slug>.json` already holds this version and sha256 and the template has a model.
2. Find the pack: `KITPACK_DIR/<file>` (default `/app/kitpacks` in the image, `./kitpacks` in dev), else download
   from `KITPACK_URL` (default `https://github.com/ayostepht/TMT-Build-Tracker/releases/download/kitpack-{slug}-{version}/{file}`;
   `{slug}`, `{version}`, `{file}` placeholders, or a base URL; `file://` works) unless `KITPACK_DOWNLOAD=off`.
3. Install per item (a pack newer than the installed pack data, e.g. 1.0.1 over 1.0.0, replaces rows with `kitpack:<older>`):
   - **Model** (+ hardware GLB, placements): when there is none, or only older pack data. A model an admin imported is kept.
   - **Placements**: only together with a model install; rows with `updated_by` set are never changed.
   - **Print geometry**: per part, replacing the seed row or older pack data (`source_note = kitpack:<version>`).
     Rows an admin imported are kept.
4. Write the marker. Re-running is a no-op.

While it runs, `GET /api/templates/[id]/kit-status` returns `installing: true` (and `installMessage`).
Failures are logged (`[tmt] kit pack: ...`) and retried at the next start.

## Building a pack (maintainer)

In the app image or a checkout after `npm run build`, with MakeGood's files at hand:

```bash
# hardware GLB from the assembly STEP (needs ~1.4 GB, see README "3D model")
node --max-old-space-size=4096 scripts/step-to-glb.mjs "TMT 3D TOP ASSEMBLY - RENDERING ONLY.step" hardware.glb

# scratch install + import, later --print files win; then write the pack
node --max-old-space-size=4096 scripts/build-kit-pack.mjs --db data/kitpack-work/tmt.db --init \
  --model "STEP FILES.zip" --hardware hardware.glb \
  --print h-profile.3mf --print bucket-seat.3mf --print harness.zip --print xpa-project.3mf \
  --pack-version 1.0.1 --out data/kitpack
```

It prints the size and sha256. Then: attach the file to a GitHub release tagged
`kitpack-makegood-tmt-revb-<version>`, put `slug`, `version`, `file`, `sha256`, `size` into
`kitpacks/index.json` and commit that. Never commit the pack (`*.kitpack` is ignored). For a local Docker build, copy
the pack into `kitpacks/`; the build uses it when its sha256 matches the index.
