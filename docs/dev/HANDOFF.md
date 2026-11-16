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

`origin/edge` = ce8afce. Merged 2026-11-16: #64/#65 (handoff), #66 (Stats tests pinned
creation dates; they failed from 2026-11-16 on), #67 (build header Stats cards, Stats
fixes, e2e fixes incl. the `kit-import` locator that also failed on `edge`). The test copy
runs r58 = `edge` a71f3ac. **r59 = `edge` ce8afce** (image `sha-ce8afce`, no migrations):
the CI image job was running at 01:42 UTC; once it's published the maintainer pulls it on
Unraid (backup + rehearsal per routine).

## In flight

### `release/0.9.2` (main checkout, from `edge` ce8afce, not pushed yet)

- `release-pwa`: version 0.9.2 (package.json + lock), CHANGELOG `[0.9.2] - 2026-11-16`
  with an upgrade note (back up `/data`; migrations 0001/0002, additive).
- `kit-and-startup`: frozen fixture `src/lib/server/db/fixtures/v0.9.2/` (invented data,
  exercises 0001/0002).
- Then: `verifier` → pull request into `edge` → merge only after the maintainer signs off
  r59 → maintainer runs "Promote edge to main", merges, tags `v0.9.2` (release form Target
  `main`, see STATUS item 0).

### `feat/spoolman-filaments` (#59; pushed, head 451a07a, no pull request yet)

Nothing merges until 0.9.2 is on `main`. Plan, decisions and progress:
`docs/dev/plans/issue59-spoolman.md`; contracts in `docs/architecture.md` (Build state, Kit
and startup, Printers). Done: migration 0003 (incl. `print_runs.created_at`, maintainer:
exact column), build-state rules/view/activity, catalog regenerated with SpoolmanDB ids
(this environment now allows donkie.github.io; the script needs `NODE_USE_ENV_PROXY=1`
here), printers stage 3, security review (no high/medium; four lows fixed). Decisions
2026-11-16: catalog extended (not runtime lookup); fallback densities and 200 g spool weight
OK; switching kept-by to "something else" keeps existing deductions.

- Now: `app-shell` (FilamentTiles, wizard Spoolman step, picker warnings, Settings
  screenshots) ‖ `design-studio-ui` (SlotPanel), both in the Spoolman worktree.
- Next: show the maintainer screenshots → `e2e-playwright` (Spoolman spec, printers.spec on
  the shared mock) → `verifier` (fresh worktree) → draft pull request into `edge`.

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
