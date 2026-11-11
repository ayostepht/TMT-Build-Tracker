# Project status

_Last updated: 2026-11-11 (audit Stage 1 complete on `main`: security re-review passed with no
Critical or High. Test copy is on r41, 7e05586; `main` is ahead of it and not deployed)._

This file holds **current facts only**: what works, what's open, what's next, what's
decided. History goes in `docs/CHANGELOG.md`; how things work goes in
`docs/architecture.md`. Rewrite entries in place rather than appending; delete what is
done. Keep it under ~150 lines.

## Pick up here

1. Deploy `main` to the test copy from the Unraid dev container (migration 0013 adds
   `site_admin`; startup now sweeps `imports/`: do the migration rehearsal and the Docker
   empty-`/data` run, neither could run on the Mac). Add the CHANGELOG entry.
2. Continue Stage 2 from Next steps; then Stage 3.
3. Wait for (or ask about) the maintainer's iPhone checks below, then act on them.

## Where we are

Milestones 1–7 are built and running on the maintainer's test copy. Milestone 8 (release)
has not started.

| Area                                                                           | State                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Builds, chapters, roles, live updates, activity                                | Done                                                                           |
| Prototype import, print logs (log sheet, edit, delete, undo)                   | Done                                                                           |
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
| Elegoo via OctoEverywhere shared link                                          | Done (r41); maintainer to enter the link and confirm live                      |
| Spoolman (optional)                                                            | Done, mock-tested only                                                         |
| Filament catalog + vendor supplement                                           | Done                                                                           |
| Release (Unraid template, domain, public repo)                                 | Not started                                                                    |
| PWA                                                                            | Not started (Next steps 4)                                                     |

Reference result: Elegoo Centauri Carbon (256 × 256, cutter keep-out, pack 1.0.1) → 21
plates, no warnings, export guard clean; 457.5 h from the maintainer's sliced file.

## Waiting on the maintainer

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
  stage top for ~8 s.
- **Drafts** [app-shell]: printer/layout pickers only in Files, not in draft Settings.
- **Printers** [printers]: OctoEverywhere shared link for Elegoo (merged; r41 has it without
  the reconnect/backoff fix 9c44a33): the maintainer enters the link in the printer form
  and confirms status + camera live. `share-link.ts` `HOST_RE` only accepts
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
- **Remove** the prototype import and the 3D re-orientation code (2026-11-10, Stage 4).
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
Done so far in Stage 2: the Now card's log sheet preselects Success; the build view
re-fetches on reconnect, tab visible, online and focus; plate print history and
delete-a-run on the Print tab. Mac: keep Node 22 first on PATH (Homebrew's Node 25 breaks
the build), call `/opt/homebrew/bin/flock` by absolute path, give each parallel e2e run
its own `E2E_PORT`; the local `docker build` needs kit-pack download credentials. CI's e2e
job failed twice on 2026-11-11 installing the browser (runner could not reach Ubuntu's
package server): re-run before reading it as a code failure.

1. **Stage 2, daily loop and phone shell**: Now printing / Next up
   on the landing page, one start/log component, re-fetch on resume, optimistic status,
   compact phone header and bottom bar, error page. Also the iPhone checks and whatever the
   Elegoo Slicer export re-test turns up. Naming: "chapter" + "My builds".
2. **Stage 3, PWA**: manifest (icons incl. maskable and apple-touch-icon, light/dark theme
   colors, `display: standalone`, `start_url /`), iOS meta and safe-area insets, a service
   worker caching the app shell and immutable assets/GLBs but never API data, offline
   fallback, update prompt, re-checking r35/r36 resume behaviour in standalone mode, and a
   real logo/favicon. Needs https; plain-http LAN installs must keep working without it.
3. **Stage 4, cleanup and design system**: remove prototype import and re-orientation
   code, slim the image, style scales, class-name leaks, contrast, design studio a11y pass
   and Options placement. Open: squash migrations (needs a journal reset on the test copy).
4. **Stage 5, docs and 1.0**: Docker-first README and guides, in-app help/about/privacy,
   CONTRIBUTING/SECURITY, `v1.0.0`, e2e gating the image, Unraid template (+ Community
   Apps), repo public.
5. **Stage 6, printer breadth**: https/wss for Moonraker and OctoPrint, hardware checks,
   plate numbers in export names, the bridge, inbound webhooks (incl. OctoEverywhere),
   Prusa Link and Duet adapters; printer supervisor live test.
6. **Stage 7, public launch**: `TMT_MODE=public`, backups of database and uploads, uptime
   check, soft launch.
