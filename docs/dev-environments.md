# Development environments

Work happens on more than one machine. This file holds everything about them that is
safe to commit. Private values (IPs, domains, emails, tokens, printer access codes, the
exact deploy targets) live in each machine's untracked `CLAUDE.local.md`, whose shape is
`CLAUDE.local.example.md`.

## Machines

| Machine                  | Used for                                    | Repo path                                    | Notes                         |
| ------------------------ | ------------------------------------------- | -------------------------------------------- | ----------------------------- |
| Maintainer's Mac (macOS) | Local dev sessions (Claude Code in VS Code) | `~/Documents/Github Repos/TMT-Build-Tracker` | Setup in progress, see below  |
| Unraid dev container     | Cloud sessions, deploys to the test copy    | TO FILL (from cloud inventory)               | TO FILL: image, how it starts |

Both work on the same GitHub repo. **Before starting work on either machine:** `git fetch`
and make sure `main` has no unpushed commits on the other machine (ask the maintainer if
unsure). End every session with the work committed and pushed (with the maintainer's OK),
so the other machine can pick up from `docs/STATUS.md`.

## New machine (or `CLAUDE.local.md` missing)

1. Install Node 22 (CI and the Docker image use 22; `better-sqlite3` is built for it), git,
   `gh` (authenticated), Docker if this machine builds images. With several Node versions,
   use `nvm` or `fnm` (`nvm install 22 && nvm use 22`).
2. Clone the repo; `cp .env.example .env`; `npm ci` (`.npmrc` sets
   `legacy-peer-deps=true`); `npx playwright install chromium`. npm 11+ blocks install
   scripts by default: approve esbuild's with `npm install-scripts approve esbuild`, and
   don't commit a `package-lock.json` rewritten by a different npm.
3. Install the e2e lock tool: Linux has `flock`; macOS: `brew install flock`.
4. `cp CLAUDE.local.example.md CLAUDE.local.md` and fill it in. The private values are not
   in git: ask the maintainer for their canonical copy (kept outside the repo) rather than
   guessing. Fill only what this machine needs.
5. Optional real-file tests: get the kit pack and the maintainer's sliced 3MF and set
   `KITPACK_DIR` / `TMT_SLICED_3MF` (paths in `CLAUDE.local.md`). Without them those tests
   skip, which is fine.
6. Run `npm run check && npm run lint && npm test` once (or have the `verifier` agent do it).

### Mac status (2026-11-10)

`node_modules` installed with Node 24 / npm 11 (esbuild install scripts not yet approved).
Still to do: switch to Node 22 and re-run `npm ci`, `brew install flock`, Playwright
Chromium, `.env`, `CLAUDE.local.md`. Remove this subsection once done.

## Running e2e (all machines)

- Always from the repo root, always `--reporter=line`.
- Parallel agents share one e2e port and build dir, so every run takes the same lock:

  ```bash
  flock node_modules/.e2e.lock npx playwright test e2e/<spec>.spec.ts --reporter=line
  ```

  (In the Unraid container the repo root is `/app`, so this is the same file as the older
  `/app/node_modules/.e2e.lock`.) If `flock` is unavailable, the orchestrator must not run
  two e2e-running agents at the same time.

- Full suite: ~6 min; run it only when asked or before a release.
- Without a local browser setup, use the Playwright container (see README, Development).

## Deploying to the test copy

Only the orchestrator deploys, only with the maintainer's OK. Outline (specifics and
commands in `CLAUDE.local.md` on the machine that deploys):

1. `verifier` gate green on the commit being deployed.
2. Schema, seed or startup changes: rehearse the migration on a copy of the test data
   (never the live database) first.
3. Back up the test copy's data.
4. Build and swap the container; check `/api/health` and the change itself.
5. Record the deploy as the next `rN` in `docs/CHANGELOG.md` and update `docs/STATUS.md`.
6. Short summary to the maintainer, including what they should check on their phone.

TO FILL (from cloud inventory): which machine deploys, and whether the Mac can deploy.
