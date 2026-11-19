# Orchestrator handoff

_Updated 2026-11-19, 05:20 UTC. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
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

- **0.9.2 released** 2026-11-16 (`main` 48c9649, tag `v0.9.2`; STATUS item 0).
- **Test copy:** r60 = `edge` a501e5e (Spoolman part 1, migration 0003), deployed by the
  maintainer on 2026-11-19 for testing.
- **Merged into `edge` overnight 2026-11-19** (maintainer's permission for work already
  discussed):
  - #76 startup: an empty `ORIGIN` is ignored and `ORIGIN` mirrors the forced origin
    (needed for adapter-node 6.0.2, which honours `ORIGIN` and refuses an empty one);
    security review: no high/medium, two lows fixed.
  - #74 Dependabot npm minor/patch group (better-auth 1.7.25, better-sqlite3 13.2.0, SvelteKit
    3.2.0, adapter-node 6.0.2, vite 8.3.8, …), after "Update branch" onto #76; CI green.
  - #77 Spoolman parts 2 and 3 (create vendor/filament from the link picker, add spools in
    Spoolman on linked colours, archive on remove); verifier + full e2e green; security
    review: no high/medium, three lows fixed.
- **Next deploy, r61 = `edge` 5c17a88 image** (no migrations; brings #74, #76, #77): needs the
  maintainer's OK; backup per routine. Check the Spoolman create/add/archive flows against
  the real Spoolman.
- **Spoolman (#59) is complete** (all three parts). Plan and decisions:
  `docs/dev/plans/issue59-spoolman.md`. Issue #59 can be closed once r61 is checked.
- Follow-ups: 1440 header detail lines truncate ("…") [app-shell]; optional exact-name
  locator hardening in `e2e/kit-import.spec.ts:450` (one unexplained, non-reproducing
  strict-mode failure on 2026-11-19).
- Dependabot: `@dependabot` commands posted through the GitHub tool arrive scrambled; use
  "Update branch" on its pull requests instead.

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
