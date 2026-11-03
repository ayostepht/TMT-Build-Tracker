# TMT Build Tracker

A self-hostable web app for makers 3D-printing MakeGood 3D TMT (toddler mobility trainer) chairs. It tracks parts, print plates, filament, and print runs for each build, with accounts, chapters (teams) and roles.

> **Status:** Milestone 1 (scaffold). Sign-in, database, migrations and the TMT template seed are in place. The build screens arrive in later milestones.

## MakeGood files are not included

This repository contains only data about the kit (part names, settings, plate groupings). It does **not** contain any MakeGood 3D models, 3MF/STEP files, guide pages or images. Each install imports those files itself from MakeGood / MakerWorld, and uploads stay in your own `/data` volume.

## Self-hosting with Docker

```bash
cp docker-compose.example.yml docker-compose.yml
# edit BETTER_AUTH_SECRET (and PUBLIC_URL if you serve it over https)
docker compose up -d
```

The image is `ghcr.io/ayostepht/tmt-build-tracker`. The SQLite database lives in `/data` (mount a volume there). Migrations and template seeding run automatically at start. The health check is `GET /api/health`.

### Unraid

Add a container with repository `ghcr.io/ayostepht/tmt-build-tracker:latest`, port `3000`, a path mapping from `/mnt/user/appdata/tmt-build-tracker` to `/data`, and the variables below. Opening `http://<unraid-ip>:3000` works without further settings; see "Running behind a reverse proxy" for https.

## Environment variables

| Variable                                              | Description                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | SQLite file path. Default `/data/tmt.db` in production, `./data/tmt.db` in dev.                             |
| `BETTER_AUTH_SECRET`                                  | Required in production. Generate with `openssl rand -base64 32`.                                            |
| `PUBLIC_URL`                                          | Optional public URL (no trailing slash). See below. `BETTER_AUTH_URL` and `ORIGIN` still work.              |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Optional OpenID Connect login (for example Authentik). All three enable the SSO button.                     |
| `OIDC_PROVIDER_NAME`                                  | Label for the SSO button. Default `SSO`.                                                                    |
| `ADMIN_EMAILS`                                        | Optional comma-separated emails that are site admins (kit and 3D model management), besides the first user. |
| `PORT`, `HOST`                                        | Listen port and address. Default `3000` and `0.0.0.0` in the image.                                         |

For OIDC, register the redirect URI `<PUBLIC_URL>/api/auth/callback/oidc` with your provider.

### Running behind a reverse proxy

Out of the box the app accepts the address a request arrives on, so `http://<server-ip>:3000` works directly and so does an https reverse proxy (Nginx Proxy Manager, Traefik, Caddy) as long as it forwards the `Host` and `X-Forwarded-Proto` headers. NPM does this by default. Live updates use Server-Sent Events, so do not buffer responses on the proxy.

- **`PUBLIC_URL` unset (default):** the scheme comes from `X-Forwarded-Proto` (`http` if absent) and the host from `X-Forwarded-Host` or `Host`. Cross-site form posts are still rejected, because the browser's `Origin` must match. Sign-in cookies are not marked `Secure`, since the app cannot know in advance whether you will use https. OIDC sign-in needs `PUBLIC_URL`.
- **`PUBLIC_URL=https://tmt.example.com`:** that origin is used for every request regardless of headers, cookies are `Secure`, and OIDC redirect URIs are built from it. Opening the app through any other address (for example the LAN IP) then fails form posts and sign-in by design; pick one address.

Do not expose the container port directly to the internet when `PUBLIC_URL` is unset; put it behind the proxy.

## Importing from the original prototype

If you tracked a build in the original single-page prototype, you can bring its progress over (part statuses, print logs, slicer weights, spool counts). Export the prototype's saved data (ask Claude to export it, or copy the artifact database) into a folder laid out as `parts/<part-id>.json`, `plates/<number>.json` and `settings/filament.json`, then bundle it into one file:

```bash
node scripts/bundle-prototype-export.mjs ./my-export ./export.json
```

Then either open the build's **Settings** tab and use **Import from the original prototype** (it shows a preview and any warnings first; a build that already has progress needs "Replace existing progress"), or run the importer inside the container (`--dry-run` only prints what would happen):

```bash
docker cp export.json <container>:/tmp/export.json
docker exec <container> node --import ./scripts/proxy-origin.mjs scripts/import-prototype.mjs --list
docker exec <container> node --import ./scripts/proxy-origin.mjs scripts/import-prototype.mjs \
  --db /data/tmt.db --file /tmp/export.json --build <build-id> --dry-run
```

Use `--new "Name" --workspace <id-or-slug> --design <design-slug>` instead of `--build` to create the build too, and `--replace` to overwrite existing progress. The web import is limited by the server's request size (`BODY_SIZE_LIMIT`, 512 kB by default, which is plenty for one build).

## Development

Requires Node 22.

```bash
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
npm run check        # types
npm run lint
npm test
npm run build
```

Browser tests (Playwright, Chromium) build the app and run it against a temporary SQLite file:

```bash
npx playwright install chromium   # once
npm run test:e2e
```

To run them in the matching container on a machine without a browser setup (the image tag must equal the `@playwright/test` version; its Node is newer than 22, so the command borrows Node 22 to match the installed `better-sqlite3` build):

```bash
docker run --rm -v "$PWD":/app -w /app mcr.microsoft.com/playwright:v1.64.0-noble \
  npx -y -p node@22 sh -c 'npm run test:e2e'
```

Database changes: edit `src/lib/server/db/app.schema.ts`, then `npm run db:generate` and commit the new files in `drizzle/`. Migrations are applied on start; `db:push` is not used.

Stack: SvelteKit (Svelte 5), SQLite via better-sqlite3 and Drizzle, Better Auth (email/password, organizations, optional OIDC).

## License

MIT, see [LICENSE](LICENSE).

### Filament data

Filament data from [SpoolmanDB](https://github.com/Donkie/SpoolmanDB), MIT licensed (see [THIRD_PARTY.md](THIRD_PARTY.md)). Refresh it with `npm run filaments:update` and commit the regenerated `src/lib/server/filaments/catalog.json`.
