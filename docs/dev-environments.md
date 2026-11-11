# Development environments

Work happens on more than one machine. This file holds everything about them that is safe
to commit. Private values (IPs, URLs, tokens, printer address, exact host paths) live in
each machine's untracked `CLAUDE.local.md`, whose shape is `CLAUDE.local.example.md`.

## Machines

| Machine                                        | Used for                                      | Repo                                         | Tooling                                                                                 |
| ---------------------------------------------- | --------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Maintainer's Mac                               | Local Claude Code sessions (VS Code)          | `~/Documents/Github Repos/TMT-Build-Tracker` | Native Node 22, `flock` from Homebrew                                                   |
| Unraid dev container (`claude-unraid-manager`) | Cloud sessions, image builds, **all deploys** | `/workspace/TMT-Build-Tracker`               | git only; Node, Playwright and buildx run in throwaway containers via the Docker socket |

Both push to the same GitHub repo. **At session start:** `git fetch`; if `main` and
`origin/main` differ, or you're on a branch, say so to the maintainer before working. **At
session end:** everything committed; push with the maintainer's OK so the other machine
picks up from `docs/STATUS.md`.

Commit identity on every machine: the GitHub noreply address in `CLAUDE.local.md`
(`git config user.email` per repo), never a personal email: the repo becomes public.

Claude Code project memory is per machine and per path, so it does not travel. Anything
durable belongs in this repo's docs, not in memory.

## New machine (or `CLAUDE.local.md` missing)

1. Node 22 (CI, the image and `better-sqlite3`'s build use 22; with several versions use
   `nvm install 22 && nvm use 22`), git, Docker if this machine builds images. `gh` is
   optional (kit pack releases were made through the GitHub REST API).
2. Clone; `npm ci` (`.npmrc` sets `legacy-peer-deps=true`); `npx playwright install
chromium`; `cp .env.example .env` for `npm run dev`. npm 11+ blocks install scripts by
   default: `npm install-scripts approve esbuild`, and don't commit a `package-lock.json`
   rewritten by a different npm.
3. E2E lock: Linux has `flock`; macOS: `brew install flock`.
4. `cp CLAUDE.local.example.md CLAUDE.local.md`; get the private values from the
   maintainer's canonical copy (kept outside git). Never guess them.
5. Real-file tests are optional (see below); without the files they skip.
6. Have the `verifier` agent run the gate once.

### Mac status (2026-11-10)

`node_modules` was installed with Node 24 / npm 11 (esbuild scripts not approved). To do:
Node 22 + `npm ci`, `brew install flock`, Playwright Chromium, `.env`. Delete this
subsection once done.

## Running tools on the Unraid dev container

The dev container has no Node. Run tooling in throwaway containers through the Docker
socket, mounting the repo by its **host** path (`/workspace` inside = the host path in
`CLAUDE.local.md`); inside them the repo is `/app`.

```bash
# check, lint, unit tests
docker run --rm -e NPM_CONFIG_UPDATE_NOTIFIER=false -v <HOST_REPO>:/app -w /app \
  node:22 sh -c 'npm run check && npm run lint && npx vitest run'

# e2e (one or more specs; drop the spec for the full ~6 min suite)
docker run --rm --name tmt-e2e -e NPM_CONFIG_UPDATE_NOTIFIER=false -v <HOST_REPO>:/app -w /app \
  mcr.microsoft.com/playwright:v1.64.0-noble \
  sh -c 'flock /app/node_modules/.e2e.lock npx -y -p node@22 sh -c "npm run test:e2e -- e2e/palettes.spec.ts --reporter=line"'

# image build (host Docker has no buildx; the Dockerfile needs BuildKit)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v <HOST_REPO>:/src -w /src \
  docker:28-cli docker buildx build --load -q -t tmt-build-tracker:<tag> .
```

- The Playwright image tag must equal the installed `@playwright/test` version; its Node is
  newer than 22, hence `npx -p node@22`.
- Image builds need **every** kit pack listed in `kitpacks/index.json` present in
  `kitpacks/` (gitignored; also on the GitHub releases `kitpack-makegood-tmt-revb-*`).
- Agent dev servers: ports 5173-5199, containers named `tmt-*`, always `--rm`. Never touch
  the test copy container `tmt-build-tracker`, other containers, or `docker prune`.
- The server's own `/workspace/CLAUDE.md` safety rules and the `claude-guard` hook apply.

## Running e2e (all machines)

- From the repo root, always `--reporter=line` (the html reporter hangs on failure).
- One e2e run at a time per machine (shared port 4173, `build/`, `data/e2e`). Take the lock
  on `node_modules/.e2e.lock` in the repo: on the Mac
  `flock node_modules/.e2e.lock npx playwright test e2e/<spec>.spec.ts --reporter=line`;
  on Unraid as above. Without `flock`, the orchestrator must not run two e2e-running agents
  at once.
- Full suite only when asked or before a release.

## Real-file tests (optional, skip when unset)

| Variable                                          | Used by                               | Points at                                                             |
| ------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `KITPACK_DIR`                                     | `sliced.real`, `arrange-margins.real` | the repo's `kitpacks/`                                                |
| `TMT_SLICED_3MF`                                  | `sliced.real`, `gcode-stats.real`     | the maintainer's sliced 24-plate project in the MakeGood files folder |
| `TMT_XPA_3MF`                                     | `print-geometry/groups.real`          | the X/P/A profile 3MF                                                 |
| `TMT_PACK_DIR`, `TMT_GROUPS_DB`, `TMT_GROUPS_OUT` | `builds/groups.real`                  | kit pack dir, scratch DB, output                                      |
| `TMT_MG_DB`, `TMT_MG_DEBUG`                       | `arrange-margins.real`                | scratch DB                                                            |
| `TMT_SLICED_DB`                                   | `sliced.real`                         | scratch DB                                                            |
| `TMT_REAL_ELEGOO` (+ `TMT_REAL_OUT`)              | `camera.real-enable`                  | the printer's host (read-only probe; only when the brief says so)     |

On Unraid, mount the MakeGood files folder read-only into the node container
(`-v <MAKEGOOD_FILES>:/makegood:ro`). Paths are in `CLAUDE.local.md`. MakeGood files,
the sliced project and kit packs are not in git.

## Test copy: deploy, rehearsal, rollback

Only the orchestrator, only from the Unraid dev container, only with the maintainer's OK.
The exact commands (container name, ports, mounts, env file) are in the Unraid
`CLAUDE.local.md`.

1. `verifier` gate green on the commit; commit with the STATUS/CHANGELOG update.
2. Build the image as `tmt-build-tracker:rNN` (above). Old `rNN` tags are kept for rollback.
3. **Rehearse** when schema, seed or startup change: copy the latest backup into a
   `migrate-rehearsal/rNN/` folder in the test copy's data dir, start a throwaway
   container `tmt-rehearsal-rNN` from the new image on it, wait for `/api/health`, read
   the logs, compare row counts with the live DB, stop and remove it.
4. **Back up** the live DB with better-sqlite3 `.backup()` inside the running container to
   `tmt-backup-pre-rNN.db` in its data dir (about 4 MB each; prune old ones with the
   maintainer's OK).
5. **Swap:** stop and remove the container, tag `:rNN` as `:test`, `docker run` it with
   the same flags; poll `/api/health` until 200 (2 s interval, 60 s max).
6. **Rollback:** stop and remove, tag the previous `:rNN` as `:test`, run again. If a
   migration ran, first restore `tmt-backup-pre-rNN.db` over `tmt.db` while stopped, and
   move aside any `tmt.db-wal` / `tmt.db-shm`.
7. Add the deploy to `docs/CHANGELOG.md` as `rNN`; tell the maintainer what to check on
   their phone.

Recurring maintainer steps: print geometry on the test copy is imported with
`scripts/import-print-geometry.mjs` in this order: H profile, bucket seat, harness zip,
the maintainer's re-targeted X/P/A project last. Real-iPhone checks. Approving deletion of
agent scratch in `data/` (agents can't `rm`).
