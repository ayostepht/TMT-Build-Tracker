# Project status

_Last updated: 2026-11-11 (filament role fix; last deploy r40, a9bedcb)._

This file holds **current facts only**: what works, what's open, what's next, what's
decided. History goes in `docs/CHANGELOG.md`; how things work goes in
`docs/architecture.md`. Rewrite entries in place rather than appending; delete what is
done. Keep it under ~150 lines.

## Pick up here

1. Wait for (or ask about) the maintainer's iPhone checks below, then act on them.
2. Design studio a11y pass and Options placement (open items, Design studio).
3. Next steps list at the bottom.

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
  wired; 3D chair from 3MF only (no STEP) for user-uploaded templates. Upload still
  stores raw slot → role grams (`builds/plates.ts`, `part-profile.ts` learning): check
  whether learned part profiles inherit stray slots (accounting filters them since
  fix/filament-role-mismatch).
- **Kit** [kit-and-startup]: template copies: switching back to the built-in kit leaves
  the unused copy; designs from the base kit don't apply to a copy.
- **Security** [release-pwa, review by security-reviewer]: without a proxy a client can
  spoof `X-Forwarded-For` (trust it only from configured proxies); open sign-up (add an
  invite/SSO-only setting); camera SSRF guard has no DNS-rebinding protection.
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
- The maintainer installs on Unraid themselves. The README must be a complete Unraid
  install guide (template XML, Docker tab steps, NPM + Authentik). Domain and Authentik
  details stay with the maintainer. MakerWorld page for credit:
  https://makerworld.com/en/models/2066081-3d-toddler-mobility-trainer
- Don't re-run the full ~6 min e2e suite before every deploy when agents ran their specs.

## Next steps (in order)

1. Act on the iPhone checks; design studio a11y pass and Options placement; credit
   overlap at 360 px.
2. Fix whatever the Elegoo Slicer export re-test turns up.
3. Milestone 8 release: Unraid template XML (+ Community Apps), NPM + Authentik on the
   maintainer's copy, README/install docs, make the repo public, CI e2e green on GitHub.
4. Proper PWA: manifest (icons incl. maskable and apple-touch-icon, light/dark theme
   colors, `display: standalone`, `start_url /`), iOS meta and safe-area insets, a service
   worker caching the app shell and immutable assets/GLBs but never API data, offline
   fallback, update prompt, and re-checking r35/r36 resume behaviour in standalone mode.
   Needs https (pair with the release's NPM/Authentik setup); plain-http LAN installs must
   keep working without it.
5. OctoEverywhere webhooks; printer supervisor live test.
