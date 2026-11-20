# Changelog

All notable changes to TMT Build Tracker are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/) once 1.0.0 is out.

To update an install, see [Backup and upgrade](docs/guides/backup-and-upgrade.md). Take a backup first: database migrations run automatically at start and cannot be undone.

## [Unreleased]

**Upgrading:** back up your `/data` folder first. This release adds database migration 0004 (additive: it records which pieces of a multi-piece part are on a print; existing data is not rewritten). It runs automatically when the container starts and cannot be undone, so to go back you restore the backup. See [Backup and upgrade](docs/guides/backup-and-upgrade.md).

### Added

- **Print some pieces of a part.** A part made of several pieces (for example Harness and Straps, nine pieces on its own plate) now has a "Print some pieces…" button, on the part row and on its plate when it is the only part left to print. Pick the pieces that are on this print (all the ones not ticked yet are ticked to start with), and mark them as printing, or log them as a print without marking them first. Now printing shows the part with "3 of 9 pieces", their names, and their share of the grams and time (pieces have no weights of their own, so the share is by piece count and marked approximate). A successful print ticks exactly those pieces; when the last piece is ticked the part becomes Printed, until then it goes back to To print with its "3/9 pieces" count. A failed print ticks nothing and flags the part for reprint. Undo, editing or deleting such a log, ticking pieces by hand, and "Take off printer" all keep the ticks and the status in step, and the grams and time still to print count only the pieces left. The button is not offered on plates that print more than once or one part per run, nor while another print of the part is on the printer.
- **Print some parts of a plate.** If you split a plate in your slicer (for example the straps on their own), a plate on the Print tab now has a "Print some parts…" button. Pick the parts that are on the printer (all are ticked to start with), and mark them as printing as one print, or log them as one print without marking them first. With a printer connected, "Where is it printing?" still asks, and that printer's job is linked to the picked parts only. The rest of the plate stays to do. Now printing shows only the parts you picked, with their share of the plate's grams and time.

### Changed

- **The plate arranger follows the kit's layout.** Plates follow the kit's layout first (or your uploaded file's): a plate stays as the kit has it while its parts share a filament, a part that is alone on its plate stays alone, only parts whose filament no longer matches move, and brims count toward a part's space (for plates that are laid out new: the parts that move, a part that joins a plate and the plates added at the end; a kit plate that stays is placed as the kit authors it). A part that moves joins a kit plate of the same filament that already holds several parts when it fits without crowding it (at most 60% of the bed, the parts already there stay put); otherwise it gets a new plate at the end. A plate the kit prints several times with the same shape (the wheel rims) stays one plate and says how many times to print it, in which colors. Plates keep the kit's numbers, so a standard-palette build on a 256 mm bed has the kit's 24 plates. The 3MF export holds one copy of a repeat-printed plate with a note. Builds you already have keep their plates until they are re-arranged. An arranged build that has not started printing is re-arranged by itself, as before, when its colors, variant or printer change, and now gets the kit's layout and numbers; a plate that keeps the same parts keeps the time and grams you typed for it, also when its number changes. A build that has started printing keeps its plates until you choose Re-arrange.

### Fixed

- On a plate the kit prints several times per part, such as the wheel rims, the grams and time are now per print, the counter counts prints ("0/4 printed"), the fields read "per print", the exported plate name says "(print x4)", and the tires diagram no longer quotes both runs' grams as one run. Tires keep "per run".

## [0.9.3] - 2026-11-19

**Upgrading:** back up your `/data` folder first. This release adds database migration 0003 (additive: a Spoolman filament link and cache, and a creation time on print logs, filled in for your existing prints). It runs automatically when the container starts and cannot be undone, so to go back to 0.9.2 you restore the backup. See [Backup and upgrade](docs/guides/backup-and-upgrade.md).

**Security:** this release adds resource limits for uploads, exports and 3D model conversion, so one request or one account cannot use up the server's memory, disk or time. They matter most for a server run in public mode (`TMT_MODE=public`); a normal self-hosted server keeps working as before, and the details are under Changed below and in the [environment reference](docs/guides/environment.md). Everyone on `latest` should update.

### Added

- Spoolman filaments: link each color of a build to its filament in Spoolman, from the Overview filaments, a new Spoolman step in the build setup, or a color slot on the Design tab. Matching filaments are suggested. While a color is linked, Spare counts what Spoolman says is left on all of that filament's open spools, and the build's own spools are hidden until you unlink (their history is kept).
- Choose who keeps Spoolman up to date (chapter Settings, Integrations): "This app" takes each logged print's grams off the linked spool and moves on to the next spool of that filament when one runs out; "Something else" only reads Spoolman. A chapter that sets up Spoolman for the first time starts with "This app"; chapters that already use Spoolman keep their setting.
- Prints logged before a color was linked are never taken off Spoolman by themselves. When you link, the app says how many grams were already logged and offers to subtract them once (with a way to give them back).
- Create filaments in Spoolman: when no Spoolman filament matches a color, the link picker offers "Create in Spoolman" with the vendor, name, material, color, density and weights filled in from the filament catalog (all editable). A missing vendor is created too, and the color is linked to the new filament.
- Add and archive spools in Spoolman: on a linked color the + adds a spool of that filament in Spoolman (weight and an optional note). It shows in the color's history as a Spoolman spool, and removing it asks whether to archive it in Spoolman as well.

### Changed

- The build header cards no longer cut their detail lines short on desktop: parts printed reads "30 to go · 1 failed" and projected finish "~337 h left". The full sentences, including your printing pace, are in each card's hover text.
- Limits on very large or unusual 3MF files: a 3MF whose settings, thumbnails or other contents are far larger than any real sliced project is refused with a message instead of being read. Real projects are accepted: up to 20,000 files, 8 MB of slicer settings (2 MB on a server in public mode) and thumbnails for up to 256 plates. Per-object filament measuring from G-code stops on very large files and falls back to sharing by volume; the upload still works.
- Limits on export and arrange requests: each person can prepare a few 3MF exports at once and a generous number per minute; past that the app asks you to wait a moment and says for how long. On a self-hosted server, plate and export-preview refreshes have their own, much higher limit that normal use never reaches; a server in public mode counts them with exports. Site admins are not limited. When asked to wait, the Files tab keeps its last export preview and Download button, and both it and the plates view try again by themselves.
- On a server running in public mode, only site admins can upload a STEP zip to convert a 3D model. Self-hosted servers in the default mode are unchanged. The converter now reads the zip one file at a time (up to 10,000 files), so it needs less memory.
- Form limits: build name, recipient and hospital are limited to 200 characters. The fields stop at 200 characters as you type; text sent another way is shortened (name) or refused with a message (recipient, hospital).
- Server error logs no longer include database query values.
- Dependencies updated to their latest compatible versions.

### Fixed

- A blank `ORIGIN=` (an empty `ORIGIN` environment variable, as some templates and compose files leave) no longer stops the server from starting. The app now keeps `ORIGIN` and `PUBLIC_URL` in step, so the two cannot disagree.

## [0.9.2] - 2026-11-16

**Upgrading:** back up your `/data` folder first. This release adds two database migrations (0001 and 0002, both additive: new columns for entered weights and spool adds). They run automatically when the container starts and cannot be undone, so to go back to 0.9.1 you restore the backup. See [Backup and upgrade](docs/guides/backup-and-upgrade.md).

### Added

- Stats: a Stats tab on every build (printing time and filament used, progress with a projected finish, failures per plate, filament by colour against your stock, plate time against the estimate, hours per day) and a Stats page for the workspace (hours per week, printers, most-used filaments, plates that fail most, a table of builds, over the last 3, 6, 12 or 24 months). Every chart has a sentence that says what it shows and a "Show data" table.
- An optional one-piece push handle for printers with a bed of about 340 x 320 mm (Bambu H2S, H2D): choose "One piece, H2 series" under the push handle option. It is an experimental community design by jeepxj (CC BY-NC, endorsed by MakeGood) that replaces the push handle top, bottom, brace and pin and keeps the soft grip. It ships in kit pack 1.0.2, which installs by itself on the next start; builds you already have do not change.
- Lock part color: a part can keep its filament when you choose a palette. Turn on "Lock part color" in the part card; locked parts show a lock in the part list and the card. A locked part stays on its exact color: if the palette changes its slot, the part moves to a slot that holds its old filament (added for you when needed).
- Remove a color that parts still use: Remove is now on every color you added. A dialog lists the affected parts and asks which of the design's other filaments replaces it; confirming reassigns them and removes the color in one step, in builds and in Studio drafts. The color's spools on hand and Spoolman link are dropped with it, and the activity log says what changed.

- Enter a part's weight yourself: a part without a weight (the rear caster mounts, for example) now shows "Add weight" in the part list; the grams you type count in the plate, the log sheet and the filament totals and are marked "your entry". Weights now read the same everywhere: your entry, then the weight from your slice, then MakeGood's estimate (marked "~").
- Plate weights next to the time: every plate header (Print tab, Files tab, the printing and next-up cards) shows its grams beside its hours, marked "~" for an estimate, "from file" for a sliced 3MF, or "your entry" for grams you typed. A plate with parts that have no weight shows the known total as "≥ 417 g · 1 part without weight"; tap the flag to add the missing weights on the spot. The grams you type for a plate now survive re-arranging, and the field on the Files tab says "overrides file 150 g" when it replaces the file's number.

- Applying a design to a build that has started printing now asks first. A dialog says what has started ("Plate 4 is printing; 22 of 64 parts printed; 18 prints logged") and offers "Colors only" (recommended: slot colors change; plates, print files, progress, logs, spools and locked parts stay) or "Colors and print files" (also moves parts to the design's slots; plates will need re-arranging). The colors-only choice lists slots it leaves alone (another material, or locked parts) and slots that change filament but keep their spools or Spoolman link. It is on the Design tab, on a design's page ("Copy into my build") and when applying a palette. After applying you get an Undo for a while.

- Add spools as you go: each color keeps its starting spools (kg) and you can add another spool any time with a dated history (who added it, how many kg, an optional note, removable). The stock is the starting spools plus every add, and Spare is that stock minus what is used and what is still to print.
- Partial prints with per-part results: when a plate with several parts does not fully succeed, choose Partial and tick the parts that printed OK. Those are marked printed and count as kept; the rest are flagged for reprint and count as lost. Grams (Kept and Lost) and hours are split between them by the parts' weights, and one Undo removes both logs. A failed print's grams are filled in from the printer's progress, or from "How far did it get?" when no printer reported it.

### Changed

- Filament and time now tell used from lost: "used" is split into what ended up in printed parts and what failed prints took (older Partial logs count as lost), and logged hours the same way. The totals are unchanged for existing builds. After a Partial, only the parts still to print count toward what is left.
- The build header shows four Stats cards (parts printed, printing time, filament used, projected finish) on every build tab, each linking to the Stats tab. On phones they sit four across under the build name, with a short "of ~382 h" estimate line under Time and Filament. The build details line (what is printing, parts to reprint, the deliver-by date) appears only when there is something to show, and still opens from the arrow beside the name on phones. The Design tab keeps its room for the chair: no cards there on phones.
- Recent activity has its own Activity tab (after Finish, before Settings). The Overview now shows only the last change with an "All activity" link, so it stays lighter. Studio drafts have no Activity tab.
- Choosing a palette now resets every part-level color change: unlocked parts go back to their kit colors, as the Apply bar says ("Resets N part changes · M locked kept"). Applying a palette is one saved change in the activity log, and Undo restores the colors and the parts together.
- Filament picker: a new Type filter replaces the "All types" checkbox. It defaults to the standard types, shown as "95A" for TPU and "PETG", and lists each other type present with its count (TPU hardness such as 85A or 98A, foaming, silk, matte, carbon-filled, ...), plus "All types".

### Fixed

- Stats: the dates along the bottom of a chart no longer run into each other.
- Stats: the "Show data" tables, and the table of builds on the workspace Stats page, scroll sideways inside their own card on phones instead of widening the page.
- Stats: the failures chart now counts failed prints of single parts too (they appear under their plate, or under "Not on a plate"), so its rows add up to the failed prints.
- Stats: hours are rounded the same way everywhere (whole hours from 100 h logged), so the Stats tab and the build header show the same numbers.
- Applying a design (or a palette that resets part colors) to a build that was already printing no longer happens without a warning, and no longer rebuilds its plates. "Colors and print files" is refused while a plate is printing or a printer job is running, and now keeps parts whose color is locked. The confirmations on the Design tab and on a design's page no longer claim plates are kept when they are re-arranged.
- Filament used: a print that was marked done with a failed attempt logged and the successful one logged without grams counted only the failed grams; it now uses the estimate for the kept print too. Parts with no weight at all are listed as missing instead of counting as 0 g.
- Lock part color: it locks only the part you tapped, even with "Both sides" on (it used to lock the matching parts too, such as a wheel rim on a different color). A slot added for a locked part now reads "Accent PETG · added" instead of repeating the kit slot's name.
- Filament picker: the number next to each Type now matches the swatches the picker lists for it (same-looking colors count once, as they are listed once), and a short list no longer repeats itself under "Closest to the current color" or hides its neutrals.
- Design: on phones the MakeGood and handle credit sits in its own band under the 3D view instead of running over the chair.
- Files: choosing one of MakeGood's plate layouts right after arranging plates for your own bed could be ignored (no "Replace plates?" question, the list snapped back). The choice now always applies.
- Now printing: moving from one build to another inside the app (for example from the builds menu) could leave the card without its live printer panel (printer name, progress, layer, temperatures, camera, "Not this plate") until you left and reopened the build. The panel now follows the build you are on.

## [0.9.1] - 2026-11-13

A patch release of the 0.9 pre-release: fixes from the first days of public testing. No database changes; update as usual (take a backup first).

### Added

- When a plate still has an earlier print that was never logged (for example a failed one), linking a new print to it says so, with a button that opens that print's log.

### Fixed

- Logging a failed or partial print no longer takes a plate off "Now printing" when the plate is already printing again on a connected printer. Deleting, editing or undoing an older print log keeps it printing too.
- A plate's start time and time left come from the printer when it is printing on a connected printer, also when you choose Printing after the print started or link a new print over an earlier one that was never logged.
- The "Where is it printing?" sheet no longer scrolls sideways on a phone when the printer shows a long file name.
- Choosing one of MakeGood's built-in plate layouts (for example Bambu X1 / P1 / A1) now counts as choosing the bed: the setup wizard continues without a printer, the plate layout card names the bed the profile is for, and its export works. Arranging plates for your own bed still needs your printer.

## [0.9.0] - 2026-11-12

The first public version: a pre-release for public testing; 1.0.0 will follow. Data formats are stable, but details may still change before 1.0.0.

### Added

**Builds and chapters**

- Plan a MakeGood 3D TMT chair as a **build**: every part, the print plates, filament colors and progress in one place. A guided setup walks through the kit, options, colors, printer and export, and you can reopen it later.
- Build in a personal workspace ("My builds") or with a **chapter**: members with owner, editor and viewer roles, invitation links you copy and send yourself (the app sends no email), and live updates so everyone sees changes as they happen.
- Pick the chair's variants (seat, rear caster, footrest, rim) and accessories; an activity feed records who changed what, and logging a print, starting a plate and part status changes can be undone.
- **Studio** drafts: try colors and options, lay out plates and export without creating a build, then turn a draft into a build.
- A **Help** page (getting started, printing day, glossary, FAQ), an **About** page, and **Privacy** and **Terms** pages. The build guide from MakeGood is linked, not included.

**Color designer**

- A 3D view of the chair that you can orbit, with a swatch picker per color role (primary, accent, soft, tires).
- A bundled filament catalog (from SpoolmanDB, MIT) with PETG, PCTG and TPU colors, a few extra vendor colors, and your own custom filaments.
- Palettes and a palette generator, color locks, and per-part color choices.
- Save a color design and share it; the designs gallery lets anyone apply a design to a build or draft.

**Plates and slicer export**

- Automatic **plate arranging** for your printer's bed, with keep-out zones (for example a filament cutter) and a printer catalog with about 70 models and bed presets. Parts only ever rotate flat about the vertical axis: the app never tilts a part or changes which face is down. A part that does not fit flat is reported as oversize, with advice.
- **3MF export** for Elegoo Slicer and OrcaSlicer, Bambu Studio, or a plain 3MF for other slicers, with each part's filament and MakeGood's per-part settings. Open the file in your slicer and check the plates before you print. So far it has been opened in Elegoo Slicer only.
- Upload your own sliced 3MF to read plate print times and filament use, or enter times by hand. The app shows expected hours and compares your pace with them.

**Print tracking**

- Start a plate in one tap and log the finish in two from the landing page ("Now printing" and "Next up"); the Print tab holds the full plate list, per-plate history and a log sheet for runs, failures and reprints, each with grams of filament used.
- Edit or delete a log entry, and undo recent changes. Filament use is counted per color role.
- Totals for time and filament per build.

**Printers (read-only)**

- Show a printer's live status (state, progress, temperatures, file, filament) next to your builds, link a running print job to a plate, and view the printer's camera. Elegoo (SDCP, for example the Centauri Carbon), Klipper (Moonraker), OctoPrint and Bambu Lab in LAN mode are supported. The Elegoo connection is the one in regular use on a real printer (Centauri Carbon); Klipper, OctoPrint and Bambu Lab LAN are newer and the project has not yet run them against real printers, so please report problems in the [issue tracker](https://github.com/ayostepht/TMT-Build-Tracker/issues).
- Printers are added, edited and removed on the workspace's **Integrations** page (**Add a printer**), with short setup steps for each kind. A chapter's Printers tab shows their status.
- Elegoo, Klipper (Moonraker) and OctoPrint printers can connect through an OctoEverywhere shared link instead of a local address (for Elegoo this also spares the printer's few direct connections). Elegoo, on your network or through a link, is the one in regular use; Klipper and OctoPrint through a link are expected to work from OctoEverywhere's documentation but have not been confirmed against real printers.
- A **Not connected** printer: a name only, for logging prints by hand. The app never contacts it.
- A plate is started and logged from its status badge: **Where is it printing?** picks the printer (or none), and **Printed** logs the result.
- The app never moves, heats, pauses, stops or starts a printer and never sends it a file. The one command it sends is Elegoo's "camera on". See [Printers](docs/guides/printers.md).
- Optional Spoolman link to show spool weight remaining and deduct filament. The Spoolman link is new and not yet proven against a real Spoolman install.

**Assembly and handoff**

- An assembly checklist, build photos, handoff details for the recipient, and a printable summary of the finished build.

**Installable phone app**

- Add it to your home screen on iPhone, Android or desktop. It opens full screen with its own icon, supports light and dark mode and phone safe areas, and shows an offline page and an "update available" message on https addresses. Builds, plates and progress are never stored or edited offline. See [Install on your phone](docs/guides/phone-install.md).
- Pages are designed for a phone at the printer: large tap targets, form fields that do not make iOS zoom, and fresh data when you return to the app.

**Self-hosting and sign-in**

- One Docker container with one data folder; start it with an empty folder and it sets itself up. Images for x86-64 and arm64. Guides for Docker, Docker Compose and Unraid (with a template file), plus backups and upgrades.
- The MakeGood kit (3D model and print geometry, CC0, by MakeGood) installs automatically on first start. Site admins can import their own print geometry or replace the model.
- Sign in with email and password, or single sign-on through any OpenID Connect provider (Authentik is documented step by step). Choose who can sign up: anyone, invited people only, or nobody new.
- A hosted "public" mode with Google and GitHub sign-in only and built-in usage limits. Printers there connect through OctoEverywhere links or are not connected; local printer addresses, printer discovery and Spoolman are not available, and link printers are limited per workspace and per site (`QUOTA_LINK_PRINTERS_PER_WORKSPACE`, `QUOTA_LINK_PRINTERS_TOTAL`, `QUOTA_MANUAL_PRINTERS_PER_WORKSPACE`).
- Reverse-proxy support with a fixed public address (`PUBLIC_URL`), or none for plain LAN use; guides for Nginx Proxy Manager, Caddy and Traefik.
- Account page: export your data, delete your account, and (for site admins) hand over the role. Command-line password reset links for forgotten passwords.

### Security

- OctoEverywhere link connections are pinned: the server dials the exact address it validated, with the certificate checked for the link name. Every printer WebSocket refuses messages over 1 MiB, binary messages and compressed frames, and never follows redirects; a connection that breaks these rules is closed and retried slowly.
- Security headers and a content security policy, request size caps, sign-in rate limits, and permission checks on the server for every change.
- Printer and Spoolman addresses must be on private networks (the one exception is an OctoEverywhere shared link); redirects are never followed. Printer access codes, API keys and shared links are stored encrypted and never sent back to the browser or written to logs.
- Streaming uploads with zip-bomb protection, and per-user write rate limits and storage quotas in public mode.

### Known limits

- Sign-up is open by default on a self-hosted install, and the app sends no email, so email addresses are unverified. Keep it on your LAN or set `SIGNUP=invite` or `SIGNUP=closed` (see [Environment reference](docs/guides/environment.md)).
- Live printer status over a full multi-day print is not yet proven: for a long print, check the printer itself.
- Behind a reverse proxy the sign-in rate limit relies on a client-address header; a client that can reach the container port directly could fake its address. See [Reverse proxy](docs/guides/reverse-proxy.md#client-address-and-rate-limits).

## Before 1.0

There are no earlier public versions, so there is nothing to migrate from.
