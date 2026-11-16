# Orchestrator handoff

_Updated 2026-11-16. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
`docs/dev/STATUS.md`._

## Rules in force right now

- **Goal: release 0.9.2 from today's work, without Spoolman** (maintainer, 2026-11-16).
  Order: header pull request merges → `edge` image → r59 on the test copy (deploy needs the
  maintainer's OK) → release pull request into `edge` (version, `CHANGELOG.md`,
  `fixtures/v0.9.2/`) → the maintainer runs "Promote edge to main", merges it and tags
  `v0.9.2`.
- **Merging** (maintainer, 2026-11-16): the orchestrator may merge any of its pull requests
  into `edge` once the routine was followed and CI is green, except Spoolman work.
- **Spoolman (#59) does not merge until 0.9.2 is on `main`.** It is developed meanwhile in
  its own worktree(s) and branches; pull requests may be opened (draft) but stay unmerged.
- Pull request and issue text: no internal process notes; footer on GitHub comments.
- Run `npx prettier --write` on edited docs before committing. Docs-only pull requests take
  the CI fast path (~35 s).
- Ask questions in-session with a recommended option first; show screenshots before a UI
  pull request.

## State of `edge`

`origin/edge` = 42e1437 (docs only on top of a71f3ac). Merged 2026-11-15: #50 (#46
accounting), #51 (#47 Stats), #52/#57 (r56/r57 docs), #53 (chevron), #54 (CI docs fast
path), #55 (Prettier rule), #58 (#56 design change on a started build), #60 (this handoff),
#62 (r58 docs), #61/#63 (handoff). The test copy runs r58 = `edge` a71f3ac (#56 included; deployed
2026-11-15, rehearsal clean). Next deploy, r59 = the header pull request, after it merges.
No migrations.

## In flight

### `feat/stats-header` (pushed, head da4b3e7, no pull request yet)

- Stats fixes from the r57 check: chart x-labels thinned by collision (`visibleLabels` in
  `charts/scale.ts`); "Show data" and the workspace builds table scroll inside their card
  (sticky first column, edge shadow); the failures chart counts part-level failed runs
  (plate, or a "Not on a plate" row); hours rounded alike (whole hours from 100 h logged).
- `domain/kpis.ts` `buildKpis(view, now)` is the single source for the four headline numbers
  (Stats tiles and header); shared pieces in `domain/stats-core.ts`; `stats.ts` re-exports.
- Header (`BuildHeader.svelte`): four compact `StatTile` cards (Parts, Time, Filament,
  Finish) linking to Stats on every build tab, four across on phones; Time and Filament show
  a short "of ~382 h" line under the value at all widths (full sentence in the aria-label);
  `StatTile` puts a real space before the unit ("3 of 33"); the details line holds only
  "N printing · N to reprint · deliver-by" and hides when empty; cards hidden on the Design
  tab at ≤760 px; drafts unchanged. `e2e/header-kpis.spec.ts` checks no truncation at 390.
- Maintainer approved the 390/1440 screenshots (2026-11-15). STATUS and
  `docs/architecture.md` notes are on the branch (merged with `edge` 79c2cec+).
- Known, not blocking: at 1440 the Parts and Finish detail lines end in "…" (full text on
  hover and in the details line), a possible small follow-up [app-shell].
- **Verifier (da4b3e7): FAIL.** check, lint, 1909 unit tests and build pass; full e2e 253
  passed, 4 failed: `r47-tracking-shots:11` (waits for the `header-details` toggle, which
  now only renders when there is something to show), `kit-import:365` (expects the old
  "of printing left" text), `export:15` (gets "Download .3mf project" instead of ".zip";
  passes on `edge`, cause unknown) and `kit-import:221` (strict-mode locator; fails on
  `edge` too). `e2e-playwright` is fixing all four on the branch and re-running the full
  suite; if `export` turns out to be an app bug it reports back instead of editing `src/`.
- **Next steps:** (1) e2e fixes green → re-run `verifier` → open the pull request into
  `edge`; (2) merge once CI is green; (3) r59 deploy on Unraid
  (header, no migrations) with the maintainer's OK; (4) the release pull request (see the
  goal above).

### `feat/spoolman-filaments` (#59; local only, branch from `edge` 3420884)

- Started 2026-11-16: `kit-and-startup` is writing migration 0003 (filament id + link time
  per slot, `spoolman_cache`, Spoolman spool id on added spools, ledger entries with a role,
  the "kept up to date by" setting). Nothing merges until 0.9.2 is on `main`.
- Prototype approved by the maintainer ("Looks great"):
  https://claude.ai/artifact/McTWfeDj42QF26FJ74uDC3. Full plan, findings and the
  maintainer's answers (all questions answered): `docs/dev/plans/issue59-spoolman.md`.
- Three stacked pull requests: (1) discoverability, filament link, auto-advance, Spoolman
  stock, a "kept up to date by: this app / something else" workspace setting, and handling
  of prints from before the link; (2) adding a spool also creates the Spoolman spool
  (archive on remove); (3) create vendor/filament in Spoolman.
- Agent order: `kit-and-startup` (migration 0003) → `build-state` (contracts, activity) ‖
  `filaments-catalog` → `printers` (client, `mock-spoolman.ts`, deduct with lock +
  auto-advance, routes, shared components, Settings) → `app-shell` (wizard virtual step,
  `FilamentTiles`) ‖ `design-studio-ui` (`SlotPanel`) → `e2e-playwright` →
  `security-reviewer` → `verifier`. Expect a couple of feedback rounds.

## Notes for the next orchestrator and its agents

- Agents in a worktree with a symlinked `node_modules` filter the pre-existing `./$types`
  errors from `npm run check`; the verifier uses a fresh worktree and `npm ci`.
- E2E: take the lock from `docs/dev/dev-environments.md`, `--reporter=line`. Builds in a
  shared worktree collide too: tell parallel agents to rerun on a build collision.
- Repeated identical handback messages from agents are duplicates; ignore them.

## Follow-ups

- STATUS open items: BuildHeader missing-weight hint; twin plates file grams; wizard "Skip
  setup" clipped at 390 px; the workspace Stats page loads every build view (cache later);
  a part printing by hand with no arranged plate doesn't block a full design replace.
- Release suggestion given to the maintainer: release pull request (version, CHANGELOG,
  `fixtures/v0.9.2/`) → Promote edge to main → tag; release notes: back up `/data`
  (migrations 0001/0002).
