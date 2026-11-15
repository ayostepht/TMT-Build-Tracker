# Orchestrator handoff

_Updated 2026-11-15. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
`docs/dev/STATUS.md`._

## Rules in force right now

- **Merge freeze** (maintainer, 2026-11-15): open pull requests freely, but merge nothing new
  until (1) the header pull request (`feat/stats-header`) is merged and (2) the maintainer
  signs off on it on Unraid. Goal: a clean new `main` image (the maintainer runs "Promote
  edge to main"; the release tag is theirs).
- #59 (Spoolman) work may open pull requests but never merges during the freeze.
- Pull request and issue text: no internal process notes; footer on GitHub comments.
- Run `npx prettier --write` on edited docs before committing. Docs-only pull requests take
  the CI fast path (~35 s).
- Ask questions in-session with a recommended option first; show screenshots before a UI
  pull request.

## State of `edge`

`origin/edge` = 79c2cec (docs only on top of a71f3ac). Merged 2026-11-15: #50 (#46
accounting), #51 (#47 Stats), #52/#57 (r56/r57 docs), #53 (chevron), #54 (CI docs fast
path), #55 (Prettier rule), #58 (#56 design change on a started build), #60 (this handoff),
#62 (r58 docs). Docs-only handoff/deploy-notes pull requests may merge during the freeze
(maintainer, 2026-11-15). The test copy runs r58 = `edge` a71f3ac (#56 included; deployed
2026-11-15, rehearsal clean). Next deploy, r59 = the header pull request, after it merges.
No migrations.

## In flight

### `feat/stats-header` (pushed, head be40a7f, no pull request yet)

- Stats fixes from the r57 check: chart x-labels thinned by collision (`visibleLabels` in
  `charts/scale.ts`); "Show data" and the workspace builds table scroll inside their card
  (sticky first column, edge shadow); the failures chart counts part-level failed runs
  (plate, or a "Not on a plate" row); hours rounded alike (whole hours from 100 h logged).
- `domain/kpis.ts` `buildKpis(view, now)` is the single source for the four headline numbers
  (Stats tiles and header); shared pieces in `domain/stats-core.ts`; `stats.ts` re-exports.
- Header (`BuildHeader.svelte`): four compact `StatTile` cards (Parts, Time, Filament,
  Finish) linking to Stats on every build tab, four across on phones; Time and Filament show
  "X of ~estimate"; the details line holds only "N printing · N to reprint · deliver-by" and
  hides when empty (with its phone caret); cards hidden on the Design tab at ≤760 px; drafts
  unchanged. About +1.4 KB gzip on build pages. New `e2e/header-kpis.spec.ts`; several specs
  moved from `.overall-top` text to the Parts card aria-label.
- **Open, show the maintainer before the pull request** (the old screenshots were lost with
  the previous container; take new ones at 390 and 1440 px):
  - a) **Decided** (maintainer, 2026-11-15): on phones the estimate truncated ("30.5 h of …");
    keep four cards across and show a short "of ~382 h" on its own line under the value.
  - b) Bug: the Parts card reads "0of 33" (no space before the unit) → `app-shell`, or
    `design-studio-ui` if it is `StatTile`'s unit spacing.
  - c) Deliver-by stays in the details line (no card shows it): mention it.
- Not yet run on the final head: the whole e2e group together (the last fix re-ran only
  `log-plate`, 8/8). The verifier gate covers it.
- `app-shell` is fixing a) and b) in a local worktree (not pushed yet), with new screenshots.
- **Next steps:** (1) review the a/b fix and its screenshots with the maintainer, commit and
  push to `feat/stats-header`; (2) STATUS and
  `docs/architecture.md` notes (Stats: `kpis.ts`/`stats-core.ts`, failures rule, rounding,
  label thinning, table scroll; App shell: header cards), Prettier on the docs; (3)
  `verifier` in a fresh worktree with a real `npm ci` (a symlinked `node_modules` breaks
  `npm run check` with ~376 `./$types` errors), full vitest + build + full e2e; (4) pull
  request into `edge`; (5) merge only with the maintainer's OK; (6) r59 deploy on Unraid
  (header, no migrations), maintainer signs off, freeze lifts.

### `feat/spoolman-filaments` (#59; branch from a71f3ac, nothing written yet)

- Prototype approved by the maintainer ("Looks great"):
  https://claude.ai/artifact/McTWfeDj42QF26FJ74uDC3. The detailed plan file was in the
  previous session's scratchpad and is lost; its text is recoverable from that archived
  session's transcript ("Plate 9 retry bugs").
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
