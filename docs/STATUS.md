# Project status and handoff

_Last updated: 2026-11-09, after the filament supplement (r30 deployed); design studio redesign in progress (uncommitted). Keep this file
current: update it at the end of every work session, and before a context reset._

Read this first, then `CLAUDE.md` (rules, layout, conventions). Maintainer-machine
specifics (test copy, printer IP, deploy routine) are in the untracked
`CLAUDE.local.md`.

## Where we are

All planned milestones 1–7 are built and running on the maintainer's test copy.
Milestone 8 (release) has not started.

| Area                                                                                                                          | State                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Builds, chapters, roles, live updates, activity                                                                               | Done                                                                                                                                    |
| Prototype import, print logs (log sheet, edit, delete, undo)                                                                  | Done                                                                                                                                    |
| Variants (seat, rear caster, footrest, rim) and accessories (headrest, push handle)                                           | Done                                                                                                                                    |
| 3D designer (tap parts, slots, swatch picker, 13 palettes, generator, shareable designs)                                      | Done                                                                                                                                    |
| Setup wizard (template, options, colors with the full designer, print, export)                                                | Done                                                                                                                                    |
| Build tabs: Overview · Design · Print · Files · Finish · Settings; Builds/Printers nav                                        | Done                                                                                                                                    |
| Printer catalog (70), bed presets, team printers, keep-out zones                                                              | Done                                                                                                                                    |
| Plate arranging (true outlines, flat rotations only, edge margins, rigid source groups when needed)                           | Done                                                                                                                                    |
| 3MF export (Orca/Elegoo, Bambu, plain), painted supports, `bed_exclude_area`                                                  | Done, opened in Elegoo Slicer once (v1)                                                                                                 |
| Bundled MakeGood kit pack (CC0) 1.0.1, installed on first start                                                               | Done                                                                                                                                    |
| Assembly checklist, photos, handoff, printable summary                                                                        | Done                                                                                                                                    |
| Read-only printer status (Elegoo SDCP, Moonraker, OctoPrint, Bambu LAN), job → plate linking                                  | Done; SDCP probe verified live, full supervisor not yet tested live                                                                     |
| Spoolman (optional)                                                                                                           | Done, mock-tested only                                                                                                                  |
| Log a whole plate (Print tab: plate groups, part detail; Ready to print + bulk log removed in r22), pace-adjusted plate times | Done (r19): `LogPlateButton`, `LogRunSheet quick`, `domain/pace.ts`, `PlateTime`; e2e `log-plate`. No screenshots of the multi-run flow |
| Studio drafts (Studio nav, `builds.kind = 'draft'`, draft tabs, Make this a build)                                            | Done (r20): `/studio`, `drafts.test.ts`, e2e `studio`; open: printer/layout pickers only in Files, not draft Settings                   |
| Release (Unraid template, domain, public repo)                                                                                | Not started                                                                                                                             |

Latest real-geometry result (Elegoo Centauri Carbon, 256 × 256 with the cutter
keep-out, pack 1.0.1): **21 plates, no warnings, export guard clean**; both wings fit
with ~0.1 mm clearance; footrest and harness each on one plate.

## Studio drafts

The top-bar "Designs" link is now "Studio" (`/studio`; `/designs` gallery still exists, linked from the
Studio page). A draft is a `builds` row with `kind = 'draft'` (migration 0010) in a workspace:
design tab, variants, printer/bed, plate layouts and arranger, sliced-file print template, 3MF export and
Save as design all work as on a build.

- Hidden from: `buildRows`/`recentBuilds` (default `kind = 'build'`), team page, Builds menu,
  printer job matching (`findPlateForFile`, `linkJob`, `expect` route). `draftRows` lists drafts.
- Server rule: `mutateBuild`/`mutateBuildSystem` refuse any activity kind outside `draftAllows`
  (build.update/variant/printer/template/move/promote, filament.update, plate.slicer, `design.*`, `plates.*`)
  with a 400; `setSetupStep` and `phase` edits are refused too.
- UI: draft header with "Draft" badge and "Make this a build"; tabs Design, Files, Settings; Overview/Print/Finish/
  Summary/Setup redirect to Design. Plates panel hides print log, slicer grams and start buttons.
- Delete: editors can delete a draft (builds still need an owner). `POST /api/builds/[id]/promote` sets
  `kind = 'build'` and `setup_step = 5` (everything the wizard asks for already exists), writes `build.promote`,
  and the UI opens the setup wizard at the Export step with earlier steps one click away.
- Draft Settings shows name, a printer/layout summary linking to Files (the pickers live there), and delete.

## Filament supplement (2026-11-09, r30)

- SpoolmanDB lacks Schoolhouse Spools and Overture's regular 95A TPU line plus several High Speed 95A colors (Overture
  "High Speed PETG" is just their current PETG, already covered). `src/lib/server/filaments/supplement.json` (per brand
  `sourceUrl`, per color `hexSource` store | image | filascope) is merged by `mergeSupplement` in
  `scripts/update-filaments.mjs` during `filaments:update`; SpoolmanDB wins exact duplicates.
  `scripts/fetch-vendor-filaments.mjs` regenerates it (Shopify `products.json` is rate-limited fast: use
  `--fetch-pages`/`--pages-dir`, `--sample-images` needs sharp, `--hex-overrides`). PETG/PCTG/TPU only, no PLA.
- Overture: 28 TPU + Matte Digital Blue, store hexes. Schoolhouse: 34 (PETG, PCTG, TPU 95A, refill + matte kept),
  hexes estimated from photos; maintainer will flag any that look wrong. Filascope hexes are category buckets: not used.
- SpoolmanDB PR: parked by the maintainer (2026-11-09). Draft branch `overture-tpu-95a` + `PR_DRAFT.md` in
  `/workspace/spoolmandb-pr` (local only). Blocker: regular 95A spool_weight must be measured per their CONTRIBUTING.

## Design studio redesign (in progress, uncommitted)

- From the UX audit (scratchpad report; maintainer approved D1-D6). Done in working tree: role labels (`ROLE_LABEL`,
  `roleLabel` in labels.ts), Colors | Parts tabs with Palettes drawer, fixed two-pane desktop, pinned phone stage, compact
  build header on Design, /designs + /studio pages. In progress: PalettePanel compact cards + Apply bar. Later: swatch picker,
  part chip, Save/Share at top + apply saved design, a11y; fixups: PartSheet duplicate subtitle, slot order, gallery
  `slotTitle.ts` → `roleLabel`.

## Manual plate times (2026-11-09, r29)

- Migration 0012: `build_plates.manual_est_seconds` + `manual_est_source` ('user' | 'printer'), `print_runs.est_seconds`.
- A manual time beats every other plate time (`estSource = 'manual'`, "your entry"; `baseEstSeconds/baseEstSource` keep
  the overridden one for the "overrides file 32.7 h" hint). Set in Files → plate slicer row (`SlicerTimeInput`,
  `parseSlicerTime`), by a typed Now-card Slicer time on a whole-plate run, or by a printer job link (never over a
  'user' time). `syncPlateTime` in `builds/actions.ts`. Kept across re-upload/arrange when number + part set match.
- Logged runs store the run time they printed against; `paceOf` compares each run with its own time first.
- Why: a sliced project had plate 15 on the TPU slot (32.7 h) while the real print was PETG (13h 39m).

## Phone layout fix (2026-11-09, r28)

- `.now-card` grid had an implicit auto column that grew to its widest child (long run `<select>`, iOS
  datetime-local), spilling the live box and step fields past the card and widening the page on iPhone. Now
  `minmax(0,1fr)` tracks, shrinkable inputs/select (ellipsis). `e2e/printers.spec.ts` per-part test asserts no
  overflow inside `.now-card` at 390/360 px.

## Palettes, picker, camera collapse (2026-11-09, r26; picker merge r27)

- TPU slots renamed by role app-wide: kit roles `soft` = "Primary TPU" (cushions, soft headrest, grips), `tire` =
  "Accent TPU" (tires, harness/straps); palette `SLOT_LABEL` "Primary (TPU)" / "Accent (TPU)". Keys unchanged;
  existing builds keep their own role names (copied at creation; maintainer: fine, no migration).
- Generator: `softOfPrimary` (TPU primary follows the primary family), `pickTire` colored tires/straps 4 of 6, dark
  2 of 6; >= `MIN_TIRE_SOFT_DE` 10 from soft. No ready-made palette has near-black tires (maintainer request).
- Brand matching: a preferred brand wins only within `max(best + BRAND_MARGIN_DE 6, BRAND_OK_DE 10)`; else the
  closer brand, relaxed "No close Sunlu match; using …". Preferred brands are a list (`loadPreferredBrands`,
  localStorage `tmt.preferredBrands.v2`, old single value migrated); `resolvePalette(…, { brands })`.
- Swatch picker: `domain/swatch-picker.ts` `pickerSwatches` uses `exclusionReason` (TPU 95A only, no silk/matte/…)
  for both PETG and TPU; "Show all types" toggle (search also reaches hidden ones, tagged); same-brand duplicates
  (same hex / ΔE < 1) collapse; neutrals grouped by lightness; preferred brands first; brand chips multi-select.
  r27: look-alike swatches merge across brands (`mergeAcrossBrands`, ΔE2000 < 3 leader clustering; representative
  allowed > preferred > popular > nearest centre) with "Other brands (N)" in the detail; not with one brand chip
  or a search. TPU neutrals 57 → 17. Caveat: in "new slot" mode a pick closes the sheet, so alternates are
  reached via a brand chip or search there.
- Camera tile collapses ("Camera" header, chevron), remembered per printer (`tmt-camera-collapsed:<id>`); no
  camera requests while collapsed.

## Run choice on per-part plates, Activity links (2026-11-08, r25)

- perPartRuns plates (rims, plate 13) print one part per physical print. Printer job link/expect take optional
  `partSlugs` (validated, editors); linking an already-linked job changes parts (dropped → `stopPrinting`).
  Default without parts (`defaultRunParts`, `domain/run-choice.ts`): the one part already Printing, else the
  first part not Printed with runs left; never all. `runBody` logs a single chosen part as `partSlug`.
  UI: "Which run?" in `PrinterJobs`, "<part> · <color>, run X of Y" + Change in `PrinterLive`, StartOnPrinter
  per part in `PlateStart`. Dismissing a job with no logged run releases its Printing parts
  (`printer.job.release`) unless another active job covers them.
- Activity links: `describeActivitySegments` (plates and known parts tagged; control chars stripped from
  payload text so it can't forge links); `ActivityList` links to `/print#plate-N` / `#part-<slug>`. Print tab
  applies non-persisted overrides (group Plate, role All, Hide printed off), scrolls and flashes 2 s; touching
  a toolbar control drops its override. Unknown hashes do nothing.

## Printer camera (2026-11-07, r23)

- Overview Now printing card (`PrinterLive` → `CameraTile.svelte`) shows the linked printer's camera while
  it prints: snapshot every 5 s (paused when the tab is hidden), "Live" MJPEG toggle, lightbox, quiet
  "Camera unavailable" + Retry. Desktop: tile capped at 640 px, left-aligned.
- Migration 0011: `printers.camera_url` (nullable override), `camera_enabled` (default 1). Defaults resolved
  at runtime (`camera-source.ts`): Elegoo `http://<host>:3031/video`; Moonraker `/server/webcams/list`
  (relative URLs against `http://<host>`); OctoPrint webcam settings; Bambu LAN unsupported.
- Server hub `camera.ts` (+ `mjpeg.ts` parser): one upstream per printer fanned out to viewers, latest
  frame kept, closed 30 s after the last viewer; 5 MB frame cap, 5 s connect / 15 s stall timeouts, backoff.
  Routes: `GET /api/printers/:id/camera`, `/camera/snapshot`, `/camera/stream` (members only, 404 otherwise),
  `POST /api/printers/camera-test` (editors). SSRF guard `checkCameraUrl` (`src/lib/printers/camera-url.ts`):
  http(s), no credentials, host == printer host; redirects re-checked; no DNS-rebinding protection beyond that.
  `cameraUrl` is returned to editors only. Any printer PATCH drops its camera connection.
- r24: the Centauri Carbon answers `500 camera not ready` until SDCP Cmd 386 `{"Enable":1}` (see Decisions).
  Elegoo printers get an enabler: sent before a session's first connect, on non-2xx or stall (then 1 s
  reconnects for 5 s), throttled hub-wide to once per 30 s per printer; over the supervisor's socket when open,
  else a temporary socket (settings Test always temporary). Guard: every SDCP request goes through
  `sdcpEnvelope` (`adapters/sdcp.ts`): reads 0/1 with `{}` only, writes `SDCP_ALLOWED_COMMANDS = [386]` with
  exactly `{Enable:1}`, anything else throws. Real check during a print: not ready → enable → 200 + frame.
  Opt-in real probe `camera.real-enable.test.ts` (`TMT_REAL_ELEGOO`).
- Supervisor now emits a `job` event on job create/link/finish so an open Overview picks up a new print live.
- Real check: Centauri Carbon frame 640x360 via the hub; 3 concurrent GETs accepted. Moonraker/OctoPrint
  resolution tested with fake fetch only. Screenshots `data/shots-camera/`.

## Print tab trim (2026-11-07, r22)

- "Ready to print" section removed at the maintainer's request (too much space); `ReadyToPrint.svelte` deleted,
  with it the bulk "Log N plates printed". Older notes below that mention it are historical. Single-plate
  "Log plate N printed" and "Start printing" live in plate group headers and a part's detail.
- Print view groups by Plate by default. The toolbar is stored per build in localStorage `tmt-ui:<id>` as
  `{ role, hidePrinted, group }`; the old `by` field is ignored, so every build started on Plate once.

## Palette color locks and part print logs (2026-11-07, dadd250, not deployed)

- Design tab "Build one from a color" has four slot tiles (Primary, Accent, Soft, Tires), each a locked
  color or Auto. Quick swatches fill the selected tile, else the next Auto slot; "Use current" locks a slot
  to the build's current filament hex; × returns it to Auto. Initial state: Primary = the build's primary.
- `generateFromLocked(locked, harmony, shuffle)` keeps locked slots exact; anchor = primary > accent > soft
  > tire; an accent-only lock derives a primary >= `MIN_ACCENT_DE` away; primary + accent locked derive
  > soft/tire (`deriveSoftTire`). `paletteVariations(locked, count, page, harmonies?)` interleaves harmonies
  > per shuffle round and skips near-duplicates (`VARIATION_MIN_DE` 6 on every unlocked slot).
- Theme chips filter ("All themes" default); 6 cards per page + "More variations"; locked slots get a
  "yours" badge; preview ids `gen:<harmony>-<shuffle>`. Thin themes (Monochrome, primary only) give ~3.
- Open: no screenshots taken yet (the agent's Playwright screenshot run was denied at a permission prompt;
  spec ready in `data/shots-palette-locks/`).
- Bug fix: a part's Print log (`PartRow`) hid whole-plate runs (printer auto-log, Log plate N), so a Printed
  part said "No prints logged yet". `partRuns(view, slug)` in `logrun.ts` adds plate runs that cover the part
  (`runTargets`); `RunTable` `scopeOf` tags them "Plate N · whole plate" / "k of m parts" (grams titled
  "plate total"); deleting one from a part row confirms (it affects every part on the plate). The phone
  `.detail` column is `minmax(0, 1fr)` so a log table scrolls instead of widening the page.

## Decisions (do not revisit without the maintainer)

- **Never re-orient parts in 3D.** Only flat rotations about Z (`ALLOW_3D_REORIENT = false`).
- Flat rotations are normal: show "rotated N°" on the part only, never as a warning.
- Arranger: keep max edge/keep-out clearance; 1 mm default edge margin; 8 mm between parts;
  rigid source layouts only when per-piece packing would split a part.
- MakeGood files are CC0: ship them as a kit pack (GitHub release asset + Docker image),
  never in git; always credit MakeGood. The maker guide is **not** bundled (link only).
- One place per task: kit files live in the setup wizard's template step and Files →
  print settings; the hardware model is not user-uploadable.
- Chapters are optional (personal "My builds" workspace). Printers work in personal workspaces.
- Palettes/generator exclude matte, silk, transparent, glow, marble, wood, glitter, rock
  textures, multi-color, CF/GF and non-95A TPU (strength). Manual picks are unrestricted.
- Spoolman stays optional ("just another thing to update").
- Printers are read-only. The one exception (maintainer, 2026-11-07): Elegoo SDCP Cmd 386 `{"Enable":1}` to turn the
  camera stream on when someone views it (the printer answers "camera not ready" otherwise; OctoEverywhere does
  the same). Never send anything that moves, heats, pauses, stops or starts a print.

## Open questions for the maintainer

1. RESOLVED 2026-11-06: sliced file to test reading print times and grams. The maintainer's
   all-plates export `ECC_0.4_tmt_4691_colors_Overture PETG HF_0.2_14h40m.gcode.3mf` (340 MB, Elegoo
   Slicer on OrcaSlicer 2.4.2, 24 plates) parses: all 24 plates with slicer time (e.g. plate 1
   57380 s, 421.22 g) and grams per filament, thumbnails, 51/51 objects matched to kit parts.
   Needed: Elegoo 2.4 keeps plates in `model_settings.config` without model instances, so the
   objects come from `slice_info.config` (`identify_id`, `..._id_N_copy_N` tail stripped); its
   names use underscores for spaces (matcher now normalizes them); filaments of the same material
   map to the nearest build color. Verified through upload → review → apply on an arranged and an
   unarranged build: plates get `estSource` slicer, header time loses "(estimate)" (457.5 h total).
   The sliced export carries no 3D objects for plates and its `app` reads BambuStudio-02.06.00.51
   (3dmodel.model) although it is Elegoo/Orca.
2. RESOLVED 2026-11-06: "Start printing" is on the **Print** tab too (done, see backlog). Was: it lived
   only on the plate cards in the **Files** tab; should it also be next to part tracking?

Answered on 2026-11-04 (keep for context):

- The MakerWorld page for credit and guide links is correct:
  https://makerworld.com/en/models/2066081-3d-toddler-mobility-trainer
- The front caster mount pose is correct.
- The GitHub token already has Actions read/write (an earlier "no access" was a scripting
  mistake); CI logs are readable via the REST API.
- The maintainer will install on Unraid themselves: no "Unraid Boot Config" Read/Write for
  this container. The README must be a complete, accurate Unraid install guide (template
  XML in the repo, Docker tab steps, settings, Nginx Proxy Manager + Authentik). Domain and
  Authentik details stay with the maintainer.

## Known gaps and backlog

- Done 2026-11-06 (not yet committed): twin parts on uploaded plates. A slicer project holds ONE object for kit parts
  that share a source file (the rims: `rims-1-4` accent and `rims-2-3` primary, both `3DTMT O WHEEL RIM REV B.STEP`;
  plate 13 "WHEEL RIM (PRINT X4)" prints it 4 times). Apply used to put one twin on the plate with runs 4 and leave the other
  under "Other" (6 halves, wrong grams). Now `src/lib/domain/twins.ts` (pure: `twinGroups` by identical source file, or
  identical component files when a part has no real file; `planPlateParts`, `splitTwinRuns`) is used by apply (`applyUpload` in
  `builds/plates.ts`) and the review UI. An object mapped to a twin puts ALL twins active under the chosen variants on the
  plate, `perPartRuns` true, runs = ceil(runsHint / twins) (a warning in the result and review when not divisible),
  `slicer_by_part` = plate grams per run for each twin, `filament_grams` {} (accounting takes the roles from the parts),
  `est_seconds` per run unchanged, `slicer_grams` kept. Only plates made of one twin group are shared out; mixed plates, or
  plates that already map every twin, stay as mapped (mixed ones get a warning). `matchObject` returns `twins` and no longer
  caps the confidence of a tie among twins (other ties stay capped at 0.6). Review UI (`PlateUpload.svelte`): a callout per
  plate, e.g. "Wheel Rim -> Wheel Rims 1 and 4 (Accent) x2 and Wheel Rims 2 and 3 (Primary) x2", with a checkbox "Use only
  <part>" (apply body `single`: object keys). Result gains `twinPlates` and `warnings`; suggestions gain `twinGroups`.
  Non-sliced profile imports use the same path. Built-in layouts (`xpa` 13, `h2d` 12 and 20) already use perPartRuns with
  both twins: unchanged. Repair: `repairTwinPlates` (`builds/twin-repair.ts`, runs in `startup()` after the backfill, logs
  each change with `[tmt] twin repair:`): an uploaded plate with only one twin, perPartRuns false, the other active twins on
  no plate, runs divisible by the twin count becomes the shape above; print runs are not touched (note: whole-plate logs on
  such a plate stop counting toward a perPartRuns unit, as with any per-part plate); idempotent, and the maintainer's two
  hand-fixed builds (perPartRuns already true) are a no-op. Tests: `twins.test.ts`, additions in `plates.test.ts` (apply 4 -> 2
  each, odd 3 -> 2 + warning, single override, repair + idempotency + hand-fixed no-op), `plates-match.test.ts`,
  accounting totals; e2e `plates-upload` (new twin test). Real check (the maintainer's 24-plate sliced file, kit pack 1.0.1,
  scratch DB, arranged and unarranged build): plate 13 = parts [rims-1-4, rims-2-3], runs 2, perPartRuns, slicer grams 287.98 per
  part per run, filament_grams {}, 36852 s per run, no part left on no plate, total 457.5 h as before
  (`sliced.real.test.ts`, now asserts it).
- Done 2026-11-06 (not yet committed): sliced files as a data source ("print template"). After upload the review
  screen asks "Use these plates" (file's plates as sliced, today's behaviour) or "Use as print template" (keep my plates,
  optionally re-arrange now; learn per-part data). Default: template when the build has a printer or arranged plates, else
  plates. Both store per-part data in `build_part_profiles` (no schema change): `src/lib/domain/part-profile.ts`
  (`learnPartProfiles`, `resolveProfile`, `meshVolume`), DB glue `src/lib/server/builds/part-profiles.ts`, apply in
  `applyUpload` (`mode`, `arrange`), `DELETE /api/builds/[id]/print-template` ("Remove"). Methods: **exact** when the plate's
  G-code names its objects (`EXCLUDE_OBJECT_START` or Orca "; printing object"): `src/lib/domain/gcode-objects.ts` scans bytes
  incrementally (extrusion per object and tool, nominal move times rescaled by the `M73 R` minutes), run from the upload
  (`threemf/gcode-stats.ts`, 4 min budget) while the file is on disk; else **volume-split** by mesh volume. Real file: all 24
  plates in 20 s, peak RSS 111 MB (flat). Learned seconds per copy (copies = what the file prints; kit qty used as multiplier,
  file copies when the kit has none) and grams by role; a part's main filament always counts under its current role, so a
  recolor moves its grams (time unchanged); parts from the same source file as a learned part (rim pairs) get the same data.
  Used by: arranged plates (time, grams by role, label "from your slice", `estSource: 'learned'`), MakeGood layout plates whose
  parts are all learned, header/tiles/Ready to print/Now card; uploaded plates keep the slicer's own numbers. Stale prompt for
  non-arranged plates when a part's color changed since learning (`templateColorsChanged`); banner names the file. Files tab:
  "Print template" card (file, plates, printer, date, method, Replace, Remove). Real check (Centauri Carbon 256, keep-out):
  33 parts learned (32 + rim twin), arranged total **457.5 h = the file's 457.5 h** (exact and volume-split alike; they differ
  per part only on multi-object plates, e.g. connectors 11.83 vs 11.48 h); recolor wing-left accent -> primary re-arranges
  (21 plates), wing keeps 12.59 h and its 359 g move to Primary. Tests: `gcode-objects`, `part-profile`,
  `time-estimate.learned`, `print-template` (server), real tests (`gcode-stats.real`, `sliced.real`), e2e
  `print-template.spec.ts`; screenshots `data/shots-printtemplate/`. Open: the maintainer's file only slices one rim and
  prints tires twice; kit quantities differ from the file in those two places (handled as above). Not yet wired: "printer" and
  "manual" profile sources.
- Done 2026-11-06 (not yet committed): Files tab UX. (1) "Use my own sliced file" is a visible card at the top
  of Files -> Printer and plates (and the wizard's Files step); it, the select option and a 3MF dropped anywhere on
  the page (drop overlay; the kit drop zone keeps its own drops) open the existing `PlateUpload` flow as a modal
  dialog (no more off-screen panel). (2) With a printer set, `PlateLayoutPicker` shows a one-line summary
  (`printerSummary()` in `printers/printer.ts`) with "Change bed or printer" / Hide and the Re-arrange button;
  the `BedPicker` is expanded by default only without a printer. Picking custom/preset after a catalog printer
  drops that printer's keep-outs. (3) "Your printers" lists printers of every workspace the user is in, grouped
  by workspace name, the build's own first (`GET /api/printers/mine?first=<org>`, members only, no secrets,
  `listMyPrinters` in `api.ts`); the top-nav Printers link and "n printing" follow the printers when the
  current workspace has none (`printerCounts` from the app layout load). (4) Switching to a MakeGood profile
  while plates are arranged or uploaded asks first (inline confirm, Cancel keeps them); the layout is named
  "MakeGood's Bambu ... profile" everywhere instead of "Template default". The select was kept (not radio
  cards). E2E: `e2e/files-ux.spec.ts`; screenshots in `data/shots-files/`.
- Done 2026-11-06 (not yet committed): large sliced 3MF support. `MAX_3MF_MB` default 1024 (`maxThreeMfBytes()`
  in `config.ts`; plates upload and kit print-geometry import share it), `BODY_SIZE_LIMIT=1100M` in the Dockerfile,
  README/Unraid template/NPM `client_max_body_size 1100m`. fflate's push `Unzip` buffers every unwanted entry that has
  a data descriptor (all of a slicer's G-code), so a 340 MB file cost 415 MB RAM and 5 s; files on disk are now read
  through the zip central directory (`src/lib/server/threemf/zipfile.ts`: 56 ms, 80 MB RSS), in both the plate parser
  and the print-geometry reader (`readEntries`). The browser sniff of big files (> 48 MB) uses `File.slice`
  (`openBlobZip` in `kit-probe.ts`), a 500 MB synthetic file grows RSS < 60 MB. The kit drop zone detects sliced
  projects (`Metadata/plate_N.gcode` or plates in `slice_info.config`) and hands them to the build's "Use my own sliced
  file" upload (`BuildCtx.slicedFile`); "Import as kit print geometry" is an explicit, unticked choice.
  Tests: `large.test.ts` (600 MB synthetic), `sliced.real.test.ts` (set `TMT_SLICED_3MF`, `KITPACK_DIR`).

- Done 2026-11-06 (deployed in ae8497f): print time for arranged plates. They carry no time of their
  own, so `src/lib/domain/time-estimate.ts` splits MakeGood's X/P/A plate times over the parts
  (by BOM grams; perPartRuns per unit; variant parts with no plate and no grams take the time of the
  other option of their group, marked rough) and the build view fills `estSeconds` for arranged
  plates (`estSource` = slicer / profile / estimate, `estRough`; also stored on re-arrange).
  Precedence: slicer time > MakeGood profile time > our estimate. With no time at all the header
  and time tile show a dash and "no time estimate yet" instead of "~0.0 h". Centauri Carbon
  (21 plates): ~382 h, matching MakeGood's ~382 h. "Start printing" (and "Start on <printer>") is also on
  the Print tab: a "Ready to print" section (next 3 plates with nothing printed), each plate group
  when grouped by Plate, and a part's detail (`PlateStart.svelte`, `ReadyToPrint.svelte`).
- Build tabs renamed/reordered (done, deployed as r14 = commit 3a32759): Overview · Design · Print (was Parts:
  tracking, logs, now printing) · Files (was Print: bed/printer, plates, own sliced file, export,
  kit status) · Finish · Settings; wizard step "Print" → "Files". Routes `/print` (was
  `/parts`) and `/files` (was `/print`). 308 redirects: `/parts` → `/print`, `/plates` →
  `/files`, `/assembly`, `/handoff` → `/finish#…`. `/print` is reused, so `/print#plates|#export|#settings`
  is redirected client-side to `/files#…`; a bare old `/print` bookmark now shows part tracking
  (unavoidable). Wizard `?step=` takes 1–5 or template/options/colors/print/files/export.
  The Files tab keeps its plate-card "Start printing" buttons.
- Re-test the latest 3MF export in Elegoo Slicer (plates fit, wings, painted supports,
  cutter zone) after the margin/keep-out/group changes.
- Live test of the printer supervisor with the Centauri Carbon during a real print
  (job auto-link needs plate numbers in file names; Elegoo Slicer's names lack them).
- 3D chair from 3MF only (no STEP) for user-uploaded templates.
- OctoEverywhere notification webhooks for live print status (needs a public URL;
  shared-secret check).
- Template copies: switching a build back to the built-in kit leaves the unused copy;
  designs from the base kit don't apply to a copy.
- Rate limits: without a proxy a client can spoof `X-Forwarded-For`.
- Open sign-up: anyone who can reach the app can register. Add a setting to disable it
  (invite or SSO only).
- GHCR images built before the `.gitignore` route fix lack `export.3mf`, `model.glb` and
  `hardware.glb` routes (the folders were ignored); fixed and guarded in CI.
- `BuildPrinter` has no `teamPrinterId` link back to the team printer.
- Minor UI: 0.2–1.1 mm clearance on the Seat Center plate is geometric, not a bug.

- Queued 2026-11-07 (next after r22): live printer camera on Overview's Now printing card while a team
  printer prints. Server-side proxy with one upstream connection fanned out to viewers (works via
  LAN/Tailscale/NPM; printers often allow few stream clients); snapshot every few s by default, tap for
  live; per-printer camera URL, auto-filled for Elegoo (`http://<ip>:3031/video`, MJPEG, verified 200 on
  the maintainer's Centauri Carbon), Moonraker/OctoPrint webcam URLs, manual override.

- In progress 2026-11-08 (not in r25): TPU slots renamed by role everywhere in the UI (`soft` → "Primary
  (TPU)": cushions, soft headrest, grips; `tire` → "Accent (TPU)": tires, harness/straps; keys unchanged);
  generator gives colored tires/straps (dark ~1 in 3), several ready-made palettes too; fix: preferred brand
  no longer wins when another brand is much closer (locked #1e88e5 with Sunlu gave Sunlu Purple).

## Next steps (suggested order)

1. Maintainer re-tests the export in Elegoo Slicer; fix what comes back.
2. Milestone 8 release: Unraid template XML (+ Community Apps), NPM + Authentik on the
   maintainer's copy, README/install docs, make the repo public, CI e2e green on GitHub.
3. OctoEverywhere webhooks; printer supervisor live test.

## How work is done here

- The main session orchestrates: plans, splits work into Sonnet subagents with explicit
  file ownership, reviews, verifies and is the only one that commits/deploys.
- Every change set: `npm run check`, `npm run lint`, `npx vitest run`, `npm run build`,
  full e2e (twice before deploys), migration rehearsal on a copy of the test data when
  schema/seed/startup changes, backup, deploy, then a short summary to the maintainer.
- UI work is checked at 390 px and 1440/1920 px, light and dark.
- This file is the handoff: update it when a session ends or before clearing context.

## Commit history highlights

`ff3c770` scaffold · `72ac628` multi-build · `297a909` prototype import · `27c8784`
variants · `f26ceb1` 3D designer + 3MF plates · `455193b` printer planner · `108e3b0`
complete chair + palettes · `1bb95d4` 3MF export · `5da23aa` flat-rotation rule ·
`b345442` true-outline fitting · `7d40f61` wizard + kit pack · `c45b1cd` margins,
keep-outs · `f4e7715` groups + kit pack 1.0.1.

### Log a whole plate and pace (2026-11-07, r19)

- "Log plate N printed…" (`LogPlateButton.svelte`) opens `LogRunSheet` with `quick`: Success
  preselected, finished now, time = started→now if Printing else the plate's per-run time
  (source labelled), grams = slicer/learned grams per run (sum of per-filament grams when no
  plate total). The Now printing finish flow is unchanged (no default result). Sheet summary shows
  "Print 1 of 2" on multi-run plates. Ready to print has checkboxes + "Log N plates printed"
  (single-run, non-perPartRuns plates only; hours left empty; one Undo reverses the batch).
- Pace (`src/lib/domain/pace.ts`): sum(actual)/sum(plate time) over successful timed whole-plate
  runs, ignoring failed/partial, subset runs, hours <30% or >300% of plate time, and hours that
  equal the plate time exactly (the sheet's prefill, not a measurement). Needs 12 estimated
  hours. `Plate.estSeconds` is already the best source (slicer > learned > profile > estimate).
  `timeStats.pace` carries it; header text "Calibrated: you print 7% faster than the slicer".
  `PlateTime.svelte` shows "≈ 9.4 h at your pace · slicer 10 h" (plus total for multi-run) on
  Ready to print, plate groups, Files plate cards and Now printing; Now printing's ETA uses the
  pace when the time is slicer/learned/estimate and no printer job reports its own.
- Caveat: a user who saves the prefilled plan time unedited records plan time as actual hours;
  the exact-match rule in pace excludes that, but the logged hours stay in totals.
