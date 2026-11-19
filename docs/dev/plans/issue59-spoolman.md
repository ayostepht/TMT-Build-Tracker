# Issue #59 plan: Spoolman filaments

_Recovered 2026-11-16 from the previous orchestrator session. Rewrite in place as decisions
change._

Part 1 merged as #71 (2026-11-16, after 0.9.2 was on `main`). Parts 2 and 3 ship together
as one pull request from `feat/spoolman-create` (maintainer, 2026-11-19). Originally three
stacked pull requests: (1) discoverability, filament link,
auto-advance, Spoolman stock, the "kept up to date by" workspace setting and pre-link
prints; (2) adding a spool also creates the Spoolman spool (archive on remove); (3) create
vendor/filament in Spoolman. The clickable prototype was approved ("Looks great").

## Findings (Plan agent)

- client.ts: req() guarded (assertOutboundAllowed + guardedFetch, 6 s, 4 MiB); listSpools/getSpool/useWeight(PUT /use)/restoreWeight (non-atomic PATCH).
- deduct.ts syncRunDeduction: want per _current_ spool link -> re-sync after spool change would move grams; ledger in org settings JSON runId -> [[spoolId, g]]; no lock (double-deduct race).
- build_filaments.spoolman_spool_id; linkSpool accepts any int; SpoolLink.svelte only in Settings; SpoolRemaining in FilamentTiles.
- No shared Spoolman mock (inline in spoolman.test.ts and printers.spec.ts).
- Catalog drops SpoolmanDB id/density/spool weight; slots store only name/material/hex (no brand ref).
- Wizard steps hard-coded 1-5.

## Plan (summary)

- Migration 0003: build_filaments.spoolman_filament_id; spoolman_cache table (org, filament, data, fetched_at, error); SpoolAdd.spoolmanSpoolId; ledger entries [spool, g, role]; lazy backfill of filament id.
- build-state: BuildView.spoolman, FilamentRole.spoolman summary; haveGramsOf; activity kinds filament.spoolman.link/.spool/.create, stock add/remove extras.
- printers: client additions + validation, withSpoolmanLock, per-role deduction with auto-advance + LIFO give-back, cache/offline, routes (filaments ranked, link, current, create, stock with spoolman), shared mock-spoolman.ts, shared components SpoolmanFilamentPicker / SpoolmanSlotLine, Settings rework.
- filaments-catalog: keep sdbId/density/spoolWeightG (or use Spoolman /external/filament [verify]); resolveSlotOrigin; spoolman-defaults.ts.
- app-shell: wizard virtual step ?step=spoolman; FilamentTiles line, + form checkbox, remove-archive ask.
- design-studio-ui: SlotPanel line.
- e2e: spoolman-filaments, spoolman-create, extend spool-stock, printers.spec to shared mock.
- security-reviewer (first write-heavy outbound), verifier.

## Open questions (asked 2026-11-15; all answered below)

1. Spare when linked with auto-deduct OFF.
2. Several builds sharing one filament.
3. Editors may create vendors/filaments in Spoolman?
4. Linking to an existing filament: ignore app's starting spools? + form unticked on linked colour = history only?
5. Catalog: extend (~300 KB) vs Spoolman /external/filament.

## Maintainer answers (2026-11-15)

- Spare with auto-deduct off: LET THE USER CHOOSE — workspace Spoolman setting "Spoolman is kept up to date by: this app (auto-deduct) / something else". Spare follows it.
- Shared filament across builds: note "Shared with N other builds" on the row; Spare per build.
- Editors may create vendors/filaments/spools and archive in Spoolman.
- Linking to an existing filament: hide app's starting + added spools while linked; history kept; shown again on unlink.
- NEW: prints may have been logged manually BEFORE Spoolman was linked. Must account for it:
  - store linkedAt per slot; runs dated/created before the link are never deducted (also on edit/undo of those runs);
  - on link, show "N g already logged on this build before linking" and ask: "Spoolman's weight is current (default)" vs "Also subtract those N g from Spoolman now" (one-off deduction recorded in the ledger, undoable);
  - Spare when linked never double-counts pre-link grams.

## Maintainer answer (2026-11-16)

- Catalog (question 5): extend the bundled catalog with the SpoolmanDB id, density and spool
  weight (~+300 KB), so suggestions work offline and the same everywhere. No runtime
  `/external/filament` dependency.

## Progress

- 2026-11-16: migration 0003 + typed accessors done (`kit-and-startup`); contracts in
  `docs/architecture.md` "Kit and startup".
- 2026-11-16: `print_runs.created_at` added to 0003 (maintainer: exact column); build-state
  rules, view and activity; catalog regenerated with SpoolmanDB ids; printers stage 3 (server
  side, shared components, Settings). Decision: switching kept-by to "something else" keeps
  existing deductions; only deleting or undoing a print gives grams back.
- Next: security review; place `SpoolmanSlotLine` in FilamentTiles / wizard (app-shell) and
  SlotPanel (design-studio-ui) with screenshots; e2e spec + printers.spec on the shared mock;
  verifier; draft pull request (no merge before 0.9.2 is on `main`).

## Maintainer answers (2026-11-19), parts 2 and 3

- Adding a spool on a **linked** colour: the + comes back as "Add spool in Spoolman". It
  creates a spool of the linked filament in Spoolman (weight; optional note), shows in the
  colour's history, and stock keeps coming from Spoolman. Removing it asks "Also archive it in
  Spoolman?". Unlinked colours keep today's app-only spools.
- Creating vendors and filaments: in the link picker. When nothing matches, "Create in
  Spoolman" with vendor, name, material, colour, density and spool weight prefilled from the
  catalog (`resolveSlotOrigin` / `spoolmanDefaults`, editable); creates the vendor if missing,
  then links the colour to the new filament. No separate Spoolman page.
- Parts 2 and 3 in one pull request (r61).
- Editors' page-load refresh stays unthrottled (maintainer, 2026-11-19).

## Progress (parts 2 and 3)

- 2026-11-19: printers (client create vendor/filament/spool + archive, routes, mock,
  picker "Create in Spoolman"), build-state (`SpoolAddView.spoolmanSpoolId`), app-shell
  ("Add spool in Spoolman", archive question, e2e). Next: security review → verifier →
  pull request → r61.
