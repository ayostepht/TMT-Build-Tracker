# Project status

_Last updated: 2026-11-13 (0.9.1 released, see item 0; `edge` is the default branch; test
copy on r53 = `edge` 296cd50 (0.9.1 + #32, #33, #35), the published image)._

This file holds **current facts only**: what works, what's open, what's next, what's
decided. History goes in `docs/dev/CHANGELOG.md`; how things work goes in
`docs/architecture.md`. Rewrite entries in place rather than appending; delete what is
done. Keep it under ~150 lines.

## Pick up here

0. **0.9.1 released (2026-11-13).** Contents: #18 (plate retry: live printer job keeps the
   plate Printing, printer start time and estimate, `sanePrintSeconds`, `UnloggedNotice`),
   #19 (phone sheet overflow), #21 (minimatch override), #22 (README compose sample, no
   release numbers), #26 (a built-in MakeGood layout counts as the chosen bed: `layoutBed` →
   `view.layoutPrinter`), #27 (version, CHANGELOG, `fixtures/v0.9.1`). First promotion:
   #28 (`promote/d1cff2d` → `main`, merge commit f20a168); `main` no longer holds `CLAUDE.md`,
   `.claude/`, `docs/dev/`, `docs/architecture.md`. The maintainer published release
   `v0.9.1` from the Releases page; the tag points at d1cff2d on `edge` (the form defaulted to
   the default branch), not at f20a168 on `main`: same app code (only excluded paths
   differ), left as is. Image run for the tag: actions run 43363456558 succeeded (test,
   e2e, image); `latest`, `0.9.1`, `0.9` and `sha-d1cff2d` are on ghcr.io with one digest
   (checked anonymously 2026-11-13). The test copy runs it (r53 = `edge` 296cd50, which adds
   #32, #33 and #35 on top of 0.9.1; see `docs/dev/CHANGELOG.md`).
   **Release routine (learned 2026-11-13):** release PR into `edge` (version, CHANGELOG,
   `fixtures/v<next>/`) → Actions "Promote edge to main" from `edge` → it pushes
   `promote/<sha>` but cannot open the PR while "Allow GitHub Actions to create and approve
   pull requests" is off (kept off on purpose): open the PR into `main` by hand, CI runs on
   it normally → the maintainer merges with a merge commit → tag `vX.Y.Z` on `main` (release
   form: set Target to `main`), then the release notes = the CHANGELOG section. Cloud
   sessions could not push tags until the maintainer fixed GitHub access on 2026-11-13.
   **Branch model (maintainer, 2026-11-13):** `edge` is the default branch and is protected;
   pull requests (Dependabot too) target `edge`, which publishes the `edge` image; `main` is
   updated only by the promote workflow and stays clean (`.github/main-exclude.txt`).
   Decided: Success on a live plate still prints the parts; keep-Printing needs a live
   printer job; the X1 / P1 / A1 implied bed uses the X1 keep-out and 4 AMS slots (revisit if
   A1 owners report problems; the maintainer has no X1). Open: the unlogged notice also shows
   for auto-linked jobs (unanswered); two linked jobs on one plate can show it twice
   [printers]; possible SSE gap after API edits (seen in log-plate, unconfirmed)
   [build-state]; vite's optional esbuild peer is invalid in `npm ls` (cosmetic); optional
   hardening: a protected `promote` Environment limited to `edge` (then add `environment:` to
   promote.yml). Maintainer: dismiss the esbuild (drizzle-kit) and deepmerge Dependabot alerts.
   Cloud sessions: use the "TMT-Build-Tracker" environment (setup script installs deps and the
   Playwright browser; Docker checks per dev-environments).
1. **Public since 2026-11-12: 0.9.0.** The maintainer made the repository public; `go-public`
   was merged, `v0.9.0` tagged, CI in full mode (`CI_FULL=true`). `main` is protected and
   work lands through pull requests (see CLAUDE.md "The repository is public"). Image
   channels: `latest`/`0.9.0`/`0.9` from the tag, `edge` from the `edge` branch (was `main` until 2026-11-13). Done since the flip:
   the `ghcr.io` package is public and pulls anonymously (amd64 + arm64); Unraid ran a cold
   start of the published image against an empty data directory three times, all clean;
   release `v0.9.0` is published and marked Latest (kit pack 1.0.1 release kept, 1.0.0
   release and tag deleted); secret scanning 0 alerts, private vulnerability reporting on,
   fork pull requests need approval, workflow token read-only; pull requests #15
   (pull request template, code of conduct) and #17 (README quick start matches the app)
   merged; issue #16 "Beta testers: start here" is pinned; four issue forms (bug, feature
   request, install feedback, printer report). No open pull requests. The maintainer is
   finalising the MakeGood TMT forum post (their own wording, discloses that Claude was
   used) and will post it themselves. Still theirs: upload the social preview image
   (repository settings), glance at the "New issue" page, paste the Unraid cleanup prompt
   (`data/r50-check/`, `/workspace/tmt-coldstart`). Expect first outside issues and
   Dependabot pull requests: triage and review freely, merge others' only on the
   maintainer's go-ahead. Watch: on r50 the live link status was at most 12 s old in samples (5 s on r49), steady but
   unexplained [printers]; the live camera on r50 was not checked by Unraid (maintainer to
   look). Next deploys of the test copy use published images (`sha-<short>` / `edge`), see
   dev-environments. Worktrees for parallel agents: trial on the next multi-agent task.

2. **r50** (superseded by r51/r52; e4584d5, 2026-11-12, main 9ed6906; rollback: tag `r49` as `test`, no restore; rehearsal clean, all 5 checks passed, live link connected in 3 s, 0 reconnects in 20 min) (no migration; adds the runtime dependency `ws`, so
   the image build must run `npm ci` cleanly). Contents: every printer WebSocket goes
   through `ws-client.ts` (1 MiB `maxPayload`, no compression, no redirects, handshake
   timeout); OctoEverywhere link sockets are pinned to the validated address. This closes
   the hosted-mode memory finding and the "not pinned" caveat (security-reviewer,
   2026-11-12: nothing in the code blocks a hosted launch; hosted paths are still unproven
   on real hardware). Also: taking the next run of a multi-run part off the printer keeps
   the plate at Partly printed; grams fields reject non-numeric text and accept a decimal
   comma; GitHub issue forms and a README "Feedback and beta testing" section; README
   screenshots retaken from the preview (`scripts/preview/readme-shots.mjs`); the in-app
   Experimental note opens the printer report form. Gate: check, lint, 1557 unit tests,
   build and production start, full e2e (207 passed, 3 spec-only failures fixed and
   re-run). Docker build is left for Unraid. The maintainer skipped a preview review for
   r50 (changes are under the hood).
   **Then going public (0.9 pre-release).** History decision (maintainer, 2026-11-12):
   publish the history as is. The maintainer's two LAN addresses appear in old commits
   (removed from the tree since) and the build name "Columbus #4691" is in seeds and tests;
   both accepted as public, no rewrite. On the day: the maintainer makes the repo and the
   `ghcr.io` package public; then set `CI_FULL=true`, run the workflow so the image is
   published, branch protection (`test` + `e2e`), approval for outside collaborators'
   workflow runs, private vulnerability reporting, create the `printer-report` and
   `documentation` labels, update the README "Image access" and "While the repository is
   private" sentences, link the changelog from `/about`, check the issue forms render and
   the guide anchors resolve on GitHub. The maintainer will then invite beta testers on the
   MakeGood TMT forum (Docker/self-hosting, ideally Klipper, OctoPrint or Bambu).
3. **r49 is live** (ca4d9c1, 2026-11-12, main bec473e; no migration; rollback: tag `r48` as `test`, no restore; rehearsal clean, all 10 checks passed, live link 0 reconnects in 15 min). The maintainer reviewed it in the local
   preview on 2026-11-12 ("everything else looks good!"); the chooser was then compacted to
   single rows with one Experimental note, as they asked, and re-gated. Decision
   (maintainer): their own printer goes on a hosted instance through its OctoEverywhere
   link; no admin exception for local addresses in public mode.
   Contents: Integrations page as the one place to add, edit and remove printers (grouped
   chooser, setup steps per option from `setup-steps.ts`, auto-log, Spoolman card); Printers
   tab is status only; OctoEverywhere links for Klipper and OctoPrint as well as Elegoo
   (Bambu LAN cannot); printer kind `manual` (not connected) usable in "Where is it
   printing?" and on the log sheet, printer name stored on runs and in the start activity;
   hosted mode admits link and manual printers only (caps `QUOTA_LINK_PRINTERS_PER_WORKSPACE`
   3, `QUOTA_LINK_PRINTERS_TOTAL` 200, `QUOTA_MANUAL_PRINTERS_PER_WORKSPACE` 10; handshake,
   silence and receive limits on sockets; rate-limited test routes); one-step link when the
   chosen printer is already printing; log sheet takes decimal grams and shows refusals
   (fixes the r48 check failure); between-runs parts no longer show the plate as Printing;
   container-query top bar; Help "Connect a printer"; guides updated. Gate: check, lint,
   1536 unit tests, build, full e2e 208 passed; two security reviews, no high findings.
   Other open items from r49: duplicate-link check needs a `link_hash` column (schema
   change, ask the maintainer); Klipper and
   OctoPrint through a link, and every hosted-mode path, are unproven on real hardware; on
   deploy, watch the maintainer's live Elegoo link for reconnect flapping (link sockets now
   close after 120 s of silence); retake the README screenshots that show the old Finish
   and log button and printers page (use `npm run preview:demo`); the incident on
   2026-11-12 where a new unit test sent one SDCP discovery broadcast on the Mac's LAN is
   fixed (test sets public mode first) and no other printers unit test can reach the
   network (security-reviewer, sampled).
4. **r48 is live** (c64d852, deployed 2026-11-12 from main 1e18c6c; UI and two small server
   changes, no migration; rollback: tag `r47` as `test`, no restore needed). Rehearsal clean;
   checks on a copy of the live data: 8 of 10 pass, 1 failed, 1 open question (see "r48
   checks" under open items). The
   maintainer reviewed it in the local preview on 2026-11-12 ("Demo looks great!").
   Contents: one
   actionable status badge for plates and parts (`StatusBadge`, `WherePrinting`; choosing
   Printing with a connected printer asks where; Printed opens the log sheet; finishing is
   now 3 taps); phone color picker (one filter row with a Brand select, card grows with
   content, shorter pinned viewer while picking; single brand on the phone); Help is a
   top-level nav item, top bar fits at 761-1100 px; Printers page shows linked and running
   prints, other unlinked ones behind a closed disclosure; build-details save records only
   changed fields (`Outcome.skip`); landing spacing; public docs wording pass. Gate: check,
   lint, 1468 unit tests, build, full e2e 195 passed; security review clean. Open
   question for the maintainer: single-part plates show the status on plate and part.
   Workflow from now on (maintainer, 2026-11-12): before every Unraid deploy, start the
   local preview and let the maintainer review there first.
   Later ideas, not started: OctoEverywhere for more printer types as they prove out,
   PrusaLink / Prusa Connect, finish notifications (ntfy, Discord, Home Assistant); avoid
   Bambu cloud.
5. **r47 is live** (0245ca8, deployed 2026-11-12 from main c47ecca; rollback: tag `r46` as
   `test`, no restore needed). Rehearsal clean (no upgrade line, journal still the
   baseline row, row counts equal). All 8 r47 checks passed on a copy of the live data with
   the simulated printer (shots in `data/r47-check/shots/` on Unraid). Seen during the
   checks, not fixed: saving Settings → Build details logs "cleared the recipient, cleared
   the hospital and cleared the delivery date" when those fields were already empty
   [build-state]; the landing's "Want to build with others?" card has no gap under Next up
   [app-shell]; desktop Overview spools values look faint grey [app-shell]. What r47 is,
   from the maintainer's r45 phone review:
   landing lists Builds first as compact rows (pill row removed; build name in the Now
   printing / Next up cards is a small link); with a printer connected the main start is
   "Printing on <printer>" with a helper line and the plain start reads "Not on a
   connected printer"; Options is the designer's first tab (opens first on a fresh build;
   not shown in the setup wizard); picker filters wrap on the phone and clear the pinned
   viewer; Overview filaments are compact rows in one card (`FilamentTiles.svelte`: spools
   field behind the row on the phone, inline from 900 px); About in the account menu and a
   footer (Help, About, Privacy, Terms); Print tab buttons 44 px on touch; Help text and
   README captions updated. Gated on the Mac: check, lint, 1463 unit tests, build, full
   e2e once (2 failures, both fixed) and the affected specs again (56 passed). Docker
   build is left for Unraid. The maintainer has not seen it yet: wait for their review.
6. **r46 is live** (cfe1c61, 2026-11-12): the migration squash; the test copy was upgraded
   to the single baseline with every check clean (see CHANGELOG). The maintainer checked
   their build afterwards. Rollback: `tmt-build-tracker:r45` + `tmt-backup-pre-r46.db`.
   A real OIDC (Authentik) sign-in is a 1.0 checklist item: the r45 token handling is only
   unit-tested and the maintainer will test it before `v1.0.0`.
7. **Towards 1.0**: Unraid Community Apps template, `v1.0.0`, a real Authentik sign-in
   (maintainer), Klipper / OctoPrint / Bambu on real hardware through beta testers, the
   hosted (`TMT_MODE=public`) paths on a real deploy, a duplicate-link check (needs a
   `link_hash` column: schema change, ask first). README screenshots (`docs/images/`, five)
   come from `scripts/preview/readme-shots.mjs` against the local preview.
8. Wait for (or ask about) the maintainer's phone checks below, then act on them.

## Where we are

Milestones 1–7 are built and running on the maintainer's test copy. Milestone 8 (release)
has not started.

| Area                                                                           | State                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Builds, chapters, roles, live updates, activity                                | Done                                                                           |
| Print logs (log sheet, edit, delete, undo)                                     | Done                                                                           |
| Variants (seat, rear caster, footrest, rim), accessories                       | Done                                                                           |
| 3D designer, palettes, swatch picker, shareable designs                        | Done (redesigned r31-r37)                                                      |
| Setup wizard; build tabs Overview · Design · Print · Files · Finish · Settings | Done                                                                           |
| Studio drafts                                                                  | Done                                                                           |
| Printer catalog (70), bed presets, team printers, keep-out zones               | Done                                                                           |
| Plate arranging (flat rotations only)                                          | Done                                                                           |
| 3MF export (Orca/Elegoo, Bambu, plain)                                         | Done; opened in Elegoo Slicer once, needs a re-test                            |
| Sliced 3MF upload, print template, manual plate times, pace                    | Done                                                                           |
| Bundled MakeGood kit pack 1.0.1                                                | Done                                                                           |
| Assembly checklist, photos, handoff, printable summary                         | Done                                                                           |
| Read-only printer status + camera, job → plate linking                         | Done; SDCP and camera verified live, supervisor not tested during a full print |
| Elegoo via OctoEverywhere shared link                                          | Done; status + camera confirmed live through the link (r44)                    |
| Spoolman (optional)                                                            | Done, mock-tested only                                                         |
| Filament catalog + vendor supplement                                           | Done                                                                           |
| Release (Unraid template, domain, public repo)                                 | Public repo and 0.9.0 image done; Unraid template and domain not started       |
| PWA (manifest, icons, service worker, offline page, update prompt)             | Done; real-phone checks pending                                                |

Reference result: Elegoo Centauri Carbon (256 × 256, cutter keep-out, pack 1.0.1) → 21
plates, no warnings, export guard clean; 457.5 h from the maintainer's sliced file.

## Waiting on the maintainer

- (2026-11-13) **r53 phone review** of #32 / #33 / #35 on the test copy. Checks on a copy of the
  live data (2026-11-13, 390 + 1440): Type select reads "95A" by default, 98A lists only 98A,
  All types lists everything (108 TPU swatches), a hovered selected brand chip stays
  readable; one-piece handle option, H2D / H2S layout with plate 22 and the grip on its own
  TPU plate 18; "Replace plates?" appeared 3 of 3 times when a MakeGood layout was picked
  right after arranging; jeepxj credit on About, Help (FAQ) and the 3D stage. Not checkable:
  **no "Foaming" type**, because the catalog has no foaming TPU (the only `/foam/i` matches
  are PLA "Seafoam" colors) [filaments-catalog]. Seen, open: the type counts differ from the
  swatches listed (98A (8) lists 13, 90A (19) lists 14) [design-studio-ui]; at 390 the
  3D model covers part of the stage credit line [design-studio-ui]. The kit pack upgraded the
  test copy's 1.0.1 model to 1.0.2 (it was not admin-imported); kit-status lists nothing
  missing.
- (2026-11-13, issues #29 / #30) **Review PR #32** (#30 picker Type filter: default reads
  "95A" / "PETG", subtypes with counts; plus hovered selected badges stay readable) on the
  `edge` image after merge. **#29 one-piece push handle** (branch
  `feat/one-piece-push-handle`): publish release `kitpack-makegood-tmt-revb-1.0.2` with
  `makegood-tmt-revb-1.0.2.kitpack` (sha256 3aaa44d6…10b1, 32,070,463 B; the file was sent
  to the maintainer from the cloud session; rebuilding changes the sha256) before merging,
  the index already points at it. Decided (maintainer, 2026-11-13): the grip stays in the
  one-piece option on its own TPU plate (different material); keep the extra H2D plate 22.
  Cosmetic, open: the 3D view shows the grip at its multi-part position, above the shorter
  handle. Confirm the THIRD_PARTY wording of the NonCommercial term. Image check done in the cloud session (2026-11-13): the image builds, an empty data dir
  installs 1.0.2 (41 geometry rows), a restart is a no-op, and a 1.0.1 install upgrades to
  1.0.2. The release asset `kitpack-makegood-tmt-revb-1.0.2` is published and its download
  matches the index. An orphaned agent preview server may still listen on port
  4291 in that cloud container (its kill was refused; gone when the container is reclaimed).
- (2026-11-12) Look at the camera tile on the live build (not checked on r50).
- Unraid scratch: the maintainer approved deleting the r45 to r50 check folders as they
  came up; the last prompt (`data/r50-check/`, `/workspace/tmt-coldstart`) may not have
  been pasted yet. Older leftovers and old `tmt-backup-pre-r*.db` backups: have Unraid
  list what is still there before asking again. Stale remote branches (`ci/*`, `feat/*`,
  `fix/*`, `hotfix/*`): list with `git branch -r` and ask before deleting.

- (2026-11-11) After the next deploy behind https, on a real iPhone and Android phone:
  install from the browser, icon and name ("TMT Builds"), splash, status bar and safe areas
  in light and dark, resume after backgrounding shows fresh data, offline page and Retry,
  "A new version is available" after a later deploy; favicon in a dark-mode desktop
  browser; MakeGood credit vs "Reset view" on the 3D stage at 360 px.

- (asked 2026-11-10) On a real iPhone: does focusing the picker search still zoom or pan
  sideways; do orbit and tap-to-select feel right; after backgrounding the home-screen app,
  does the 3D view come back lit (or offer "Reload 3D view") and do colors load (or offer
  "Try again")?
- Re-test the latest 3MF export in Elegoo Slicer (plates fit, wings, painted supports,
  cutter zone).
- Schoolhouse Spools hexes are estimated from photos: maintainer flags wrong ones.
- SpoolmanDB upstream PR: parked by the maintainer (needs measured 95A spool weights).

## Open items by area

Route each to the agent named in brackets.

- **Design studio** [design-studio-ui]: a11y pass done (44 px on coarse pointers, `--field-line` 3:1 field
  borders, `design-announce` live region, swatch focus ring, picker fields styled); left
  over: class-only field styles in components were not audited for `--line` borders;
  adjacent `.pill-link` hit bands can overlap on touch; "MakeGood · CC0" credit wraps over the chair at 360 px;
  `share/ApplyDesign` uses raw fetch (add `listDesigns` to `client/api.ts`);
  `editableTargets` lacks `kind` (can't tell builds from drafts); no "start a draft from
  this design"; draft cards have no 3D snapshot. Not yet raised with the maintainer: a
  selected part's chip covers the lower third of the phone stage; phone toasts cover the
  stage top for ~8 s. Dialog focus return is fixed everywhere (shared
  `rememberOpener` in `client/focus.ts`; `Dialog.svelte`, `BedPicker` and `PlatesPanel`
  still carry inline copies: unify later). Three converting asks ("Switch layout and
  convert", "Convert print logs", "Re-arrange and convert") and "Replace colors" are not
  flagged `danger`: flag them if the maintainer wants Cancel-first there too.
- **Leftovers**: SDCP `PrintInfo.Status` 20 mid-print is unlabelled, needs the real
  printer [printers]; a one-off `ECONNRESET` on a PATCH in `printers.spec.ts` (suspected
  keep-alive reuse; retry in the spec if it recurs) [e2e-playwright]; the update prompt's
  worker hand-over is unit-tested only [release-pwa]; each landing build polls its view
  every 20 s and its printer jobs every 30 s (a shared chapter-level jobs fetch would cut
  the bursts) [printers, app-shell]; `KitFilesImport` and `GuideMapper` were restyled
  without screenshots (need installed kit files) [app-shell]; the New-printer dialog has
  no title bar or close button of its own (the form's heading is its header) [plates-3mf];
  `PartRow` could carry a `data-testid` on its status group (`viewer.spec.ts` selects it
  by role) [build-state]; a local `npm run dev`/built server without release credentials
  logs a 404 fetching kit pack 1.0.1 (expected while the repo is private) [kit-and-startup].
- **Drafts** [app-shell]: printer/layout pickers only in Files, not in draft Settings.
- **Files tab** [plates-3mf]: on r45 at 390 the layout select showed "Loading…" while the
  heading already named the layout. Probably the race fixed on 2026-11-13 (the picker's
  preload effect re-ran on every view refresh; layout answers were not latest-wins). r53
  checks: "Replace plates?" appeared every time; "Loading…" not seen at 1440 or 390. That race also made `print-template.spec.ts:66` time out on CI.
- **CI** [release-pwa]: the e2e job's limit is 35 min (was 20; the suite takes ~20 min with 1
  worker and a timeout cancelled the `edge` run of #33, skipping its image). As the suite
  grows, shard it (`--shard=1/2` over two jobs, each with its own server and DB) rather than
  add workers: specs share one DB and server.
- **r48 checks** (2026-11-12, copy of live data, simulated printer; shots in
  `data/r48-check/shots/` on Unraid). Failed [build-state]: Printed → the log sheet
  prefills "Filament used (g)" with the slicer's fractional grams (e.g. 162.52) but the
  input has `step="1"` (`LogRunSheet.svelte`), so the browser blocks Save ("nearest valid
  values are 162 and 163") until the grams are retyped; predates r48 (file unchanged since
  r45) but is now on the main Printed path. Question for the maintainer: Printing → "Where
  is it printing?" → the printer, while the printer already runs an unlinked job, sets the
  plate Printing but links the job only after the second "Confirm Plate N is printing on
  <printer>?" (the r38 rule, `StartOnPrinter`/`ExpectedConfirm`); keep the two steps or
  link on the first? Seen: after one logged run of a 2-run plate the plate stays Printing
  with nothing on the printer.
- **r45 live checks** (2026-11-12, copy of live data; shots in `data/r45-check/shots/` on
  Unraid): privacy/terms/login/signup, landing quick row, Next up build button, whole-card
  links, long names, About 0.9.0, guide link, Cancel-first dialog with focus return,
  picker styling and Options placement all pass. Open: on the phone Print tab some
  controls are under 44 px: part-name buttons `button.pbtn` 22 px, the status buttons
  (To print / Printing / Printed / Reprint) 40 px, `button.more` "+" 40 px, `.bh-more`
  40 px [plates-3mf, design-studio-ui]; desktop landing Next up "Start on <printer>" is 29
  px beside 38 px buttons [app-shell]; the picker's "All colors" select looks clipped at
  the right edge at 390 dark (not measured) [design-studio-ui]. Unchecked: Now printing
  card button (nothing printing) and remove-member dialog (no chapter with other members).
- **r44 live checks, small things**: the plate view toggle and the "rotated N°" badge only
  render with an arranged layout (`/arrangement` returns no plates for an uploaded 3MF), so
  they are still unseen live (see Pick up here 4); the tracking card text actions are
  aligned on `main` (component-level; moving the rule to `.btn.ghost` in `app.css` is an
  optional follow-up [design-studio-ui]); nothing shows a toast without changing data, so toast-over-dialog was checked with a
  synthetic toast (fine on phone and desktop).
- **Printers** [printers]: OctoEverywhere shared link for Elegoo works live (status, camera,
  with the reconnect backoff fix; re-checked on r44: 6 fresh loads, first `camera/snapshot`
  200 every time, so the r43 502s were not reproduced). `share-link.ts` `HOST_RE` only accepts
  `shared-[a-z0-9]{8,64}`; revisit if a real link is rejected. Small follow-ups:
  the Address box stretches tall next to the link field's helper text (desktop);
  `printers.spec.ts:244` (plate layout picker) timed out once under host load, passed
  alone (possible flake); open question whether a linked printer should keep a direct
  LAN fallback (orchestrator suggests no). CC firmware reports `PrintInfo.Status` 20
  mid-print: consider a proper label instead of treating it as a prep state.
  Live supervisor test with the Centauri Carbon during a real
  print (auto-link needs plate numbers in file names; Elegoo Slicer's names lack them);
  OctoEverywhere notification webhooks (needs a public URL, shared-secret check);
  `BuildPrinter` has no `teamPrinterId` link back to the team printer.
- **Plates** [plates-3mf]: print-template "printer" and "manual" profile sources not
  wired; 3D chair from 3MF only (no STEP) for user-uploaded templates. Upload still
  stores raw slot → role grams (`builds/plates.ts`, `part-profile.ts` learning): check
  whether learned part profiles inherit stray slots (accounting filters them since
  fix/filament-role-mismatch).
- **Kit** [kit-and-startup]: template copies: switching back to the built-in kit leaves
  the unused copy; designs from the base kit don't apply to a copy. One-piece push handle
  (#29): `bomGrams` is null (unsliced source); a build already on the H2D or X/P/A layout
  that switches to one-piece shows the part under "Other" until the layout is re-applied
  or plates are arranged; `KitCredit` shows the jeepxj line everywhere (no build context;
  could be limited to one-piece builds via a prop) [app-shell].
- **E2E** [plates-3mf, e2e-playwright]: `printer-arrange.spec.ts:7` once counted 23
  plate diagrams for 24 plate cards in a full local run under load (2026-11-13); passed
  alone and on CI. Watch for a recurrence.
- **Security** (Stage 1 done; `docs/dev/audit-2026-11.md` has the findings and their status).
  Open Lows, none blocking: storage totals are re-measured from disk on every upload
  (`quota.ts` `workspaceUploadBytes`; a cache needs an invalidation call from photo, plate
  and kit writes); the converted GLB after a STEP conversion is only counted at the next
  upload; `templates.owner_org_id` has its ON DELETE CASCADE since r46, so the
  `deleteOwnedTemplates` workaround in `account.ts` can be simplified [app-shell]; chapter delete runs our cleanup just before Better Auth's own delete,
  not in one transaction; activity is pruned to the newest 5000 rows per build; write-rate and slot state is per process (single process
  only).
  Accepted on self-hosted installs: unverified emails, so an `ADMIN_EMAILS` address is
  admin for whoever registers it first.
- **Screenshots never taken**: multi-run log-plate flow; palette locks
  (`data/shots-palette-locks/` spec, on the cloud machine).

## Decisions (do not revisit without the maintainer)

- **Never re-orient parts in 3D.** Flat rotations about Z only; show "rotated N°" on the
  part, never as a warning.
- Arranger: max edge/keep-out clearance; 1 mm default edge margin; 8 mm between parts;
  rigid source layouts only when per-piece packing would split a part.
- MakeGood files are CC0: kit pack (release asset + Docker image), never in git, always
  credited; the maker guide is linked, not bundled. Exception (2026-11-13): the one-piece
  push handle by jeepxj (CC BY-NC, MakerWorld 3409242, shared in MakeGood's official
  files) is bundled from pack 1.0.2 with credit (`kitpacks/licenses.json`, pack
  `CREDITS.md`, README, THIRD_PARTY, About/Help/Terms, `KitCredit`). The one-piece option
  keeps the TPU grip for now; `include` (multi-part) stays the default.
- One place per task: kit files live in the wizard's template step and Files → print
  settings; the hardware model is not user-uploadable.
- Chapters are optional (personal "My builds" workspace); printers work in personal
  workspaces.
- Palettes/generator exclude matte, silk, transparent, glow, marble, wood, glitter, rock,
  multi-color, CF/GF and non-95A TPU. Manual picks are unrestricted. No ready-made palette
  has near-black tires. The picker's Type select defaults to that set, labelled "95A" (TPU)
  / "PETG", and filters to one subtype on request (2026-11-13, #30).
- Spoolman stays optional.
- Design tab: Colors | Palettes | Parts. Slots always show the role ("Primary PETG", …)
  with the filament as subtitle; picker title is the role. "Save as design" is for sharing
  (edits autosave); undo stays palette-only; the generator is collapsed by default.
- Existing builds keep their own role names (no migration for the TPU rename).
- Filament catalog: PETG/PCTG/TPU only from vendor supplements, no PLA. Schoolhouse Spools
  stays (approx. hexes, marked "Approx. color") and is a popular brand.
- Action links are buttons or clickable badges; plain text links only inside sentences.
- Printers are read-only. Sole exception: Elegoo SDCP Cmd 386 `{"Enable":1}` to turn the
  camera on when someone views it. Never move, heat, pause, stop or start a print.
- "Ready to print" section and bulk logging stay removed (too much space).
- The maintainer installs on Unraid themselves. **README is Docker-first** (intro,
  screenshots, 5-minute quick start) with Unraid, reverse proxies (NPM, Caddy, Traefik),
  SSO, backups and printers as separate guides (2026-11-10; replaces "README must be a
  complete Unraid + NPM + Authentik guide"). Domain details stay with the maintainer.
  MakerWorld page for credit:
  https://makerworld.com/en/models/2066081-3d-toddler-mobility-trainer
- **Two modes**, `TMT_MODE=selfhost|public` (default `selfhost`). The public instance runs
  with no auth layer in front and is **SSO-only with Google and GitHub** (no passwords).
  Self-hosted offers SSO (OIDC) **or** email/password, plus a sign-up switch
  (`SIGNUP=open|invite|closed`). **No email verification and no SMTP anywhere**
  (2026-11-10). Consequence accepted for self-hosted: emails are unverified, so there
  invitations and `ADMIN_EMAILS` trust whoever registers that address; the sign-up switch
  is the control.
- **Printers on the public instance: off for now, bridge later** (a companion container
  makers run at home that pushes read-only status). Self-hosted installs keep server-side
  connections, limited to private address ranges (2026-11-10).
- The prototype import and the 3D re-orientation code are **removed** (decided 2026-11-10,
  done 2026-11-11). The activity sentence for old import rows is kept on purpose.
- Don't re-run the full ~6 min e2e suite before every deploy when agents ran their specs.
- **Site admins** (2026-11-11): `ADMIN_EMAILS` (authoritative), plus admins granted in the
  app (`site_admin` table), plus on self-hosted installs the first account while neither
  exists. The last site admin cannot delete their account or be revoked; they hand over
  first on `/account`. The only account on a server cannot be deleted.
- **Public-instance limits** (2026-11-11): defaults in `config.ts` `quotas()` (README env
  table); self-hosted installs are unlimited unless set. Print-geometry import is
  site-admin only on a public instance. `MAX_3MF_MB` defaults to 256 there.
- Account deletion removes the personal workspace and the user's drafts in chapters;
  chapter builds they created pass to another owner (2026-11-11).
- **Shared styles** (2026-11-11): one segmented control (`ds-seg`), badge (`ds-badge`),
  modal/sheet (`ds-modal`, always a native `<dialog>` opened with `showModal()`) and card
  (`.card` = `ds-card`) for the whole app. The maintainer approved the wave 3 look
  (`ds-seg` accent underline, one accent colour for the selected status/Result option,
  small camera dialog title). While a dialog is open a toast shows above it but
  cannot be clicked (Undo waits until the dialog closes): accepted as is.
- **Docs layout** (2026-11-11, maintainer left the call to the orchestrator): process notes
  live in `docs/dev/` (STATUS, CHANGELOG = deploy history, dev-environments, the audit,
  archive); `docs/architecture.md` and `docs/guides/` are the public contributor and
  operator docs; `CLAUDE.md` and `.claude/agents/` stay where Claude Code reads them.
- Public addresses confirmed (2026-11-11): `github.com/ayostepht/TMT-Build-Tracker` and the
  `ghcr.io/ayostepht/...` image. `SECURITY.md` read and acknowledged by the maintainer.
- **Dialogs** (2026-11-11): a destructive confirmation opens with focus on Cancel
  (`ask(msg, { danger: true })`, or `danger` plus `data-cancel` on `Dialog`); new ones must
  be flagged. Root `CHANGELOG.md` is the public release log: a user-visible change adds a
  line under Unreleased; `docs/dev/CHANGELOG.md` stays the internal deploy history.
- `--field-line` is the border token for form fields (3:1); `--line` is for cards and
  dividers only (2026-11-11).
- **Auth data** (2026-11-11): provider access and refresh tokens are not stored (account
  hooks null them; generic OIDC keeps its ID token for sign-out at the provider); sessions
  store no IP address (`disableIpTracking` is not used: it would switch off the rate
  limiter). `/privacy` states both: any change to what is stored must update it.
- Decided 2026-11-11: no theme toggle (device setting); TypeScript 7 deferred until after
  1.0 (Dependabot ignores the major); a printer on an OctoEverywhere link keeps no LAN
  fallback; the four converting/replacing confirmations stay confirm-first; kit pack 1.0.0
  asset stays until 1.0 is tagged; the maintainer's real build is not re-arranged for a
  visual check; buttons are 44 px on every touch device; field borders use `--field-line`
  app-wide.
- Git history is kept as is when the repo goes public (private-range LAN addresses in old
  commits are accepted; no rewrite). Branch protection (no force push, no deletion,
  required `test` + `e2e`) is set the moment the repo is public: GitHub refuses it on a
  free private repo (2026-11-11).

## Next steps (in order)

Stages from `docs/dev/audit-2026-11.md` Part 2 (items, owners and exit checks are there).
Stage 0 and **Stage 1 (safe to expose) are done**: modes, SSO-only public sign-in, sign-up
switch, outbound guard, trusted-proxy rate limits, boot validation, security headers and
CSP, body caps, quotas and write limits, streaming-only uploads with zip caps, account
deletion/export, site admin hand-over, CLI password reset (`docs/password-reset.md`).
**Stage 3 (PWA) is done** apart from real-phone checks (see Waiting on the maintainer).
**Stage 2 (daily loop and phone shell) is done**, exit checks measured: start a plate in
1 tap and finish-and-log in 2 from landing; 93% of a 390 × 844 Print screen is content.
Mac: keep Node 22 first on PATH (Homebrew's Node 25 breaks
the build), call `/opt/homebrew/bin/flock` by absolute path, give each parallel e2e run
its own `E2E_PORT`; the local `docker build` needs kit-pack download credentials. CI's e2e
job failed twice on 2026-11-11 installing the browser (runner could not reach Ubuntu's
package server): re-run before reading it as a code failure.

**Stage 4 (cleanup and design system) is done** and deployed (r44): removals, every screen
on `ds-seg`/`ds-badge`/`ds-modal`/`ds-card` with native dialogs, the old globals deleted,
`three`/`pdfjs-dist` as devDependencies (image 531 → 408 MB). Kept on purpose: the two
`slugify` copies (`teams.ts`: 40 chars, fallback `chapter`; `templates/fork.ts`: 30, `kit`).
Waiting on the maintainer: squash migrations (needs a journal reset on the test copy; would
also fix `templates.owner_org_id` lacking ON DELETE CASCADE); theme toggle; TypeScript 7
(Dependabot PR #11 fails check: a deliberate upgrade).

1. **Stage 5, docs and 1.0** (started). Done: Docker-first README (95 lines) with ten
   guides in `docs/guides/`, `CONTRIBUTING.md`, `SECURITY.md`, `.nvmrc`; in-app `/help` and
   `/about` (version from `package.json`, Help link in the account menu), fact-checked
   against the tracking code; `/privacy` and `/terms` (signed-out pages, text follows the
   mode, each privacy statement checked against the code; a change to what the app stores
   or sends must be mirrored there); the build guide link (`MAKEGOOD_GUIDE_URL`, MakeGood's
   PDF on Google Drive; `MAKEGOOD_MODEL_URL` is the MakerWorld page); process docs moved to
   `docs/dev/`; landing navigation (quick row, build buttons on board cards, whole-card
   Builds list). Specs: `help-about`, `legal`, `landing`. Not verified: the Caddy and
   Traefik sections against real proxies; the quick start run by a stranger (the image is
   still private); arm64. Package is `tmt-build-tracker` 0.9.0 with
   `engines` (Node >=22.12; 22 is the tested version, 25 fails the build); `src/lib/version.ts` feeds About and `/api/health`
   (`{ ok, version }`); the 1.0.0 bump comes with the tag. Left: README screenshots (phone
   Now card, plate arranger, 3D designer, printer card), `v1.0.0` (rename `[Unreleased]` in the root `CHANGELOG.md` to
   `[1.0.0] - date`, drop its pre-release wording, check it matches `package.json`), e2e gating the image, an e2e run with a
   kit pack installed, Unraid template (+ Community Apps), repo public.
2. **Stage 6, printer breadth**: https/wss for Moonraker and OctoPrint, hardware checks,
   plate numbers in export names, the bridge, inbound webhooks (incl. OctoEverywhere),
   Prusa Link and Duet adapters; printer supervisor live test.
3. **Stage 7, public launch**: `TMT_MODE=public`, backups of database and uploads, uptime
   check, soft launch.
