# Orchestrator handoff

_Updated 2026-11-20, 00:30 UTC. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
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

- **0.9.3 released** 2026-11-19: tag `v0.9.3` on `main` a64fa26; `latest`, `0.9.3`, `0.9` and
  `sha-a64fa26` share one digest (checked 2026-11-20). Recorded in STATUS item 0. Contents:
  Spoolman filaments (#71, #77, #81 fixes #79), #74, #76, #80, resource limits (#82, #84).
- **Test copy:** r62 = `edge` 5290765 (the 0.9.3 app code) deployed 2026-11-19; see
  `docs/dev/CHANGELOG.md`. The maintainer confirmed the #79 Spare figures on real data.
- **Spoolman (#59)** is complete and closed. No pull requests in flight, no agents running.
- **Next step:** nothing queued. Pick from the follow-ups below or STATUS "Next steps" with
  the maintainer.
- Dependabot: `@dependabot` commands posted through the GitHub tool arrive scrambled; use
  "Update branch" on its pull requests instead. Cloud sessions can't push tags.

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
