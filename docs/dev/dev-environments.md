# Development environments

Work happens on more than one machine. This file holds everything about them that is safe
to commit. Private values (IPs, URLs, tokens, printer address, exact host paths) live in
each machine's untracked `CLAUDE.local.md`, whose shape is `CLAUDE.local.example.md`.

## Machines

| Machine                                        | Used for                                      | Repo                                         | Tooling                                                                                 |
| ---------------------------------------------- | --------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Maintainer's Mac                               | Local Claude Code sessions (VS Code)          | `~/Documents/Github Repos/TMT-Build-Tracker` | Native Node 22, `flock` from Homebrew                                                   |
| Unraid dev container (`claude-unraid-manager`) | Cloud sessions, image builds, **all deploys** | `/workspace/TMT-Build-Tracker`               | git only; Node, Playwright and buildx run in throwaway containers via the Docker socket |

Both push to the same GitHub repo. **At session start:** `git fetch`; if `edge`/`main`
differ from `origin/edge`/`origin/main`, or you're on a branch, say so to the maintainer before working. **At
session end:** everything committed; push with the maintainer's OK so the other machine
picks up from `docs/dev/STATUS.md`.

Commit identity on every machine: the GitHub noreply address in `CLAUDE.local.md`
(`git config user.name`/`user.email`, global or per repo), never a personal email: the repo becomes public.

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

## Running tools on the Unraid dev container

The dev container has no Node. Run tooling in throwaway containers through the Docker
socket, mounting the repo by its **host** path; inside them the repo is `/app`.

- `<HOST_REPO>`: look it up (read-only) with
  `docker inspect "$(hostname)" --format '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}'`
  and append `/TMT-Build-Tracker`.
- `<MAKEGOOD_FILES>`: only for real-file tests; the orchestrator puts the path (from
  `CLAUDE.local.md`) in the brief.

```bash
# check, lint, unit tests
docker run --rm -e NPM_CONFIG_UPDATE_NOTIFIER=false -v <HOST_REPO>:/app -w /app \
  node:22 sh -c 'npm run check && npm run lint && npx vitest run'

# e2e (one or more specs; drop the spec for the full ~6 min suite)
docker run --rm --name tmt-e2e -e NPM_CONFIG_UPDATE_NOTIFIER=false -v <HOST_REPO>:/app -w /app \
  mcr.microsoft.com/playwright:v1.65.0-noble \
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
3. **Back up** the live DB with better-sqlite3 `.backup()` inside the running container to
   `tmt-backup-pre-rNN.db` in its data dir (about 4 MB each; prune old ones with the
   maintainer's OK).
4. **Rehearse** when schema, seed or startup change, on the backup you just made: copy it
   into a `migrate-rehearsal/rNN/` folder in the test copy's data dir, start a throwaway
   container `tmt-rehearsal-rNN` from the new image on it, wait for `/api/health`, read
   the logs, compare row counts with the live DB, stop and remove it. Problems → stop,
   don't swap.
5. **Swap:** stop and remove the container, tag `:rNN` as `:test`, `docker run` it with
   the same flags; poll `/api/health` until 200 (2 s interval, 60 s max).
6. **Rollback:** stop and remove, tag the previous `:rNN` as `:test`, run again. If a
   migration ran, first restore `tmt-backup-pre-rNN.db` over `tmt.db` while stopped, and
   move aside any `tmt.db-wal` / `tmt.db-shm`.
7. Add the deploy to `docs/dev/CHANGELOG.md` as `rNN`; tell the maintainer what to check on
   their phone.

Recurring maintainer steps: print geometry on the test copy is imported with
`scripts/import-print-geometry.mjs` in this order: H profile, bucket seat, harness zip,
the maintainer's re-targeted X/P/A project last. Real-iPhone checks. Approving deletion of
agent scratch in `data/` (agents can't `rm`).

## Local preview with sample data

For reviewing changes on the Mac and a phone before anything goes to the Unraid test copy.
Review only: invented data, a throwaway secret, never real data or real printers.

```bash
npm run preview:demo                 # keep the preview data, seed only if it is empty
npm run preview:demo -- --fresh      # wipe data/preview/data and reseed
npm run preview:demo -- --port 5300  # another port (default 5200)
npm run preview:demo -- --no-build   # serve the earlier build copy, skip the build
```

- Needs Node 22 first on PATH. The build runs under `/opt/homebrew/bin/flock node_modules/.e2e.lock`
  when flock exists (it waits while Playwright runs; without flock it builds unlocked and says so).
  The build is copied to `data/preview/build`, so later builds and e2e runs do not disturb it.
- Serves on `0.0.0.0:5200` (`TMT_MODE=selfhost`, no `PUBLIC_URL`, sign-up open), so plain http works
  from a phone on the same Wi-Fi. The summary prints the local URL, the LAN URL (found at run time),
  the sign-in (`demo.owner@example.com`, second member `demo.editor@example.com`, both with the password
  printed in the summary) and what was seeded. It stays in the foreground; Ctrl+C stops the server
  and the simulated printer. Port taken: it stops with a message.
- Data lives only in `data/preview/data/` (gitignored); `--fresh` wipes only that folder. An existing
  demo account means no seeding; the simulated printer is pointed at the new mock and its running print
  is linked to the same plate again.
- Seeded through the app's HTTP API (`scripts/preview/seed.mjs`): a chapter with an editor member, a
  personal workspace, "Demo chair A" (colors, spool counts, plates arranged for the Elegoo Centauri
  Carbon, about a third of the parts Printed with logged runs, one failed run so Reprint shows, one
  plate Printing, a generated photo, a saved design), "Demo chair B" (fresh, in the setup wizard), a Studio
  draft, and "Demo printer": the repo's `MockSdcp` on 127.0.0.1 (port+1) with one older unlinked job
  and one running job linked to build A's Printing plate.
- Kit pack: the pack listed in `kitpacks/index.json` is fetched once with `gh release download`
  (sha256 and size checked) into `data/preview/kitpacks/`. Without `gh` access the preview still runs, prints
  that the 3D model and plate geometry are missing, and wants the `.kitpack` file copied into that folder
  (then restart). Nothing fetched can be committed (`data/`, `*.kitpack` are gitignored).

## Cloud sessions (claude.ai/code)

A cloud session runs in a fresh Linux container: Node 22 native, no Docker, no
`CLAUDE.local.md` (no private values, no deploys). The maintainer's personal cloud
environment "TMT-Build-Tracker" allows the Playwright download hosts and its setup script
runs `npm ci && npx playwright install chromium` in the checkout (browsers land in
`/opt/pw-browsers`), so `check`, unit tests and e2e run as on the Mac; CI runs them again on
the pull request. The setup script runs only when a fresh container is built. The local
preview is not available to the maintainer from a cloud session: they review user-visible
changes on the `edge` image on Unraid once the pull request is merged into the `edge`
branch (maintainer, 2026-11-13), instead of `npm run preview:demo` before the merge.

**Docker in a cloud session** (verified 2026-11-13). The container has Docker, buildx and
compose but the daemon is not running: start it with `dockerd` as a background process
(log to the scratchpad) and wait for `docker info`. Pulls from Docker Hub work. Build
containers cannot reach the session's HTTPS proxy and don't trust its CA, so build the repo
Dockerfile unchanged on a local helper base image:

1. Kit pack: download the file listed in `kitpacks/index.json` from its GitHub release
   (`https://github.com/<owner>/TMT-Build-Tracker/releases/download/kitpack-<slug>-<version>/<file>`)
   into `kitpacks/` and check its sha256 and size against the index.
2. Helper base (scratch dir, never committed or pushed): `FROM node:22-bookworm-slim`; copy
   `/root/.ccr/ca-bundle.crt` in as `/usr/local/share/ca-certificates/ccr.crt` and
   `/etc/ssl/certs/ca-certificates.crt`; switch `/etc/apt/sources.list.d/debian.sources` to
   `https://deb.debian.org`; `/etc/apt/apt.conf.d/99proxy` with `Acquire::https::Proxy` set to
   `$HTTPS_PROXY` (its port changes per session) and `Acquire::https::CaInfo`; `ENV` for
   `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `npm_config_cafile`, `SSL_CERT_FILE`. Rebuild it in
   every new session: a helper with an earlier session's proxy port fails at the Dockerfile's
   `apt-get` step with exit 100 (seen 2026-11-13). Check first with
   `docker run --rm --network host tmt-cloud-base:node22 apt-get update`. Build it with
   `docker build --network host -t tmt-cloud-base:node22 <dir>`.
3. `docker buildx build --network host --build-context
node:22-bookworm-slim=docker-image://tmt-cloud-base:node22 --load -t
tmt-build-tracker:cloudcheck .` (about 1.5 min warm).
4. Empty-data check: a fresh data dir owned by 1000:1000, `docker run -d --rm --name
tmt-cloudcheck -p 5198:3000 -v <dir>:/data -e BETTER_AUTH_SECRET=$(openssl rand -hex 32)
tmt-build-tracker:cloudcheck`, poll `/api/health`, read the log (seeded templates, kit pack
   installed a few seconds later), stop, start again on the same dir.

The resulting image carries the proxy settings: it is for local checks only, never pushed.
The environment must allow `deb.debian.org` (it does). Leave `dockerd` running for the
session; containers are named `tmt-*` and started with `--rm`.

## Deploying published images (from 0.9, public repo)

Once the repository is public, the test copy runs the image CI published, not a local
build: after a pull request is merged into `edge`, wait for the `image` job on `edge`, then
deploy `ghcr.io/<owner>/tmt-build-tracker:sha-<short>` of that commit (or `edge`). `main`
is updated only by promotion: Actions → "Promote edge to main" (`.github/workflows/promote.yml`)
builds `promote/<short>` from `main` with `edge`'s tree minus `.github/main-exclude.txt`, opens
a pull request into `main` and dispatches `docker.yml` on it (`test` + `e2e`, no image); merge
it with a merge commit (keeps the `Promoted-From:` trailer), then tag a release on `main` if
wanted. A push to `main` publishes `sha-<short>` only. Hotfixes also go through `edge`. First
promotion: check that the dispatched checks satisfy `main`'s required checks; if not, re-run
them from the pull request and note it here. Backup,
rehearsal on a copy and the swap are unchanged (above); replace the local `docker build`
and `docker tag` steps with `docker pull` of that tag and tag it `test` as before. Keep
the previous image for rollback. A release (`vX.Y.Z`, the maintainer's call) is deployed
the same way from its version tag. Local image builds remain for checking a Dockerfile
change before it is merged.

## Worktrees (parallel agents)

Agents sharing one checkout have collided (builds over each other's output, a formatter
run over a whole folder, `git stash`). When more than one agent will edit code at the same
time, give each task its own worktree: one task = one branch = one worktree = one pull
request.

- Create it beside the repo: `git worktree add ../TMT-wt-<task> -b <branch> origin/edge`.
- Dependencies: a worktree has no `node_modules`. Install once per worktree with `npm ci`
  before its agent starts (one install at a time across the machine). A symlinked
  `node_modules` is enough for vitest, eslint and a dev server, but **not** for
  `npm run check`: `tsconfig.json` extends `$app/tsconfig`, which resolves through the
  symlink to the other checkout's `.svelte-kit` and gives hundreds of false `./$types`
  errors (seen 2026-11-13). Gate a worktree only with its own `npm ci`.
- E2E: each worktree has its own `node_modules/.e2e.lock`, so use one machine-wide lock
  file for Playwright and builds while several worktrees are active (for example
  `flock /tmp/tmt-e2e.lock`), and give each worktree its own port from 5173-5199 if the
  Playwright config allows it; otherwise run e2e one worktree at a time under that lock.
- The preview (`npm run preview:demo`) builds the checkout it is started from: start it
  from the worktree under review.
- Remove the worktree after its pull request is merged or closed:
  `git worktree remove ../TMT-wt-<task>` (deleting a worktree with unmerged work needs the
  maintainer's OK).
- Status: agreed with the maintainer on 2026-11-12, to be trialled on one task before it
  becomes the rule; record what did not work here.
