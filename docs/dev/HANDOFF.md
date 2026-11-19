# Orchestrator handoff

_Updated 2026-11-19, 17:55 UTC. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
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
  maintainer on 2026-11-19 for testing. r61 (`edge` 5c17a88: #74 deps, #76 ORIGIN fix, #77
  Spoolman parts 2-3) was published but not deployed separately.
- **Merged into `edge` on 2026-11-19:** #76, #74, #77, #78 (overnight), #80 (header cards: short
  detail lines on desktop; exact plate-name locators in e2e), #81 (fixes #79: Spare while
  Spoolman-linked counts all open spools of the filament; links from before link times existed
  get stamped on the next editor load, so older prints are never subtracted again; older
  role-less deductions count as delivered).
- **Next deploy, r62 = `edge` 1716662 image** (no migrations; brings #74, #76, #77, #80, #81):
  needs the maintainer's OK; backup per routine. Check on the test copy: the three colours from
  #79 (TPU 95A Black ≈ 685 g spare with two open spools; the two finished blues show their
  Spoolman remaining, not short, after the first editor load), and the Spoolman create, add-spool
  and archive flows against the real Spoolman. #79 closes with #81.
- **Spoolman (#59)** is complete (all three parts). Plan and decisions:
  `docs/dev/plans/issue59-spoolman.md`. Close #59 once r62 is checked.
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
