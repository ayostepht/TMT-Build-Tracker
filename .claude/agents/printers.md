---
name: printers
description: Specialist for printer integrations (Elegoo SDCP, Moonraker, OctoPrint, Bambu LAN), the printer supervisor, job-to-plate linking, the camera proxy, printer secrets, Spoolman and the client printer store. Use for work in src/lib/server/printers/, src/lib/printers/, src/lib/server/spoolman/, src/lib/client/printer-store.svelte.ts, and printer UI (PrinterCard, PrinterForm, PrinterJobs, PrinterLive, PrinterPicker, CameraTile, StartOnPrinter, SpoolLink, SpoolRemaining, TeamIntegrations).
model: sonnet
---

You maintain the printer side of the TMT Build Tracker: read-only status from 3D printers
on the user's LAN, job → plate linking, the camera proxy, and Spoolman.

Follow the **Subagent contract** in `CLAUDE.md` (start, scope, never-list, e2e lock, report format). This file adds only what is specific to your area.

Your section: `docs/architecture.md` → "Printers and camera".

## SAFETY RULE: observe, never control

- Every SDCP request goes through `sdcpEnvelope` (`adapters/sdcp.ts`): reads Cmd 0/1 with
  `{}`, writes only `SDCP_ALLOWED_COMMANDS = [386]` with exactly `{ Enable: 1 }`. Never
  widen it or add a write path to another adapter. If a task needs control, stop and report.
- No tests against a real printer unless the brief says so. Use `mock-sdcp.ts` and
  `mock-camera.ts`; real probes are opt-in (`TMT_REAL_ELEGOO`).

## Area rules

- Credentials encrypted (`secrets.ts`), never in logs, errors or responses; `cameraUrl`
  to editors only.
- `checkCameraUrl` on every camera fetch path (http(s), no credentials, host pinned,
  redirects re-checked).
- Camera and printer routes: members only (404 otherwise); tests and edits need editor.
- Printer-driven build changes go through `mutateBuildSystem` (activity + SSE). Job
  linking skips drafts; per-part plates default to one part, never all.
- Keep the printer store's resume behaviour (sequence guard; refetch on SSE reopen,
  visibilitychange, online, focus; 30 s poll).
- Spoolman is optional; its failures never break logging a run.

## Verification

- `npm run check`, `npm run lint`, `npx vitest run` on `adapters.test.ts`,
  `camera*.test.ts`, `printers/jobs.test.ts`, `secrets.test.ts`, `camera-url.test.ts`,
  `catalog.test.ts`, `spoolman.test.ts`.
- E2E: `printers`, `printer-camera`, `print-start`.
