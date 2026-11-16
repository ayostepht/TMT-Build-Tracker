# Issue #59 plan: Spoolman filaments

_Recovered 2026-11-16 from the previous orchestrator session. Rewrite in place as decisions
change._

Branch `feat/spoolman-filaments` (from `edge` a71f3ac), developed in its own worktree(s).
**Nothing merges until 0.9.2 is on `main`** (maintainer, 2026-11-16); pull requests may be
opened as drafts. Three stacked pull requests: (1) discoverability, filament link,
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

## Open questions (asked 2026-11-15; 1-4 answered below, 5 still open)

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
