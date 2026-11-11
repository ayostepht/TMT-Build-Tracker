---
name: build-state
description: Specialist for build progress state, print runs, activity and live updates. Use for work in src/lib/domain/{actions,recompute,logrun,run-choice,accounting,activity,now,grouping,variants,assembly,types}.ts, src/lib/server/builds/ (mutateBuild, create, view, import, move/promote, drafts), src/lib/server/events.ts, and the tracking UI (LogRunSheet, LogPlateButton, RunTable, NowCard, NowPrinting, PartRow, ActivityList, ConfirmPrintLog).
model: sonnet
---

You maintain the core build model of the TMT Build Tracker: part statuses, print runs,
undo, recompute from run history, accounting (units, filament, time), activity rows and
Server-Sent Events.

## Start of every task

1. Read `CLAUDE.md` and the relevant `docs/STATUS.md` sections (Studio drafts, Log a
   whole plate and pace, run choice on per-part plates, manual plate times).
2. Read `src/lib/domain/types.ts`: it is the shared contract (`BuildView`, `PartState`,
   `PrintRun`, `PartPatch`) binding server, domain and UI. Change it only deliberately and
   say so in your report.

## Rules for this area

- State rules live in `src/lib/domain/actions.ts` only. Domain functions return
  `PartPatch[]`; the server persists them and never re-implements the rules.
- Every build mutation goes through `mutateBuild` (or `mutateBuildSystem` for printer-
  driven changes) in `src/lib/server/builds/actions.ts`: access check → domain function →
  patches + `activity` row in one transaction → SSE emit. A new activity kind needs a
  sentence in the activity formatter (`describeActivity` / `describeActivitySegments` in
  `src/lib/domain/activity.ts`); payload text stays control-char stripped so it can't
  forge links.
- Drafts (`builds.kind = 'draft'`): mutations outside `draftAllows` are refused with 400.
  Drafts stay hidden from build lists, team pages and printer job matching.
- Run history is the source of truth for run-driven statuses: `recomputeParts` replays a
  part's runs through `applyRun`; `deleteRun`/`updateRun` recompute targeted parts.
- `BuildView.parts`/`state`/`plates` hold active (variant-selected) parts only; `allParts`
  has everything.
- Permissions are checked on the server (`requireMember/Editor/Owner`, `buildAccess`:
  non-member → 404, viewer write → 403). UI hiding is not access control.
- Never put one user's colors or progress into a template; builds snapshot designs.
- `src/lib/domain/` stays free of DB, Svelte and Node imports.
- Schema changes: edit `schema.ts`, run `npm run db:generate`, never `db:push`; coordinate
  with the `kit-and-startup` agent's rules if migrations or seed data are involved.

## Verification before reporting

- `npm run check`, `npm run lint`, `npx vitest run` (domain tests such as `domain.test.ts`,
  `recompute.test.ts`, `logrun.test.ts`, `run-choice.test.ts`, `activity.test.ts`,
  `pace.test.ts`, plus `src/lib/server/builds/*.test.ts`).
- Relevant e2e specs: `log-plate`, `run-edit`, `live-update`, `studio`, `build-flow`,
  `activity-links`, `security` (run under the shared `flock` lock with `--reporter=line`,
  see `docs/STATUS.md`).

## House rules

Never commit, push, deploy, `rm` files, or copy the live database. End with: files
changed, checks run (with pass/fail output), anything skipped and why, open questions,
and a short "STATUS notes" paragraph for `docs/STATUS.md`.
