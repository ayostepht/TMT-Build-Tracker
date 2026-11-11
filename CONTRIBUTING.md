# Contributing

Thanks for helping. TMT Build Tracker is a self-hostable web app for makers 3D-printing the MakeGood 3D TMT chair. Read the rules below before you open a pull request: a few of them are hard limits of the project.

## Rules that are not negotiable

- **MakeGood files never go into git.** The MakeGood 3D TMT model and print files are CC0 and ship as a separate **kit pack** (a release asset baked into the Docker image, see [docs/kit-pack.md](docs/kit-pack.md)). The repository holds only data about the kit (part names, settings, plate groupings). `.gitignore` blocks `*.3mf`, `*.glb`, `*.step`, `*.kitpack` and `uploads/`; do not work around it. Always credit MakeGood. The maker guide PDF is not bundled: link it and refer to page numbers.
- **Printers are read-only.** The app reads printer status. The only command it ever sends is Elegoo SDCP Cmd 386 `{"Enable":1}` (camera on), through `sdcpEnvelope`. It never moves, heats, pauses, stops or starts a printer, and never sends a file. Do not add that.
- **Never re-orient parts in 3D.** Parts keep the face-down orientation from their source file. The plate arranger and the 3MF export may only rotate a part flat about the Z axis (0/90 degrees or a free in-plane angle). Never change which face is down, stand a part on an edge or tilt it; a part that does not fit flat is reported as oversize, with advice. See the header of `src/lib/domain/arrange.ts`.
- **No personal data in fixtures, seeds or tests:** no real build progress, recipient or hospital names, user slicer files, IP addresses, domains, emails or access codes. Tests that need a real 3MF skip when the file is absent. Use example values (`tmt.example.com`, `192.168.1.x`).
- **A single `docker run` with an empty `/data` must keep working:** migrations and seeding run on startup and are idempotent.
- **A template is not a design is not a build.** A template is a printable kit with generic filament roles; a color design maps roles to filaments; a build belongs to a team, snapshots a design and holds all progress. Never put one user's colors or progress into a template.

## Setup

Requires **Node 22** (`.nvmrc` has `22`; with nvm run `nvm use`). The Docker image and CI use Node 22, and `better-sqlite3` is built for it.

```bash
git clone https://github.com/ayostepht/TMT-Build-Tracker.git
cd TMT-Build-Tracker
cp .env.example .env     # the dev server runs without a real BETTER_AUTH_SECRET
npm ci
npm run dev              # http://localhost:5173
```

`.npmrc` sets `legacy-peer-deps=true`; a plain `npm install` needs it. Keep `package-lock.json` as the repo's npm produced it: do not commit a lock file rewritten by a different npm major version. With npm 11 or newer, install scripts may be blocked: `npm install-scripts approve esbuild`.

## Commands and definition of done

```bash
npm run check        # svelte-check / types
npm run lint         # prettier --check . && eslint .
npm test             # vitest (one file: npx vitest run <file>)
npm run build
npm run test:e2e     # Playwright, see below
npm run format       # prettier --write .
```

A change is done when `check`, `lint`, `test` and `build` pass, the end-to-end specs that cover what you touched pass, and, if you changed anything that happens at startup (migrations, seeding, the Dockerfile, the kit pack), `docker build -t tmt-build-tracker:dev .` plus a container started on an empty data directory works (`/api/health` answers, sign-up works, the kit pack installs). CI runs check, lint, unit tests, a route-folder guard and the end-to-end suite on every pull request; do not weaken or skip a gate.

### End-to-end tests

Playwright (Chromium) builds the app and runs it against a temporary SQLite file:

```bash
npx playwright install chromium   # once
npm run test:e2e -- e2e/<spec>.spec.ts --reporter=line
```

Use `--reporter=line` (the html reporter waits for you on a failure). Specs share one database and one server per run: a spec that changes template-level data restores it in `afterAll`, and every spec must pass alone and in the full suite. Run one e2e run at a time on a machine (port 4173 and `build/` are shared). To run them in the matching container, the image tag must equal the `@playwright/test` version in `package.json`:

```bash
docker run --rm -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v<version>-noble \
  npx -y -p node@22 sh -c 'npm run test:e2e -- --reporter=line'
```

## Conventions you need

- **Stack:** SvelteKit (Svelte 5, TypeScript, `adapter-node`), SQLite via `better-sqlite3` and Drizzle, Better Auth (email/password, organization plugin, optional OIDC), three.js, fflate and fast-xml-parser for 3MF, Server-Sent Events, Vitest and Playwright. The code map is in [docs/architecture.md](docs/architecture.md).
- **Imports:** there is no `$lib` alias. Import through the package.json subpath imports with explicit extensions (`#lib/server/db/index.ts`). Route ids include the `(app)` group: `resolve('/(app)/builds/[id]')`.
- **Layering:** state rules live in `src/lib/domain/actions.ts` only, and `src/lib/domain/` has no database, Svelte or Node imports. Every build mutation goes through `mutateBuild` in `src/lib/server/builds/actions.ts`: it writes an `activity` row and emits an SSE event, and a new activity kind needs a sentence in the activity formatter. Client fetches go through `src/lib/client/api.ts`.
- **Permissions are checked on the server** for every mutation (owner, editor, viewer; `src/lib/server/access.ts`). Hiding a button is not access control.
- **Database changes:** edit `src/lib/server/db/app.schema.ts` (or `auth.schema.ts`), run `npm run db:generate` and commit the new files in `drizzle/` with the code that uses them. Migrations are applied on start; `db:push` is never used. The server must start from the app root because migrations load from `./drizzle`.
- **Secrets** (printer access codes, OIDC secrets) stay out of logs and API responses; printer credentials are stored encrypted.
- **User interface:** mobile first (makers update status from a phone at the printer). Design tokens and the shared component classes are in `src/app.css` (Barlow Condensed, IBM Plex Sans, IBM Plex Mono; light and dark through `prefers-color-scheme` and `data-theme`). Actions are buttons (`.btn`, `.btn.primary`, `.btn.go`, `.btn.ghost`) or clickable badges; text links only inside sentences. Form fields are 16 px on touch devices (iOS zooms on focus otherwise). Check layout changes at 390 px wide (phone) and at desktop widths in light and dark.
- **Formatting:** Prettier and ESLint decide; `npm run format` fixes the rest. Markdown is checked by `npm run lint` too.
- **Filament data:** from [SpoolmanDB](https://github.com/Donkie/SpoolmanDB) (MIT, see [THIRD_PARTY.md](THIRD_PARTY.md)); refresh with `npm run filaments:update`.

## Pull requests

Describe what changed and why, and say which checks you ran. Keep a pull request to one subject, include tests for behaviour changes, and update the docs (README, `docs/guides/`, `docs/architecture.md`) when what a user or contributor sees changes. By contributing you agree your work is released under the project's [MIT license](LICENSE).

Security problems are not reported as issues or pull requests: see [SECURITY.md](SECURITY.md).
