# TMT Build Tracker

Self-hostable, open-source web app for makers 3D-printing **MakeGood 3D TMT** (toddler
mobility trainer) chairs: teams ("chapters") plan, print, assemble and hand off builds.

## Docs map

| File | What it holds | Who reads it |
| --- | --- | --- |
| `CLAUDE.md` (this) | Rules, stack gotchas, conventions, how work is done | Everyone |
| `docs/STATUS.md` | Current state, open items, decisions, next steps | Orchestrator, every session |
| `docs/architecture.md` | Where code lives and how each area works | Subagents, for their section |
| `docs/dev-environments.md` | Machines, setup, e2e locking, deploy outline | Orchestrator on a new machine |
| `CLAUDE.local.md` (untracked) | This machine's private values: test copy, printer, deploy specifics | Orchestrator |
| `docs/CHANGELOG.md` | Deploy history | Append only |
| `.claude/agents/*.md` | Specialist subagents | Claude Code |

## Main session: you are the orchestrator

_Subagents: skip this section; follow "Subagent contract" below._

**Start of session:** read `docs/STATUS.md`, then `CLAUDE.local.md`. If `CLAUDE.local.md`
is missing, follow "New machine" in `docs/dev-environments.md` before anything else.

**You do:** talk to the maintainer, plan, split work, brief subagents, read their reports,
decide, update `docs/STATUS.md` / `docs/CHANGELOG.md` / `docs/architecture.md`, commit,
push and deploy (with the maintainer's OK).

**You don't:** edit anything under `src/`, `e2e/`, `scripts/`, `drizzle/`, `static/` or
config files, and you don't run tests, builds or the dev server. If a fix is one line,
it still goes to the owning agent. Reading code to write a good brief is fine. The one
exception is the deploy routine in `docs/dev-environments.md` (image build, backup,
migration rehearsal, container swap), which is yours. Other exceptions only when the
maintainer says so in this session.

**Dependencies:** agents never run `npm install`/`npm ci` while other agents are running.
If `node_modules` is missing or `package.json` changed, have one agent (or `verifier`)
install first, then start parallel work. A task that adds a dependency runs alone.

**Briefs carry the machine:** agents don't read `CLAUDE.local.md`. On the Unraid dev
container, say in every brief that Node isn't installed and commands run in containers per
`docs/dev-environments.md`.

**Routing:**

| Area | Agent |
| --- | --- |
| Part status, runs, undo, accounting, activity, SSE, drafts (server), import | `build-state` |
| Arranger, 3MF parse/export, plate matching, plate times, print template | `plates-3mf` |
| Printer adapters, supervisor, jobs, camera, Spoolman, printer store | `printers` |
| Design tab, 3D viewer, palettes, picker, designs gallery, Studio UI, `app.css` | `design-studio-ui` |
| Filament catalog data and scripts | `filaments-catalog` |
| Schema, migrations, seed, startup, kit pack, STEP → GLB | `kit-and-startup` |
| Auth, teams, invites, workspaces, onboarding, wizard, Overview/Finish, kit admin UI, layout/nav | `app-shell` |
| Dockerfile, CI, Unraid, README install docs, origin/proxy, PWA | `release-pwa` |
| Writing or fixing Playwright specs | `e2e-playwright` |
| Final gate before commit (check, lint, unit, build, chosen e2e) | `verifier` |
| Security review (auth, access, API, uploads, printers) | `security-reviewer` |

Work that spans areas: split it so each agent owns distinct files, or run them in
sequence. Never let two parallel agents edit the same file. Shared contracts first: if
parallel work needs a schema change or new shared types (`domain/types.ts`), dispatch that
alone (`kit-and-startup` / `build-state`) and start the parallel agents after it lands.
Urgent fixes (e.g. a print in progress) ship on their own, built from a clean worktree,
ahead of unfinished work.

**Brief every dispatch with:**
1. Goal and the user-visible result, in the maintainer's words where possible.
2. Files/dirs the agent owns for this task, and files it must not touch.
3. Decisions already made (link STATUS Decisions) and what is out of scope.
4. Checks to run (its own Verification list; name the e2e specs).
5. Report: per the Subagent contract.

**Accepting work:** a report counts only if it shows the commands run and their pass/fail
output. Missing output, skipped checks without a reason, or failing checks → send it back
to the same agent (SendMessage), don't fix or re-run it yourself. Before committing a change
set, dispatch `verifier` once for the whole set; dispatch `security-reviewer` when the diff
touches auth, access, API routes, uploads or printers. Don't re-run the full e2e suite
before a deploy when the agents ran their relevant specs (maintainer, 2026-11-08). For UI
changes, look at one desktop and one phone screenshot from the report before telling the
maintainer it's done.

**End of session (and before a context reset):** fold the agents' STATUS notes into
`docs/STATUS.md` (rewrite in place, delete what's done), add a `docs/CHANGELOG.md` entry
per deploy, update the touched `docs/architecture.md` sections, commit them with the work.

**Ask the maintainer** before: deploying, deleting anything, schema changes on the test
copy, revisiting a STATUS decision, anything outward-facing (push to a public place, PRs
upstream, making the repo public).

## Subagent contract

_Every specialist in `.claude/agents/` follows this; agent files only add area rules._

- **Start:** read this file's Ground rules and Conventions, your section of
  `docs/architecture.md`, and the open items for your area in `docs/STATUS.md`. Read the
  tests next to the code before changing it.
- **Stay in scope:** edit only the files the brief gives you. If the task needs a file
  outside it, or would break a Ground rule or a STATUS decision, stop and report back.
- **Never:** commit, push, tag, deploy, `rm` files (write new files instead; deletions
  are the maintainer's call), copy or touch the live database or the test copy container,
  contact real printers (unless the brief says so), or put private values (IPs, domains,
  emails, access codes) in code, tests, fixtures or reports.
- **Blocked or denied command** (permission prompt, hook): stop and report it. Never retry
  it with a different spelling or another tool.
- **Clean up:** dev servers and throwaway containers per `docs/dev-environments.md`
  (ports 5173-5199, containers named `tmt-*`, `--rm`); leave no background processes or
  containers running. Send exactly one final report.
- **Where commands run:** on the Unraid dev container there is no Node: run every `npm`,
  `npx` and image build inside throwaway containers exactly as in
  `docs/dev-environments.md` ("Running tools on the Unraid dev container"). Check with
  `command -v node` before your first command. Never run `npm install`/`npm ci` unless the
  brief says so.
- **E2E:** use `--reporter=line` (the html reporter hangs on failure) and the lock
  described in `docs/dev-environments.md` for this machine. Run your specs alone and with
  specs that share data; the full suite only when asked.
- **Report (final message), in this order:**
  1. Files changed (and migrations generated).
  2. Commands run, each with pass/fail and the relevant output lines.
  3. Skipped checks and why (e.g. real-file tests without `KITPACK_DIR`, no Docker).
  4. Screenshot paths (UI work), app bugs found but not fixed.
  5. Questions or decisions for the maintainer.
  6. **STATUS notes:** 2-5 lines for `docs/STATUS.md`, and **Architecture notes:** what
     changed in your `docs/architecture.md` section (or "none").

## Ground rules

- **HARD RULE: never re-orient parts in 3D.** Parts keep the face-down orientation from
  their source file. The arranger and the 3MF export may only rotate parts flat about Z
  (0/90° or a free in-plane angle). Never change which face is down, stand a part on an
  edge, or tilt it (no code exists that can: the 3D re-orientation code was removed on
  2026-11-11; do not add any back, see the header of `src/lib/domain/arrange.ts`). A part
  that doesn't fit flat is reported as oversize, with advice.
- **Printers are read-only.** The only command ever sent is Elegoo SDCP Cmd 386
  `{"Enable":1}` (camera on), through `sdcpEnvelope`. Never move, heat, pause, stop or start.
- **MakeGood files: CC0, shipped as a kit pack, never in git.** The converted model and
  print geometry ship as a versioned kit pack (GitHub release asset, baked into the Docker
  image, sha256 in `kitpacks/index.json`), installed on first start. Always credit
  MakeGood. `.gitignore` blocks `*.3mf`, `*.glb`, `*.step`, `*.kitpack`, `uploads/`; keep
  it that way. The maker guide PDF is not bundled: reference page numbers and link it.
- **Template vs design vs build.** A _template_ is a printable kit with generic filament
  roles (`primary`, `accent`, `soft`, `tire`). A _color design_ maps roles to filaments
  and parts to roles. A _build_ belongs to a team, snapshots a design, and holds all
  progress. Never put one user's colors or progress into a template.
- **No personal data in fixtures or seeds** (build progress, recipient or hospital names,
  user slicer files). Tests that need a real 3MF skip when the file is absent.
- A single `docker run` with an empty `/data` must work: migrations and seeding run on
  startup and are idempotent.

## Stack

SvelteKit 3 (Svelte 5, TypeScript, `adapter-node`), SQLite via `better-sqlite3` and
Drizzle (migrations in `drizzle/`, generated with drizzle-kit; never `push`), Better Auth
1.7 (email/password, organization plugin for teams/roles, optional OIDC via `OIDC_*`),
three.js, fflate + fast-xml-parser for 3MF, Server-Sent Events, Vitest + Playwright.

Gotchas:

- No `$lib` alias: import via package.json subpath imports with explicit extensions
  (`#lib/server/db/index.ts`). Hook types from `@sveltejs/kit/hooks`, `building` from
  `$app/env`. Server config is read from `process.env` in `src/lib/server/config.ts`.
- `.npmrc` sets `legacy-peer-deps=true`; plain `npm install` fails without it.
- `/api/auth/*` is routed to `auth.handler` directly in `src/hooks.server.ts`. OIDC uses
  `signIn.social({ provider: 'oidc' })`; redirect URI `<BETTER_AUTH_URL>/api/auth/callback/oidc`.
- Migrations load from `./drizzle`, so the server must start from the app root.
- Origins: adapter-node v6 ignores `ORIGIN`. `scripts/proxy-origin.mjs` is preloaded
  (`node --import`, used by `npm start`, the Dockerfile and Playwright) and normalises
  `X-Forwarded-Proto/Host`. `PUBLIC_URL` set → that origin is forced and Better Auth uses
  it as `baseURL`; unset → the request's own origin, http, cookies never Secure.
- `hooks.server.ts` adds `x-forwarded-for` from `getClientAddress()` for Better Auth rate
  limits (known gap: spoofable without a proxy).
- Uploads stream to disk; `BODY_SIZE_LIMIT=1100M` in the Dockerfile; 3MF limit
  `maxThreeMfBytes()` (`MAX_3MF_MB`, default 1024), STEP zips 200 MB. Read files on disk
  through the zip central directory (`threemf/zipfile.ts`), never fflate `Unzip` on a path.

## Conventions

- Visual language: tokens in `src/app.css` (Barlow Condensed / IBM Plex Sans / IBM Plex
  Mono, light + dark via `prefers-color-scheme` and `data-theme`). Mobile-first: makers
  update status from their phone at the printer. UI is checked with screenshots at 390 px
  (phone) and 1440, 1920 and 2560 px (desktop, also at 125/150% device scale), light and
  dark; checks up to 1280 px once missed a badly scaled desktop layout.
- Actions are buttons (`.btn`, `.btn.primary`, `.btn.go` + `.btn-arrow`, `.btn.back`,
  `.btn.ghost`) or clickable badges (`.pill-link`); text links only inside sentences.
- Global class names in `src/app.css` (`.bar`, `.head`, `.chip`, `.group`, `.dot`, `.more`,
  `.brand`, `.tabs`, `.seg button`) leak into components: use distinct component class names.
- Form fields are 16 px on coarse pointers (iOS zooms on focus otherwise).
- Permissions are checked on the server for every mutation (owner / editor / viewer;
  `src/lib/server/access.ts`). UI hiding is not access control.
- Every build mutation goes through `mutateBuild` in `src/lib/server/builds/actions.ts`,
  writes an `activity` row and emits an SSE event; new activity kinds need a sentence in
  the activity formatter.
- State rules live in `src/lib/domain/actions.ts` only; `src/lib/domain/` has no DB,
  Svelte or Node imports.
- Client fetches go through `src/lib/client/api.ts`.
- Route ids include the `(app)` group: `resolve('/(app)/builds/[id]')`.
- E2E specs share one database and server per run; a spec that changes template-level data
  restores it in `afterAll`; specs pass alone and in the full suite.
- No email sending yet: invitations produce a copyable `/invite/[id]` link.
- Schema change → edit `schema.ts`, `npm run db:generate`, commit the migration with the
  code that uses it.
- Secrets (printer access codes, OIDC secrets) stay out of logs and API responses; printer
  credentials are stored encrypted.

## Commands and definition of done

```bash
npm run dev          # dev server
npm run check        # svelte-check / types
npm run lint
npm test             # vitest (agents: npx vitest run <files>)
# Unraid dev container: no Node; wrap these as in docs/dev-environments.md
npm run test:e2e     # playwright, see docs/dev-environments.md
npm run build
docker build -t tmt-build-tracker:dev .
```

Done = `check`, `lint`, `test` and `build` pass (run by the agents and the `verifier`),
the relevant e2e specs pass, and anything touching startup is verified with `docker build`
+ a run against an empty data directory.
