# Orchestrator handoff

_Updated 2026-11-22, 22:30 UTC. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
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
- **Test copy:** r65 = `edge` 9f32307 (0.9.3 plus #90 and #92–#96) deployed 2026-11-21 (r64 = 7efeb4d with migration 0004, rehearsed on a copy of the real database, 2026-11-20); see
  `docs/dev/CHANGELOG.md`. The maintainer confirmed the #79 Spare figures on real data.
- **Spoolman (#59)** is complete and closed.
- **Merged into `edge` 2026-11-20, on the test copy since r64:**
  #92 "Plates follow the kit's layout first" (6ba6bf7, with its follow-up #94 7efeb4d; kit-first arranger, planner version
  3, plan cache; no schema change) and #93 "Print some pieces of a part" (3c6ea33;
  **migration `0004_piece_prints`**, additive). #90 "Print some parts of a plate" is on the
  test copy since r63.
- **Merged into `edge` 2026-11-21:** #95 "Logged pieces are ticked and locked; Print some…
  moves into the status menu" (005f5ad; no schema change). On the test copy since r65.
  Decided by the maintainer: only piece logs lock pieces (a whole-part Success ticks all
  pieces but leaves them free).
- **Also merged into `edge` 2026-11-21:** #96 "Converted plate logs keep their pieces and
  their row" (9f32307; opened from the hosted edition's session, its counterpart there is
  #37; no schema change): a confirmed plate replacement keeps a piece log's pieces and the
  log's id.
- **Merged into `edge` 2026-11-22:** #98 "Color picker: a pick no longer hides the saved
  color; taps on touch are not treated as hover" (41513e7; no schema change; port of the
  hosted edition's #38). **Not on the test copy yet** (r65 is 9f32307). Beyond the hosted
  pull request, to bring back there: the `finally` around the save, clearing the touch flag
  on any key press, and the follow-up commit (refusal line pinned in view on a phone and
  limited to pick errors, detail row back to the saved color, the in-viewport e2e check).
- **Also merged into `edge` 2026-11-22:** #101 "Share a picture of a build's colors"
  (76a65c0; closes #99; browser only, no schema, server or dependency change). The
  maintainer approved the renderings in the session (family card; social square, portrait
  and tall with text sections; default texts say "Toddler Mobility Trainer", not "TMT").
  **Not on the test copy yet.** Unchecked: the system share sheet on a real iPhone and
  Android phone (headless Chromium has no file sharing).
- **Hosted edition port of #101, #102 and #104:** its #41 is merged there (a999ad6,
  2026-11-22, on the maintainer's go-ahead). The button stays in its demo.
- **Follow-up to #101 merged 2026-11-22:** #102 (b21d269): section text keeps typed line
  breaks, "Try again" when drawing fails, "Download started." note. Not on the test copy.
- **Preview fix merged 2026-11-22:** #104 (fbd401d): the whole picture fits the preview
  (the maintainer saw portrait and tall clipped on an iPhone). Verified in Chromium and by
  an e2e check only; the maintainer checked it on a phone on the `edge` image
  (2026-11-22: "looks great"). Decided: the button stays in the hosted edition's demo.
- **In flight:** nothing in this repository.
- **Also merged into `edge` 2026-11-22:** #100 "Add Space Coast 3D and Dancyn 3D Prints to
  the filament catalog; compact color picker" (5541c2c; no schema change). Both brands are
  official MakeGood suppliers and follow Schoolhouse Spools in the picker. The picker has
  the hosted edition's compact layout in this edition's colors (maintainer's choice after
  comparing screenshots), which also fixes swatches with a note that could not be clicked
  with a mouse; #98's behaviour is kept. **Not on the test copy yet.** The catalog change
  is open in the hosted edition as its #40 (branch `feat/filaments-space-coast-dancyn`,
  CI green); that project's session merges it (merging is deploying). To offer there:
  #98's refused-save handling, which the hosted picker lacks. To regenerate the two
  vendors a cloud environment needs `spacecoast3d.org`, `www.dancyn3dprints.com` and
  `cdn.shopify.com` on its allowed hosts; without them use
  `fetch-vendor-filaments.mjs --from-dir` with saved pages.
- The report behind #95 is explained: the
  logged pieces had been unticked by hand, which the lock now prevents.
- **Hosted edition:** the port of #95 (its #36) is merged there.
- **Next step:** deploy `edge` fbd401d to the test copy (with the maintainer's OK; needs a
  machine with `CLAUDE.local.md`), then the maintainer tests swatch taps on an iPhone (the
  touch change is unconfirmed on iOS Safari) and Share a picture's share sheet; then pick from the follow-ups below or STATUS
  "Next steps".
- CI: an `image` job once hung in build-push for 25+ min (normal is ~4 min); cancel and re-run it.
- Dependabot: `@dependabot` commands posted through the GitHub tool arrive scrambled; use
  "Update branch" on its pull requests instead. Cloud sessions can't push tags.

## Notes for the next orchestrator and its agents

- Agents in a worktree with a symlinked `node_modules` filter the pre-existing `./$types`
  errors from `npm run check`; the verifier uses a fresh worktree and `npm ci`.
- E2E: take the lock from `docs/dev/dev-environments.md`, `--reporter=line`. Builds in a
  shared worktree collide too: tell parallel agents to rerun on a build collision.
- Repeated identical handback messages from agents are duplicates; ignore them.

## Follow-ups

- From #98: the pinned refusal line can cover the swatch just tapped when it sat directly
  under the stage; a refused "My filaments" pick does not reset the detail row (STATUS,
  design studio).
- From #93: one piece print per part at a time; a "×5" piece counts as one piece for the
  share; no e2e for drafts or multi-piece parts on multi-run plates. One test of
  `print-some-pieces-printer.spec.ts` failed twice while two agents ran builds and e2e in
  the same checkout and passed in every clean run and in CI; no cause captured.
- From #92: export of a never-arranged kit-layout build still plans twice (cost only; noted
  on the pull request); the real-kit tests don't run in CI.
- From #90: two prints of one plate at the same time share one card and one log (a
  print-batch id would fix it; the maintainer said no for now). `printers.spec.ts:245` and
  `design-started-shots.spec.ts:70` timed out in runs made while other e2e runs or builds
  were active in the same checkout, and passed in every clean run; no cause found. Keep
  `--trace retain-on-failure` on if either shows up again, and never let two agents run e2e
  or builds in one checkout at once without the lock.
- STATUS open items: BuildHeader missing-weight hint; twin plates file grams; wizard "Skip
  setup" clipped at 390 px; the workspace Stats page loads every build view (cache later);
  a part printing by hand with no arranged plate doesn't block a full design replace.
