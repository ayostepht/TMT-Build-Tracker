# Changelog

All notable changes to TMT Build Tracker are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/) once 1.0.0 is out.

To update an install, see [Backup and upgrade](docs/guides/backup-and-upgrade.md). Take a backup first: database migrations run automatically at start and cannot be undone.

## [Unreleased]

### Added

- An optional one-piece push handle for printers with a bed of about 340 x 320 mm (Bambu H2S, H2D): choose "One piece, H2 series" under the push handle option. It is an experimental community design by jeepxj (CC BY-NC, endorsed by MakeGood) that replaces the push handle top, bottom, brace and pin and keeps the soft grip. It ships in kit pack 1.0.2, which installs by itself on the next start; builds you already have do not change.
- Lock color: a part can keep its filament when you choose a palette. Turn on "Lock color" in the part card; locked parts show a lock in the part list and the card. A locked part stays on its exact color: if the palette changes its slot, the part moves to a slot that holds its old filament (added for you when needed).
- Remove a color that parts still use: Remove is now on every color you added. A dialog lists the affected parts and asks which of the design's other filaments replaces it; confirming reassigns them and removes the color in one step, in builds and in Studio drafts. The color's spools on hand and Spoolman link are dropped with it, and the activity log says what changed.

### Changed

- Choosing a palette now resets every part-level color change: unlocked parts go back to their kit colors, as the Apply bar says ("Resets N part changes · M locked kept"). Applying a palette is one saved change in the activity log, and Undo restores the colors and the parts together.
- Filament picker: a new Type filter replaces the "All types" checkbox. It defaults to the standard types, shown as "95A" for TPU and "PETG", and lists each other type present with its count (TPU hardness such as 85A or 98A, foaming, silk, matte, carbon-filled, ...), plus "All types".

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
