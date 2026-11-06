# Project status and handoff

_Last updated: 2026-11-06, after commit 33b02ac (print template, deployed as r18). Keep this file
current: update it at the end of every work session, and before a context reset._

Read this first, then `CLAUDE.md` (rules, layout, conventions). Maintainer-machine
specifics (test copy, printer IP, deploy routine) are in the untracked
`CLAUDE.local.md`.

## Where we are

All planned milestones 1–7 are built and running on the maintainer's test copy.
Milestone 8 (release) has not started.

| Area                                                                                                | State                                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Builds, chapters, roles, live updates, activity                                                     | Done                                                                |
| Prototype import, print logs (log sheet, edit, delete, undo)                                        | Done                                                                |
| Variants (seat, rear caster, footrest, rim) and accessories (headrest, push handle)                 | Done                                                                |
| 3D designer (tap parts, slots, swatch picker, 13 palettes, generator, shareable designs)            | Done                                                                |
| Setup wizard (template, options, colors with the full designer, print, export)                      | Done                                                                |
| Build tabs: Overview · Design · Print · Files · Finish · Settings; Builds/Printers nav              | Done                                                                |
| Printer catalog (70), bed presets, team printers, keep-out zones                                    | Done                                                                |
| Plate arranging (true outlines, flat rotations only, edge margins, rigid source groups when needed) | Done                                                                |
| 3MF export (Orca/Elegoo, Bambu, plain), painted supports, `bed_exclude_area`                        | Done, opened in Elegoo Slicer once (v1)                             |
| Bundled MakeGood kit pack (CC0) 1.0.1, installed on first start                                     | Done                                                                |
| Assembly checklist, photos, handoff, printable summary                                              | Done                                                                |
| Read-only printer status (Elegoo SDCP, Moonraker, OctoPrint, Bambu LAN), job → plate linking        | Done; SDCP probe verified live, full supervisor not yet tested live |
| Spoolman (optional)                                                                                 | Done, mock-tested only                                              |
| Release (Unraid template, domain, public repo)                                                      | Not started                                                         |

Latest real-geometry result (Elegoo Centauri Carbon, 256 × 256 with the cutter
keep-out, pack 1.0.1): **21 plates, no warnings, export guard clean**; both wings fit
with ~0.1 mm clearance; footrest and harness each on one plate.

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
