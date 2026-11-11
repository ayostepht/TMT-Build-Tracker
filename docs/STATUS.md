# Project status

_Last updated: 2026-11-10 (audit + staged proposal approved; last deploy r37, d1a815c)._

This file holds **current facts only**: what works, what's open, what's next, what's
decided. History goes in `docs/CHANGELOG.md`; how things work goes in
`docs/architecture.md`. Rewrite entries in place rather than appending; delete what is
done. Keep it under ~150 lines.

## Pick up here

1. Read `docs/audit-2026-11.md` (audit + staged proposal, approved 2026-11-10; untracked
   until Stage 1 ships because it describes exploitable gaps).
2. Start Stage 1 and Stage 2 from Next steps (they run in parallel).
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
- **Printers** [printers]: live supervisor test with the Centauri Carbon during a real
  print (auto-link needs plate numbers in file names; Elegoo Slicer's names lack them);
  OctoEverywhere notification webhooks (needs a public URL, shared-secret check);
  `BuildPrinter` has no `teamPrinterId` link back to the team printer.
- **Plates** [plates-3mf]: print-template "printer" and "manual" profile sources not
  wired; 3D chair from 3MF only (no STEP) for user-uploaded templates.
- **Kit** [kit-and-startup]: template copies: switching back to the built-in kit leaves
  the unused copy; designs from the base kit don't apply to a copy.
- **Security**: 1 critical and 5 high findings for a public instance (any signed-up user
  can point the server at any host/port; unverified email claims invites and site admin;
  open sign-up; 1.1 GB global body limit; no quotas; `X-Forwarded-For` rate-limit bypass).
  Details and owners: audit §1 and Stage 1. Not safe to expose publicly until Stage 1 ships.
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

## Next steps (in order)

Stages from `docs/audit-2026-11.md` Part 2 (items, owners and exit checks are there).
Stage 0 (placeholders for private addresses, `MAX_3MF_MB` docs, compose secret) is done.
Done so far in Stage 1: the config contract in `config.ts` (`appMode`, `signupMode`,
`socialProviders`, `trustedProxy`, `validatePublicMode`; nothing consumes it yet) and a
production check that rejects secrets under 32 characters or known placeholders (still
lazy: it fires on first auth use, not at boot). Done so far in Stage 2: the Now card's log
sheet preselects Success; the build view re-fetches on reconnect, tab visible, online and
focus. Mac e2e: keep Node 22 first on PATH (Homebrew's Node 25 breaks the build) and call
`/opt/homebrew/bin/flock` by absolute path. The local `docker build` needs kit-pack
download credentials.

1. **Stage 1, safe to expose** (hard gate for public hosting): `TMT_MODE`, outbound guard
   for printers/camera/Spoolman, SSO-only public mode, sign-up switch, trusted-proxy rate
   limits, body limits, quotas, secret check, security headers, account deletion. Ends
   with a `security-reviewer` re-audit: no Critical or High.
2. **Stage 2, daily loop and phone shell** (parallel with Stage 1): Now printing / Next up
   on the landing page, one start/log component, re-fetch on resume, optimistic status,
   compact phone header and bottom bar, error page. Also the iPhone checks and whatever the
   Elegoo Slicer export re-test turns up. Open: one name for chapter/workspace/team.
3. **Stage 3, PWA**: manifest (icons incl. maskable and apple-touch-icon, light/dark theme
   colors, `display: standalone`, `start_url /`), iOS meta and safe-area insets, a service
   worker caching the app shell and immutable assets/GLBs but never API data, offline
   fallback, update prompt, re-checking r35/r36 resume behaviour in standalone mode, and a
   real logo/favicon. Needs https; plain-http LAN installs must keep working without it.
4. **Stage 4, cleanup and design system**: remove prototype import and re-orientation
   code, slim the image, style scales, class-name leaks, contrast, design studio a11y pass
   and Options placement. Open: squash migrations (needs a journal reset on the test copy).
5. **Stage 5, docs and 1.0**: Docker-first README and guides, in-app help/about/privacy,
   CONTRIBUTING/SECURITY, `v1.0.0`, e2e gating the image, Unraid template (+ Community
   Apps), repo public.
6. **Stage 6, printer breadth**: https/wss for Moonraker and OctoPrint, hardware checks,
   plate numbers in export names, the bridge, inbound webhooks (incl. OctoEverywhere),
   Prusa Link and Duet adapters; printer supervisor live test.
7. **Stage 7, public launch**: `TMT_MODE=public`, backups of database and uploads, uptime
   check, soft launch.
