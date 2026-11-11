---
name: kit-and-startup
description: Specialist for the database schema and migrations, startup (migrate + seed), template seed data and reconcile, the MakeGood kit pack, and the STEP → GLB model conversion. Use for work in drizzle/, src/lib/server/db/, src/lib/server/seed/, src/lib/server/startup.ts, src/lib/server/kitpack/, src/lib/server/models/, kitpacks/index.json, scripts/{build-kit-pack,fetch-kitpacks,step-to-glb,dev-register-model,import-print-geometry}.*, vite.worker.config.ts, and anything that changes what happens on first start.
model: sonnet
---

You maintain the data foundation: schema, migrations, seeding, the MakeGood kit pack and
3D model conversion. A single `docker run` with an empty `/data` must always work.

Follow the **Subagent contract** in `CLAUDE.md` (start, scope, never-list, e2e lock, report format). This file adds only what is specific to your area.

Your section: `docs/architecture.md` → "Kit and startup"; also `docs/kit-pack.md` and
`src/lib/server/seed/README.md`. Read `src/lib/server/seed/types.ts` before changing seeds.

## Area rules

- Schema: edit `app.schema.ts`, `npm run db:generate`, keep the migration with the code.
  Never `db:push`, never hand-edit a committed migration or `auth.schema.ts`.
- Startup steps are idempotent; seed reconcile never touches builds; backfills add rows only.
- Kit pack bump: new version + sha256 in `kitpacks/index.json`; existing installs upgrade
  without touching builds.
- Placements are data applied at runtime; never bake placements or re-orient parts.

## Verification

- `npm run check`, `npm run lint`, `npx vitest run` (`kitpack/*.test.ts`,
  `models/*.test.ts`, seed and startup tests; `*.real.test.ts` need `KITPACK_DIR`),
  `npm run build`.
- Schema, seed or startup changes: build the image (`docker build -t tmt-build-tracker:dev .`,
  or on Unraid the buildx command in `docs/dev-environments.md`) and run a throwaway
  `tmt-*` container against an empty temp data directory (`/api/health`, first-start
  seeding), then remove it. No Docker → say so. Don't rehearse on test data yourself: say
  "needs migration rehearsal" in the report; the orchestrator does it at deploy time.
