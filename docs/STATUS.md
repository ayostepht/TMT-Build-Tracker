# Project status and handoff

_Last updated: 2026-11-04, after commit `f4e7715` (kit pack 1.0.1). Keep this file
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
| Build tabs: Overview · Design · Print · Parts · Finish · Settings; Builds/Printers nav              | Done                                                                |
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
- One place per task: kit files live in the setup wizard's template step and Print →
  print settings; the hardware model is not user-uploadable.
- Chapters are optional (personal "My builds" workspace). Printers work in personal workspaces.
- Palettes/generator exclude matte, silk, transparent, glow, marble, wood, glitter, rock
  textures, multi-color, CF/GF and non-95A TPU (strength). Manual picks are unrestricted.
- Spoolman stays optional ("just another thing to update").

## Open questions for the maintainer

1. Confirm the MakerWorld page used for credit and guide links:
   https://makerworld.com/en/models/2066081-3d-toddler-mobility-trainer
2. Front caster mount pose (orientation of the open end) was set with ~70% confidence:
   check under the front of the wing in the 3D view.
3. Grant the GitHub token **Actions: Read** so CI logs can be read. The e2e job failed on
   GitHub for `7d40f61` (passes locally); never diagnosed because logs were unreadable.
4. Release milestone inputs: "Unraid Boot Config" Read/Write (for the Unraid template),
   the domain name for Nginx Proxy Manager, Authentik OIDC client details, when to make
   the repo public.
5. Real sliced Elegoo 3MF (".gcode.3mf" / "export plate sliced file") to test reading
   print times and grams per plate.

## Known gaps and backlog

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
