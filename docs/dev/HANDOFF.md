# Orchestrator handoff

_Updated 2026-11-23, 17:40 UTC. Rewrite in place; see "Handoff doc" in `CLAUDE.md`. Durable facts go to
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

- **Issue #113 "custom parts": both parts are merged into `edge`** (maintainer,
  2026-11-23: prototype in this edition; merged on green CI while they were away, so they
  have not tried either yet and the issue stays open until they have; the `edge` image
  holds both since the re-run of 8a62302's timed-out e2e job). #114 (fd48d08):
  migration `0005_custom_pieces`, restorable "Not printing" for parts and plates, "Add a
  custom part" from a .3mf on the Files tab. #117 (8a62302): migration
  `0006_custom_library`, "Save for new builds", saved parts added to other builds and to
  new builds, the wizard's Options step, the Saved parts page. Gates: check, lint, 2405
  unit tests, build, empty-database start, 22 e2e specs, CI `test` and `e2e` green; two
  security reviews with no high or medium finding. Decisions, known limits and two
  questions for the maintainer are in STATUS "Waiting on the maintainer". On the test
  copy since r68 (2026-11-23): both migrations were rehearsed on a copy of the real database
  first (all old row counts equal, integrity and foreign keys ok). `docker build` and the real-kit tests did not run in the cloud session (CI's
  `image` job runs on `edge`). Not ported to the hosted edition.
- **0.9.3 released** 2026-11-19: tag `v0.9.3` on `main` a64fa26; `latest`, `0.9.3`, `0.9` and
  `sha-a64fa26` share one digest (checked 2026-11-20). Recorded in STATUS item 0. Contents:
  Spoolman filaments (#71, #77, #81 fixes #79), #74, #76, #80, resource limits (#82, #84).
- **Test copy:** r68 = `edge` 48c1f8f (0.9.4 plus #114, #115, #117 and #119; migrations 0005 and 0006, rehearsed on a copy of the real database) deployed 2026-11-23 (r67 = fbd401d and r66 = 76a65c0 on 2026-11-22; r64 = 7efeb4d with migration 0004, rehearsed on a copy of the real database, 2026-11-20); see
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
  hosted edition's #38). On the test copy since r66. Beyond the hosted
  pull request, to bring back there: the `finally` around the save, clearing the touch flag
  on any key press, and the follow-up commit (refusal line pinned in view on a phone and
  limited to pick errors, detail row back to the saved color, the in-viewport e2e check).
- **Also merged into `edge` 2026-11-22:** #101 "Share a picture of a build's colors"
  (76a65c0; closes #99; browser only, no schema, server or dependency change). The
  maintainer approved the renderings in the session (family card; social square, portrait
  and tall with text sections; default texts say "Toddler Mobility Trainer", not "TMT").
  On the test copy since r66. Unchecked: the system share sheet on a real iPhone and
  Android phone (headless Chromium has no file sharing).
- **Hosted edition port of #101, #102 and #104:** its #41 is merged there (a999ad6,
  2026-11-22, on the maintainer's go-ahead). The button stays in its demo.
- **Follow-up to #101 merged 2026-11-22:** #102 (b21d269): section text keeps typed line
  breaks, "Try again" when drawing fails, "Download started." note. On the test copy since r67.
- **Preview fix merged 2026-11-22:** #104 (fbd401d): the whole picture fits the preview
  (the maintainer saw portrait and tall clipped on an iPhone). Verified in Chromium and by
  an e2e check only; the maintainer checked it on a phone on the `edge` image
  (2026-11-22: "looks great"). Decided: the button stays in the hosted edition's demo.
- **Release 0.9.4: tagged, images NOT published yet.** #109 (ac45695) and the promotion
  #111 are merged (`main` c6350d9); the maintainer created tag `v0.9.4` and the GitHub
  release on 2026-11-23 00:52 UTC. The tag's `docker` run 45091334147 passed `test` and
  `e2e`, but its `image` job has hung in build-push since 01:21 UTC (third time this step
  hangs). Checked 03:30 UTC: `latest` and `0.9` still point at the 0.9.3 digest
  (`sha256:84f708…`), tag `0.9.4` does not exist; `sha-c6350d9` (from the push to `main`)
  is published. **To do first:** cancel that run and use "Re-run failed jobs" (a cloud
  session was not allowed to cancel a run, so this is the maintainer's click or a session on
  the Mac), then check that `latest`, `0.9.4`, `0.9` and `sha-c6350d9` share one digest and
  record the release in STATUS item 0 and here.
- **Also merged into `edge` 2026-11-22:** #100 "Add Space Coast 3D and Dancyn 3D Prints to
  the filament catalog; compact color picker" (5541c2c; no schema change). Both brands are
  official MakeGood suppliers and follow Schoolhouse Spools in the picker. The picker has
  the hosted edition's compact layout in this edition's colors (maintainer's choice after
  comparing screenshots), which also fixes swatches with a note that could not be clicked
  with a mouse; #98's behaviour is kept. On the test copy since r67. The catalog change
  is open in the hosted edition as its #40 (branch `feat/filaments-space-coast-dancyn`,
  CI green); that project's session merges it (merging is deploying). To offer there:
  #98's refused-save handling, which the hosted picker lacks. To regenerate the two
  vendors a cloud environment needs `spacecoast3d.org`, `www.dancyn3dprints.com` and
  `cdn.shopify.com` on its allowed hosts; without them use
  `fetch-vendor-filaments.mjs --from-dir` with saved pages.
- **Merged into `edge` 2026-11-23:** #115 "Print tab: one status badge on single-part
  plates; Print some pieces… in every part menu" (6457a69; no schema change). The
  maintainer approved the screenshots in the session. On the test copy since r68. Not
  ported to the hosted edition, where the maintainer saw the same two badges: offer it to
  that project's session. It changed `PartRow.svelte`, `PlateControl.svelte`, the Print
  page and several e2e specs, so open branches that touch them (#114, another session's
  work: leave it to that session) need `edge` merged in.
- The report behind #95 is explained: the
  logged pieces had been unticked by hand, which the lock now prevents.
- **Hosted edition:** the port of #95 (its #36) is merged there.
- **Next step:** finish the 0.9.4 images (above). The test copy runs `edge` 48c1f8f (r68), so the
  maintainer can try both parts of #113 and #115 there. Still for the
  maintainer on the test copy (r68): swatch taps on an iPhone (the touch change is
  unconfirmed on iOS Safari) and Share a picture's share sheet on iPhone and Android. Then
  pick from the follow-ups below or STATUS "Next steps".
- CI (#119, 48c1f8f, 2026-11-23): the `image` hangs came from the arm64 half running the
  Vite build under QEMU (last output `rendering chunks...` in the arm64 builder stage). The
  Dockerfile now builds the app once on the runner's platform (stage `build`) and installs
  production dependencies per target (stage `deps`). `image` has a 20 minute timeout, `e2e`
  50 (the suite takes 31–35 min; it hit the old 35 minute limit on 8a62302). Pull requests
  that change image inputs run `image-check` (both platforms, no push). First `edge` run
  with it (48c1f8f) passed on the first attempt. If `image` still fails or times out, use
  "Re-run failed jobs". Not checked: an arm64 container on real hardware.
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
  the same checkout and passed in every clean run and in CI; no cause captured. In a cloud
  session container (2026-11-23) "A stopped job that is not logged…" failed every time, on
  `edge` c587129 too, while CI passed it.
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
