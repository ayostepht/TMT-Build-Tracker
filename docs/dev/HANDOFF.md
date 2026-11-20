# Orchestrator handoff

_Updated 2026-11-19, 22:55 UTC. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
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

- **0.9.3 promoted to `main`** 2026-11-19: `edge` 5290765 (#85 "Release 0.9.3") → #86, `main`
  a64fa26 (merge commit), version 0.9.3. **Waiting on the maintainer** to create tag `v0.9.3`
  and the release from the release form (Target `main`, title `v0.9.3`, notes = CHANGELOG
  `[0.9.3]`); then check the tag's image run publishes `latest`, `0.9.3`, `0.9` and
  `sha-a64fa26`, and record it in STATUS item 0. 0.9.3 adds migration 0003 (upgrade note in
  the CHANGELOG) and fixture `fixtures/v0.9.3/`.
- **In 0.9.3** since 0.9.2: Spoolman filaments (#71, #77, #81 fixes #79), dependency updates
  (#74), empty `ORIGIN` fix (#76), header detail lines and exact plate locators (#80),
  resource limits from the public edition (#82) and their follow-up (#84: entry caps before
  reading, self-host light-read bucket 600/min, `handleError` + `safeErrorText` everywhere,
  public-mode 2 MB XML cap, form `maxlength`).
- **Test copy:** r62 = `edge` 5290765 (the 0.9.3 app code, version 0.9.3) deployed
  2026-11-19 (r60 = a501e5e with migration 0003, r61 = 5c17a88; see `docs/dev/CHANGELOG.md`).
  Not yet checked signed in: the #79 colours and the Spoolman create/add/archive flows.
- **Spoolman (#59)** is complete; close #59 once 0.9.3 is checked on the test copy.
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
- Release suggestion given to the maintainer: release pull request (version, CHANGELOG,
  `fixtures/v0.9.2/`) → Promote edge to main → tag; release notes: back up `/data`
  (migrations 0001/0002).
