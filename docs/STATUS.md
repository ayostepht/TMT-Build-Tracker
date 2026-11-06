# Project status and handoff

_Last updated: 2026-11-06, after the print time estimates and Start printing on the Print tab. Keep this file
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

1. Sliced file to test reading print times and grams: an export **from the app**, sliced in
   Elegoo Slicer and saved with File → Export → "Export plate sliced file" (one or two
   plates is enough). Pending.
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

- Done 2026-11-06 (not yet deployed): print time for arranged plates. They carry no time of their
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
