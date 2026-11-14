# Changelog

Internal deploy history, append-only, newest first. "rN" is the Nth deploy to the
maintainer's test copy. Public release notes live in the root `CHANGELOG.md`, not here.
Nobody needs to read this to work; current behaviour is in `docs/architecture.md`, current
state in `docs/dev/STATUS.md`. Add one entry per deploy (2-4 lines: what changed, why, commit).

## 2026-11

- **r54** (published `sha-cfac2e0` = `edge` cfac2e0, same digest, 2026-11-14): palette re-apply
  resets part colors, "Lock color", removing a used color with a replacement (#36); picker
  Type counts match the grid, phone stage credit in a band under the 3D view (#38); docs
  (#37). No migration. Rehearsal clean: health 0.9.1, row counts equal in 37 tables, the
  live build's rows identical; the kit pack reinstalled there only because a rehearsal copies
  `tmt.db` without the `uploads/kitpack` marker (live logged nothing: current on 1.0.2).
  Checks on a copy of the live data (360, 390, 1440): reset note "Resets 2 part changes ·
  2 locked kept", locked parts kept their filament on an added slot, Undo restored all;
  remove dialog (2 parts, Cancel focused, TPU slots disabled with "needs PETG", activity
  "removed …; its 2 parts now use …", no Remove on kit slots); Type counts equal the grid;
  credit band readable at 360. Found by the maintainer on the phone: #39 (lock spreads to a
  mirrored part on another color). Rollback: re-tag `r53` as `test`, no restore.
- **r53** (published `sha-296cd50` = `edge` 296cd50, same digest, 2026-11-13): 0.9.1 (#18, #19,
  #21, #22, #26, #27), picker Type filter (#32), one-piece push handle with kit pack 1.0.2
  (#33), layout-picker race fix and CI e2e limit (#35). No migration. Rehearsal clean: health
  0.9.1, "updated templates", "added 2 part rows to existing builds" (the one-piece handle,
  To print), kit pack 1.0.2 installed the model (1.0.1 before, not admin-imported) and 1 new
  geometry row (`push-handle-one-piece`), 40 admin rows kept with no `source_note` change;
  only those row counts changed. Live build unchanged apart from the new To print row.
  UI checks on a copy of the live data: all passed except "Foaming", which the catalog
  cannot show (no foaming TPU). The maintainer checked it on their phone, all good.
  Rollback: re-tag `r52` as `test`, no restore.
- **r52** (published `edge` image, 3ec52a7, 2026-11-13; tagged `edge-3ec52a7`): the first
  test-copy deploy from the `edge` channel. Plate retry keeps a live plate Printing, Printing
  takes the printer's start time, unlogged-print notice (#18); "Where is it printing?" sheet
  fits a phone with a long file name (#19); minimatch override (#21). No migration, so no
  rehearsal. The maintainer checked all four on Unraid, all passed. Rollback: re-tag `v0.9.0`
  as `test`, no restore.
- **r51** (published `latest` image = v0.9.0 = 74d9a42, 2026-11-12): the first deploy of a
  published image instead of a local build; no app-code changes from r50. No migration.
  Rollback: re-tag `r50` as `test`, no restore.
- **r50** (e4584d5, from main 9ed6906): every printer WebSocket through `ws` (1 MiB limit, no
  compression or redirects, handshake timeout; link sockets pinned to the validated
  address); Partly printed kept when a next run is taken off; grams reject text and accept a
  decimal comma; printer report issue form. No migration; `npm ci` clean, ws 8.22.1 in the
  pruned image; rehearsal clean. Live Elegoo link: connected 3 s after start, one socket,
  0 reconnects in 20 min while printing. 5 checks passed.
- **r49** (ca4d9c1, from main bec473e): Integrations is the one place to add, edit and remove
  printers (compact chooser, setup steps, auto-log, Spoolman); OctoEverywhere links for
  Klipper and OctoPrint; "Not connected" printers; one-step link when the chosen printer is
  printing; log sheet takes decimal grams and shows refusals; socket handshake, receive and
  silence limits. No migration; rehearsal clean (row counts equal). Live Elegoo link: one
  socket, 0 reconnects and no status flap in 15 min while printing. 10 checks passed.
- **r48** (c64d852, from main 1e18c6c): one status badge for plates and parts (Printing with
  a connected printer asks "Where is it printing?"), phone color picker layout, Help in the
  nav, Printers page hides unlinked prints behind a disclosure, build-details save logs only
  changed fields, public docs wording. No migration; rehearsal clean (row counts equal).
  Checks on a copy of the live data: 8 of 10 pass; failed: the log sheet's grams `step="1"`
  blocks Save with fractional slicer grams (pre-existing); open: the second link confirm.
- **r47** (0245ca8, from main c47ecca): UI only, from the maintainer's r45 phone review:
  builds-first landing, "Printing on <printer>" as the main start with a printer
  connected, Options as the designer's first tab, picker filters wrap on the phone,
  account-menu About and a footer, compact Overview filaments, 44 px Print tab buttons.
  Rehearsal clean (no upgrade line, row counts equal); 8 UI checks passed on a copy of
  the live data with the simulated printer.
- **r46** (cfe1c61, from main 2185ff4): migration squash. The 14 migrations become one
  baseline; a database at the full old chain is upgraded at startup in one transaction
  (7 tables rebuilt, journal 14 → 1), anything else refuses to start. Adds ON DELETE
  CASCADE on `templates.owner_org_id`. Rehearsal and live: one upgrade line, none on
  restart, `sqlite_master` identical to an empty install, FK and integrity checks clean,
  row counts identical in 36 tables; all build tabs checked on the rehearsal copy.
- **r45** (b9ea636, from main 7fba2db): Stage 5 pages (`/privacy`, `/terms`, build guide
  link, landing navigation), Files heading fix, version 0.9.0, Cancel-first destructive
  dialogs and focus return, design studio a11y pass, 44 px touch buttons, no stored SSO
  tokens or session IPs (startup `auth-cleanup.ts`). Rehearsal and live: one cleanup line
  (7 sessions, 0 accounts), none on restart, row counts identical in 37 tables. README
  screenshots added afterwards from a throwaway instance.
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
  (`docs/dev/archive/ux-audit-design-studio-2026-11.md`): two-pane desktop, pinned phone stage,
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
