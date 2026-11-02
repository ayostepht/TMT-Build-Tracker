# TMT Build Tracker

A self-hostable web app for makers 3D-printing MakeGood 3D TMT (toddler mobility trainer) chairs. It tracks parts, print plates, filament, and print runs for each build, with accounts, chapters (teams) and roles.

> **Status:** Milestone 1 (scaffold). Sign-in, database, migrations and the TMT template seed are in place. The build screens arrive in later milestones.

## MakeGood files are not included

This repository contains only data about the kit (part names, settings, plate groupings). It does **not** contain any MakeGood 3D models, 3MF/STEP files, guide pages or images. Each install imports those files itself from MakeGood / MakerWorld, and uploads stay in your own `/data` volume.

## Self-hosting with Docker

```bash
cp docker-compose.example.yml docker-compose.yml
# edit ORIGIN, BETTER_AUTH_URL and BETTER_AUTH_SECRET
docker compose up -d
```

The image is `ghcr.io/ayostepht/tmt-build-tracker`. The SQLite database lives in `/data` (mount a volume there). Migrations and template seeding run automatically at start. The health check is `GET /api/health`.

### Unraid

Add a container with repository `ghcr.io/ayostepht/tmt-build-tracker:latest`, port `3000`, a path mapping from `/mnt/user/appdata/tmt-build-tracker` to `/data`, and the variables below. When using a reverse proxy, set `ORIGIN` and `BETTER_AUTH_URL` to the public URL.

## Environment variables

| Variable                                              | Description                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | SQLite file path. Default `/data/tmt.db` in production, `./data/tmt.db` in dev.         |
| `BETTER_AUTH_SECRET`                                  | Required in production. Generate with `openssl rand -base64 32`.                        |
| `ORIGIN` / `BETTER_AUTH_URL`                          | Public URL of the app (no trailing slash).                                              |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Optional OpenID Connect login (for example Authentik). All three enable the SSO button. |
| `OIDC_PROVIDER_NAME`                                  | Label for the SSO button. Default `SSO`.                                                |
| `PORT`, `HOST`                                        | Listen port and address. Default `3000` and `0.0.0.0` in the image.                     |

For OIDC, register the redirect URI `<BETTER_AUTH_URL>/api/auth/callback/oidc` with your provider.

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

Database changes: edit `src/lib/server/db/app.schema.ts`, then `npm run db:generate` and commit the new files in `drizzle/`. Migrations are applied on start; `db:push` is not used.

Stack: SvelteKit (Svelte 5), SQLite via better-sqlite3 and Drizzle, Better Auth (email/password, organizations, optional OIDC).

## License

MIT, see [LICENSE](LICENSE).
