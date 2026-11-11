# Project status

_Last updated: 2026-11-11 (audit Stages 1-3 and most of Stage 4 are on `main`. Test copy is
on r43 = eba0e72 (Stage 4 wave 2). Stage 4 wave 3 (the whole app on the shared `ds-*` styles,
native dialogs) and the removal of the old global styles from `app.css` are on `main` and NOT deployed yet)._

This file holds **current facts only**: what works, what's open, what's next, what's
decided. History goes in `docs/CHANGELOG.md`; how things work goes in
`docs/architecture.md`. Rewrite entries in place rather than appending; delete what is
done. Keep it under ~150 lines.

## Pick up here

1. **`client/focus-trap.ts` has no users left**: delete it once the maintainer says so
   (asked 2026-11-11) [app-shell].
2. **Deploy wave 3 as r44** (maintainer's OK needed; from the Unraid dev container), then
   look on the test copy at what could not be seen locally: the plate view toggle and the
   "rotated N°" badge (need print geometry), the Now card while printing, printer badges
   other than "Printing", toasts over dialogs on a phone.
3. Remaining Stage 4 after that: `three`/`pdfjs-dist` to devDependencies (a dependency
   change: runs alone, on Unraid for the image build); legacy redirects and
   `src/lib/index.ts` (maintainer asked 2026-11-11: delete or keep until 1.0). Then Stage 5
   from Next steps.
4. Maintainer decisions pending: keep or delete the kit pack 1.0.0 release asset
   (recommended: keep until 1.0 is tagged); migration squash (needs a journal reset on the
   test copy); theme toggle; TypeScript 7 (Dependabot PR #11, fails check); making the repo
   public (then turn on branch protection at once; Dependabot is otherwise tidy).
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
| Elegoo via OctoEverywhere shared link                                          | Done; status + camera confirmed live through the link (r42)                    |
| Spoolman (optional)                                                            | Done, mock-tested only                                                         |
| Filament catalog + vendor supplement                                           | Done                                                                           |
| Release (Unraid template, domain, public repo)                                 | Not started                                                                    |
| PWA (manifest, icons, service worker, offline page, update prompt)             | Done; real-phone checks pending                                                |

Reference result: Elegoo Centauri Carbon (256 × 256, cutter keep-out, pack 1.0.1) → 21
plates, no warnings, export guard clean; 457.5 h from the maintainer's sliced file.

## Waiting on the maintainer

- (2026-11-11) Look at the wave 3 controls (after r44, or in `.playwright-mcp/stage4c-*/`):
  the selected `ds-seg` option now has an accent underline as well as the raised pill
  (dark mode needed it); the part status control and the log sheet's Result use it, so the
  selected option is the same accent colour whatever the status (Failed looks like
  Success); the camera dialog's title is small on desktop.

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

- **Design studio** [design-studio-ui]: a11y pass (audit L1-L4: contrast, focus order,
  aria); Options section placement at the bottom of the Parts tab (audit M6, needs a layout
  decision from the maintainer); "MakeGood · CC0" credit wraps over the chair at 360 px;
  `share/ApplyDesign` uses raw fetch (add `listDesigns` to `client/api.ts`);
  `editableTargets` lacks `kind` (can't tell builds from drafts); no "start a draft from
  this design"; draft cards have no 3D snapshot. Not yet raised with the maintainer: a
  selected part's chip covers the lower third of the phone stage; phone toasts cover the
  stage top for ~8 s. Destructive confirmations (`AskDialog` via `share/Dialog.svelte`)
  focus the confirm button first, so a stray Enter confirms (security Low, older than
  wave 3): focus Cancel first on destructive asks.
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
- **Files tab** [plates-3mf, app-shell]: on one r43 load the plate-layout heading read
  "MakeGood profile" while the select showed "Your uploaded 3MF" (greyed); an earlier load
  headed "Your uploaded 3MF". Heading and select can disagree; reproduce before fixing.
- **Printers** [printers]: OctoEverywhere shared link for Elegoo works live (status, camera,
  with the reconnect backoff fix; re-checked on r43). On r43 the landing Camera expander's
  first `camera/snapshot` got a 502 twice in one browser session, then 200s on direct
  retries: watch for a first-open race in the reworked `CameraTile`. `share-link.ts` `HOST_RE` only accepts
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
- **Security** (Stage 1 done; `docs/audit-2026-11.md` has the findings and their status).
  Open Lows, none blocking: storage totals are re-measured from disk on every upload
  (`quota.ts` `workspaceUploadBytes`; a cache needs an invalidation call from photo, plate
  and kit writes); the converted GLB after a STEP conversion is only counted at the next
  upload; migration 0007 created `templates.owner_org_id` without the ON DELETE CASCADE the
  schema declares (worked around in `account.ts` `deleteOwnedTemplates`; fix with the
  migration squash); chapter delete runs our cleanup just before Better Auth's own delete,
  not in one transaction; activity is pruned to the newest 5000 rows per build; no privacy
  or terms page yet (Stage 5); write-rate and slot state is per process (single process
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
  (`.card` = `ds-card`) for the whole app. While a dialog is open a toast shows above it but
  cannot be clicked (Undo waits until the dialog closes): accepted as is.
- Git history is kept as is when the repo goes public (private-range LAN addresses in old
  commits are accepted; no rewrite). Branch protection (no force push, no deletion,
  required `test` + `e2e`) is set the moment the repo is public: GitHub refuses it on a
  free private repo (2026-11-11).

## Next steps (in order)

Stages from `docs/audit-2026-11.md` Part 2 (items, owners and exit checks are there).
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

1. **Stage 4, cleanup and design system** (nearly done). Done: prototype import and 3D
   re-orientation code removed, kit pack 1.0.0 dropped from the image, unused components
   removed, scales and primitives in `app.css`, component styles on the tokens, leaked class
   names renamed with a guard test (`domain/style-leaks.test.ts`), contrast guard, native
   dialogs everywhere (browser focus trap, inert background), keyboard paths, one printer
   stream per chapter, every screen on `ds-seg`/`ds-badge`/`ds-modal`/`ds-card`, a damaged
   stored arrangement is treated as stale (no more 500 on export), the false reverse-proxy
   startup hint fixed, the deprecated globals deleted from `app.css` (373 lines; kept on
   purpose: `.tiles`, `.sw`, `.mini` via `Swatch`, `.spools`, `.clock`, `.tpl-list`, the
   other `.now-*`). One shared `isObj` (`domain/guards.ts`). Left: `three`/`pdfjs-dist` to devDependencies
   (runs alone, needs an image build: do it on Unraid); legacy redirects and
   `src/lib/index.ts` (deletions: maintainer's call). The two `slugify` copies stay on
   purpose (`teams.ts`: 40 chars, fallback `chapter`; `templates/fork.ts`: 30, `kit`). Open: squash migrations (needs a journal reset on the test copy; would also fix
   `templates.owner_org_id` lacking ON DELETE CASCADE); theme toggle (needs a decision);
   TypeScript 7 (Dependabot PR #11 fails check: a deliberate upgrade).
2. **Stage 5, docs and 1.0**: Docker-first README and guides, in-app help/about/privacy,
   CONTRIBUTING/SECURITY, `v1.0.0`, e2e gating the image, Unraid template (+ Community
   Apps), repo public.
3. **Stage 6, printer breadth**: https/wss for Moonraker and OctoPrint, hardware checks,
   plate numbers in export names, the bridge, inbound webhooks (incl. OctoEverywhere),
   Prusa Link and Duet adapters; printer supervisor live test.
4. **Stage 7, public launch**: `TMT_MODE=public`, backups of database and uploads, uptime
   check, soft launch.
