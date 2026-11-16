# Orchestrator handoff

_Updated 2026-11-16, 04:40 UTC. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
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
- **Test copy:** r59 = `edge` ce8afce (header Stats cards), signed off by the maintainer.
- **Spoolman (#59) pull request #71** (`feat/spoolman-filaments`, head d3e181d): first of
  three parts. Verifier on 148ac0c: check, lint, build, startup (4 migrations), full e2e
  266/0 green; one stale unit test fixed after it (test-only). Security review: no
  high/medium, four lows fixed. CI was running at 04:13 UTC; merge when green (no longer
  held). It brings migration 0003 → next deploy **r60 needs backup + migration rehearsal and
  the maintainer's OK**. Plan, decisions and progress: `docs/dev/plans/issue59-spoolman.md`.
- **Next for #59:** part 2 (adding a spool also creates the Spoolman spool, archive on
  remove), part 3 (create vendor/filament in Spoolman). Small follow-ups: `RoleSpoolman`
  editor refresh has no throttle (maintainer may want one); 1440 header detail lines
  truncate ("…") [app-shell].
- Leftover worktrees (harmless, deleting is the maintainer's call): `TMT-wt-stats-header`,
  `TMT-wt-verify`, `TMT-wt-verify-base` (Spoolman), `TMT-wt-verify-spm`, `TMT-wt-docs`.
  This environment now allows donkie.github.io (catalog updates need
  `NODE_USE_ENV_PROXY=1` here).

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
