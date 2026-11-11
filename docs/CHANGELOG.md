# Changelog

Append-only history, newest first. "rN" is the Nth deploy to the maintainer's test copy.
Nobody needs to read this to work; current behaviour is in `docs/architecture.md`, current
state in `docs/STATUS.md`. Add one entry per deploy (2-4 lines: what changed, why, commit).

## 2026-11

- **r44** (6ce39e3): Stage 4 finished: wave 3 (every screen on `ds-seg`/`ds-badge`/
  `ds-modal`/`ds-card`, native dialogs), old global styles deleted from `app.css`,
  `focus-trap.ts`, the legacy tab redirects and `src/lib/index.ts` deleted, one shared
  `isObj`; `three`/`pdfjs-dist` to devDependencies (image 531 → 408 MB); first Stage 5 slice
  (README and guides, `/help`, `/about`). No migration; rehearsal clean (row counts
  identical in 37 tables). Old tab URLs now 404.
- **r43** (eba0e72, CI green): Stage 4 wave 2: component styles on the design tokens,
  focus trapping with an inert background, one printer stream per chapter; agent
  definitions drop removed code. No migration or startup change; landing, Print/Files tabs
  and live printer status checked on a copy of the live data.
- **r42** (1907861): the audit so far: Stage 1 security hardening, Stage 2 phone shell and
  landing (Now printing / Next up), Stage 3 installable PWA, Stage 4 removals (prototype
  import, 3D re-orientation code), kit pack 1.0.0 out of the image, better-auth 1.7.18,
  vite 8.3.6, vitest 5, OctoEverywhere reconnect backoff (no 2 s redial loop). Migration
  0013 (`site_admin`); empty-`/data` run and rehearsal clean (14 migrations, row counts
  unchanged, kit current). Arrange for the Centauri Carbon still 21 plates, guard clean.
- **r41** (7e05586, PR #2): Elegoo printers can connect through an OctoEverywhere shared
  link (encrypted secret) instead of the LAN address, so TMT doesn't use one of the
  Centauri Carbon's limited direct connections; status and camera go via OctoEverywhere,
  no Cmd 386 on that path. No schema change, no rehearsal.
- **r40** (a9bedcb, PR #1): a plate's filament grams go only to its parts' roles (the
  sliced file put plate 15, accent PETG, on the TPU black slot: 423 g "used" with no TPU
  printed); Spoolman deduction uses the same rule. No schema change, no rehearsal.
- **r39** (9839be7, ee69a3a): security fix (a Moonraker status frame with `__proto__`
  could pollute `Object.prototype`); cancelled/failed prints that never started log no run
  or filament, part-way stops default to Failed with grams scaled by progress; collapsed
  per-plate History on the Print tab. No schema change, no rehearsal.
- **r38** (6be1868, hotfix): printer jobs auto-link only when the file name names the
  plate (the "one plate still Printing" fallback kept re-attaching prints to multi-run
  plates); "Start on <printer>" asks to confirm the plate; "Take off printer" unlinks the
  live job. No schema change, no rehearsal.
- **r37** (d1a815c): Palettes tab gets two collapsed disclosures; `/designs/[slug]` "Use
  this design" scrolls/focuses the Use card; design preview hides inactive variants (wheel
  z-fighting fixed).
- **r36** (ac72cda): printer store refetches after SSE reconnect / iOS backgrounding and
  shows load errors. Confirmed on the maintainer's phone 2026-11-10.
- **r35** (5e0535f): mobile performance (3D view-change work skipped when unchanged, WebGL
  context restore, palettes 1.6 s → 0.1 s long task, 16 px fields, gzip).
- **r34** (d6add5e): filament catalog `no-cache` + ETag (phones kept the pre-r30 catalog
  for a day under `max-age=86400`).
- **r33** (780cd6f): Palettes becomes its own tab; Schoolhouse brand chip; link sweep
  (action links → `.btn.go`/`.btn.back`/`.btn.ghost`/`.pill-link`, `.linkbtn` removed).
- **r31-r32** (24ce2b2, ef930bb): design studio redesign from the UX audit
  (`docs/archive/ux-audit-design-studio-2026-11.md`): two-pane desktop, pinned phone stage,
  picker in pane, part chip, DesignActions.
- **r30** (a1a31e1): filament supplement (Schoolhouse Spools, missing Overture TPU 95A).
  SpoolmanDB upstream PR parked (needs measured spool weights).
- **r29** (9e4734f): manual plate times override file times (a sliced project had plate
  15 on the TPU slot at 32.7 h while the real PETG print took 13 h 39 m); pace compares
  each run with its own time.
- **r28** (37d63eb): Now printing card overflow on phones (`minmax(0,1fr)` tracks).
- **r26-r27** (fa831df, c1ff46d): TPU slots named by role, colored tires, preferred-brand
  list, camera collapse; look-alike swatches merged across brands.
- **r25** (ad2f8ad): choose the run on per-part plates; Activity entries link to plates
  and parts.
- **r23-r24** (294cf2b, 4751769): live printer camera on the Now printing card; Elegoo
  SDCP Cmd 386 camera enabler (the one allowed printer write).
- **r22** (ea20300): Print tab drops "Ready to print" and bulk logging; groups by Plate.
- dadd250: palette generator with locked colors; plate runs shown in a part's print log.
- **r20** (8c19157, d837760): Studio drafts (`builds.kind = 'draft'`).
- **r19** (a3465d6): log a whole plate, pace-adjusted plate times, twin-part handling and
  startup twin repair.
- **r18** (188e89f, 33b02ac): sliced files as a print template (learned per-part data).
- **r17** (87b6fc3): Files tab UX (visible sliced-file upload, compact printer summary,
  safe layout switching, "Your printers" across workspaces).
- **r16** (fb92a45): large sliced 3MF uploads (1 GB, central-directory reads).
- ae8497f: print time estimates for arranged plates; Start printing on the Print tab.
- **r14** (3a32759): build tabs reordered (Overview, Design, Print, Files, Finish, Settings).
- 5eec61a: custom filaments per workspace. c7ea111: Unraid guide and template.
- f4e7715: rigid multi-piece groups, kit pack 1.0.1. c45b1cd: edge margins, keep-outs.
  7d40f61: setup wizard, kit pack. b345442: true-outline flat fitting. 5da23aa: never
  re-orient in 3D.
- 80a2f2e: assembly, photos, handoff, printers, Spoolman (milestones 6-7). 1bb95d4: 3MF
  export. f26ceb1: 3D designer, shareable designs, 3MF plates (milestones 4-5). 27c8784:
  variants. 297a909: prototype import (milestone 3). 72ac628: multi-build, teams, live
  updates (milestone 2). ff3c770: scaffold (milestone 1).
