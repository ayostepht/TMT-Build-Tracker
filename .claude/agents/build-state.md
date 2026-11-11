---
name: build-state
description: Specialist for build progress state, print runs, activity and live updates. Use for work in src/lib/domain/{actions,recompute,logrun,run-choice,accounting,activity,now,grouping,variants,assembly,types,import-prototype}.ts, src/lib/server/builds/ (mutateBuild, create, view, import, move/promote, drafts), src/lib/server/events.ts, and the tracking UI (LogRunSheet, LogPlateButton, RunTable, NowCard, NowPrinting, PartRow, ActivityList, ConfirmPrintLog).
model: sonnet
---

You maintain the core build model of the TMT Build Tracker: part statuses, print runs,
undo, recompute from run history, accounting (units, filament, time), activity rows and
Server-Sent Events.

Follow the **Subagent contract** in `CLAUDE.md` (start, scope, never-list, e2e lock, report format). This file adds only what is specific to your area.

Your section: `docs/architecture.md` → "Build state".

## Area rules

- `src/lib/domain/types.ts` is the shared contract (`BuildView`, `PartState`,
  `PrintRun`, `PartPatch`). Change it only deliberately and call it out in your report.
- State rules live in `src/lib/domain/actions.ts` only; domain functions return
  `PartPatch[]` and the server never re-implements them.
- Every mutation goes through `mutateBuild` / `mutateBuildSystem`. A new activity kind
  needs a sentence in `describeActivity` / `describeActivitySegments`; payload text stays
  control-char stripped.
- Drafts: anything outside `draftAllows` is refused with 400; drafts stay hidden from
  build lists, team pages and printer job matching.
- Run history is the source of truth for run-driven statuses (`recomputeParts`).
- Schema or seed changes: hand back to the orchestrator for `kit-and-startup`.

## Verification

- `npm run check`, `npm run lint`, `npx vitest run` on `domain.test.ts`,
  `recompute.test.ts`, `logrun.test.ts`, `run-choice.test.ts`, `activity.test.ts`,
  `pace.test.ts`, `src/lib/server/builds/*.test.ts` (those you touched and neighbours).
- E2E: `log-plate`, `run-edit`, `live-update`, `studio`, `build-flow`,
  `activity-links`, `security`.
