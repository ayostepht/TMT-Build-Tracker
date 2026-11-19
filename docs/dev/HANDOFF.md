# Orchestrator handoff

_Updated 2026-11-19. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
`docs/dev/STATUS.md`._

## Rules in force right now

- **Merging** (maintainer, 2026-11-16): the orchestrator may merge its own pull requests
  into `edge` once the routine was followed and CI is green. Promotions to `main` and tags
  follow STATUS item 0's release routine; cloud sessions can't push tags, so the maintainer
  creates the tag from the release form (Target `main`).
- Pull request and issue text: no internal process notes; footer on GitHub comments.
- Run `npx prettier --write` on edited docs before committing. Docs-only pull requests take
  the CI fast path (~35 s).
- Ask questions in-session with a recommended option first; show screenshots before a UI
  pull request.

## State

- **0.9.2 released** 2026-11-16: `main` 48c9649, tag `v0.9.2`, images `latest`/`0.9.2`/`0.9`
  (STATUS item 0).
- **Test copy:** r60 = `edge` a501e5e (Spoolman part 1, migration 0003) being deployed by the
  maintainer on 2026-11-19 for testing (r59 = ce8afce before it).
- **Spoolman (#59) part 1 merged** as #71. **Parts 2 and 3 in progress** as one pull request
  from `feat/spoolman-create` (worktree `TMT-wt-spoolman2`, from `edge` 2797e2d). Decisions
  (2026-11-19) are in `docs/dev/plans/issue59-spoolman.md`: on a linked colour the + becomes
  "Add spool in Spoolman" (removing asks whether to archive in Spoolman); "Create in
  Spoolman" (vendor + filament, prefilled from the catalog) lives in the link picker; editors'
  page-load refresh stays unthrottled.
  Order: `printers` (client, routes, mock, picker create flow) → `app-shell` (FilamentTiles
  "Add spool in Spoolman" form, archive question) → `e2e-playwright` → `security-reviewer`
  (new outbound writes) → `verifier` → pull request → r61 after the maintainer tests r60.
- Follow-up: 1440 header detail lines truncate ("…") [app-shell].
- The old worktrees were deleted (maintainer, 2026-11-19). This environment allows
  donkie.github.io (catalog updates need `NODE_USE_ENV_PROXY=1` here).

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
