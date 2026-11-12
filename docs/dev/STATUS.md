# Project status

_Last updated: 2026-11-12 (test copy on r45 = b9ea636, deployed from main 7fba2db. Next:
the migration squash as r46. Stage 5 in progress)._

This file holds **current facts only**: what works, what's open, what's next, what's
decided. History goes in `docs/dev/CHANGELOG.md`; how things work goes in
`docs/architecture.md`. Rewrite entries in place rather than appending; delete what is
done. Keep it under ~150 lines.

## Pick up here

1. **r46 ready to deploy: cfe1c61** (migration squash; maintainer approved 2026-11-11; must
   land before anyone else installs the app). Replaces the 14 migrations with one baseline;
   a database at the full old chain is upgraded at startup in one transaction, anything
   else refuses to start and leaves the file untouched. Also adds the missing ON DELETE
   CASCADE on `templates.owner_org_id`. Gated on the Mac (check, lint, 1463 unit tests,
   build, full e2e 177 passed, independent old-chain upgrade and partial-chain refusal);
   Docker build and the rehearsal on a copy of the real database are left for Unraid.
   Rehearsal checks: journal 14 → 1 (hash `66213dfa…8350`, `created_at` 1794448473022),
   one upgrade log line naming 7 rebuilt tables, whitespace-normalized `sqlite_master`
   equal to an empty-data install, row counts unchanged, `foreign_key_check` empty,
   `integrity_check` ok, no upgrade line on restart [kit-and-startup].
2. **r45 is live** (b9ea636): password sign-in confirmed by the maintainer (2026-11-11).
   They don't use Authentik yet: a real OIDC sign-in is a 1.0 checklist item (the r45
   token handling is only unit-tested; maintainer will test before `v1.0.0`).
   **r47 (UI, in progress on the Mac)** from the maintainer's r45 review: landing with the
   Builds list first and no pill row; one clear start button when a printer is connected;
   Options as the designer's first tab; picker filters wrap on the phone; About in the
   menu plus a footer (Help, About, Privacy, Terms); README screenshot captions; compact
   spool rows on the phone Overview; Print tab buttons 44 px on touch.
3. **Going public** (maintainer will flip it after r46): the pre-public scan of all 135
   commits found no credentials or personal data (pattern search; no gitleaks installed).
   The same day: make the `ghcr.io` package public, update the README's "Image access"
   caveat, set `CI_FULL=true`, require approval for outside collaborators' workflow runs,
   branch protection (`test` + `e2e`), private vulnerability reporting, link the changelog
   from `/about`. CI is in private-repo mode until then and the account is out of Actions
   minutes (GHCR has no image after 578eb84; the test copy is built locally).
4. **Stage 5** leftovers (Next steps 1): Unraid Community Apps template, `v1.0.0`. README
   screenshots are done (`docs/images/`, throwaway r45 instance with invented data and the
   SDCP mock; re-shoot with `data/readme-shots/run.sh` on Unraid).
5. Wait for (or ask about) the maintainer's phone checks below, then act on them.

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
| Release (Unraid template, domain, public repo)                                 | Not started                                                                    |
| PWA (manifest, icons, service worker, offline page, update prompt)             | Done; real-phone checks pending                                                |

Reference result: Elegoo Centauri Carbon (256 × 256, cutter keep-out, pack 1.0.1) → 21
plates, no warnings, export guard clean; 457.5 h from the maintainer's sliced file.

## Waiting on the maintainer

- (2026-11-12) r45 is live: sign in once with each method in use (password, Authentik) and
  say whether the landing quick row of build buttons stays (it repeats the build name
  that is also on each card).
- Delete on Unraid? r45 check leftovers: the test copy's `migrate-rehearsal/r45` (rehearsal
  DB with a throwaway account) and `migrate-rehearsal/r45-check` (a copy of the live data
  with a throwaway owner account and one generated test photo), repo `data/r45-check/`
  (holds that account's password) and `data/readme-shots/`. Older: `data/cf-run-r1`, `data/cf-run-r2`, `link-sweep/`, `mobile-perf/`,
  `cam-fix/`, loose `shoot-*.mjs` / `*-run.sh`, and the old `tmt-backup-pre-r10..r37.db`
  backups. Stale remote branches (`ci/e2e-container`, `feat/octoeverywhere-share-link`,
  `fix/*`, `hotfix/*`): delete before going public?

- (2026-11-11) Keep or delete the GitHub release asset for kit pack 1.0.0 (no longer baked
  into the image)? (The 21-plate re-check after the re-orientation removal passed on r42.)

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
- **Files tab** [plates-3mf]: on r45 (copy of live data, in-app navigation) the 1440 view
  agrees from the first render, but at 390 the layout select still showed "Loading…" while
  the heading already named the layout (agreed after network idle; one run per width).
  Look at the network waterfall; suspected: the fetch queued behind SSE and printer streams.
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
  the unused copy; designs from the base kit don't apply to a copy.
- **Security** (Stage 1 done; `docs/dev/audit-2026-11.md` has the findings and their status).
  Open Lows, none blocking: storage totals are re-measured from disk on every upload
  (`quota.ts` `workspaceUploadBytes`; a cache needs an invalidation call from photo, plate
  and kit writes); the converted GLB after a STEP conversion is only counted at the next
  upload; migration 0007 created `templates.owner_org_id` without the ON DELETE CASCADE the
  schema declares (worked around in `account.ts` `deleteOwnedTemplates`; fix with the
  migration squash); chapter delete runs our cleanup just before Better Auth's own delete,
  not in one transaction; activity is pruned to the newest 5000 rows per build; write-rate and slot state is per process (single process
  only); an OctoEverywhere link's status socket (wss) has its address checked as public right
  before each dial but is not pinned (the camera path is pinned).
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
  credited; the maker guide is linked, not bundled.
- One place per task: kit files live in the wizard's template step and Files → print
  settings; the hardware model is not user-uploadable.
- Chapters are optional (personal "My builds" workspace); printers work in personal
  workspaces.
- Palettes/generator exclude matte, silk, transparent, glow, marble, wood, glitter, rock,
  multi-color, CF/GF and non-95A TPU. Manual picks are unrestricted. No ready-made palette
  has near-black tires.
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
