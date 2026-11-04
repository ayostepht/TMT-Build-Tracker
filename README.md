# TMT Build Tracker

A self-hostable web app for makers 3D-printing MakeGood 3D TMT (toddler mobility trainer) chairs. It tracks parts, print plates, filament, and print runs for each build, with accounts, chapters (teams) and roles.

> **Status:** Milestone 1 (scaffold). Sign-in, database, migrations and the TMT template seed are in place. The build screens arrive in later milestones.

## MakeGood files and credit

The MakeGood 3D TMT 3D model and print files are by MakeGood, released as Creative Commons Public Domain (CC0); bundled as a kit pack. The maker guide is not included: get it from MakeGood.

The git repository itself contains only data about the kit (part names, settings, plate groupings). The converted 3D model and print geometry ship separately as a versioned **kit pack** (a GitHub release asset, about 30 MB), which the Docker image downloads at build time and installs into your `/data` volume on first start, so the standard kit works with nothing to upload. See [docs/kit-pack.md](docs/kit-pack.md) for the format, the environment variables (`KITPACK_DIR`, `KITPACK_URL`, `KITPACK_DOWNLOAD=off`) and how a maintainer builds a pack. Files you import yourself in the kit admin always win over the pack.

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

| Variable                                              | Description                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                        | SQLite file path. Default `/data/tmt.db` in production, `./data/tmt.db` in dev.                                                                                                      |
| `BETTER_AUTH_SECRET`                                  | Required in production. Generate with `openssl rand -base64 32`.                                                                                                                     |
| `PUBLIC_URL`                                          | Optional public URL (no trailing slash). See below. `BETTER_AUTH_URL` and `ORIGIN` still work.                                                                                       |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Optional OpenID Connect login (for example Authentik). All three enable the SSO button.                                                                                              |
| `OIDC_PROVIDER_NAME`                                  | Label for the SSO button. Default `SSO`.                                                                                                                                             |
| `ADMIN_EMAILS`                                        | Optional comma-separated emails that are site admins (kit and 3D model management), besides the first user.                                                                          |
| `PORT`, `HOST`                                        | Listen port and address. Default `3000` and `0.0.0.0` in the image.                                                                                                                  |
| `BODY_SIZE_LIMIT`                                     | Largest request body adapter-node accepts. The image sets `200M` for STEP zip uploads (see 3D model).                                                                                |
| `MAX_3MF_MB`                                          | Largest slicer 3MF the Plates tab accepts (default `200`); it is streamed to disk, parsed and deleted. Needs `BODY_SIZE_LIMIT` at least as large.                                    |
| `KITPACK_DIR`, `KITPACK_URL`, `KITPACK_DOWNLOAD`      | Kit pack location (default `/app/kitpacks` in the image), download URL pattern (`{slug}` `{version}` `{file}`) and `KITPACK_DOWNLOAD=off` to never download. See `docs/kit-pack.md`. |

For OIDC, register the redirect URI `<PUBLIC_URL>/api/auth/callback/oidc` with your provider.

### Running behind a reverse proxy

Out of the box the app accepts the address a request arrives on, so `http://<server-ip>:3000` works directly and so does an https reverse proxy (Nginx Proxy Manager, Traefik, Caddy) as long as it forwards the `Host` and `X-Forwarded-Proto` headers. NPM does this by default. Live updates use Server-Sent Events, so do not buffer responses on the proxy.

- **`PUBLIC_URL` unset (default):** the scheme comes from `X-Forwarded-Proto` (`http` if absent) and the host from `X-Forwarded-Host` or `Host`. Cross-site form posts are still rejected, because the browser's `Origin` must match. Sign-in cookies are not marked `Secure`, since the app cannot know in advance whether you will use https. OIDC sign-in needs `PUBLIC_URL`.
- **`PUBLIC_URL=https://tmt.example.com`:** that origin is used for every request regardless of headers, cookies are `Secure`, and OIDC redirect URIs are built from it. Opening the app through any other address (for example the LAN IP) then fails form posts and sign-in by design; pick one address.

Do not expose the container port directly to the internet when `PUBLIC_URL` is unset; put it behind the proxy.

## 3D model (site admin)

The kit admin (`/admin/templates`, visible to the first user and to `ADMIN_EMAILS`) builds the
chair's 3D model from **your own copy** of MakeGood's STEP files, if you want to replace the bundled kit pack (the standard kit needs no upload). The bundled files are in the image (kit pack, see above); imports stay in the `/data` volume.

1. Open **Kit admin**, pick the kit, choose MakeGood's STEP zip (up to 200 MB) and press **Import
   the model**. A background job converts the files in a separate process (heap capped at 768 MB,
   one job at a time) and reports per file: converted, missing, failed or skipped (the assembly and
   the `OBSOLETE/` folder are never converted). It takes about a minute for the whole kit.
2. **Placement**: the viewer lists every part; pick one and nudge it (position in mm, rotation in
   degrees, mirror, extra copies such as the 4 rim halves or 16 tire segments). **Save** stores the
   numbers; the model itself is never reconverted.
3. **Hardware (optional)**: casters, bolts and bearings come from the assembly STEP, which needs
   about 1.4 GB of memory, so convert it once on a machine with enough RAM and upload the GLB:

   ```bash
   npm ci
   node --max-old-space-size=4096 scripts/step-to-glb.mjs "TMT 3D TOP ASSEMBLY.step" hardware.glb
   # see which products are in the assembly / pick them yourself:
   node scripts/step-to-glb.mjs "TMT 3D TOP ASSEMBLY.step" --list
   node scripts/step-to-glb.mjs "TMT 3D TOP ASSEMBLY.step" hardware.glb --include 'caster|bearing' --exclude 'wheel'
   ```

   then upload `hardware.glb` in the kit admin (or `curl -X POST -H 'content-type: model/gltf-binary'
--data-binary @hardware.glb -b <session cookie> <url>/api/templates/<id>/model/hardware`).

Uploads are sent as the raw file body (not multipart), so the server streams them to disk instead of
holding 200 MB in memory. adapter-node rejects request bodies over `BODY_SIZE_LIMIT` (default 512 kB),
so the image sets `BODY_SIZE_LIMIT=200M`; if you run it another way, set that variable (it applies to
every route, each of which has its own smaller limit where it matters). A reverse proxy needs the
same: in Nginx Proxy Manager add `client_max_body_size 200m;` under Advanced.

Developing without the zip: `node scripts/dev-register-model.mjs <db file> <template slug> <model.glb>`
copies a GLB you built earlier into the data directory next to the database and registers it.

## Export for your slicer (3MF)

The **Plates** tab has an **Export for your slicer** card. It builds a 3MF from the build's arranged plates and filaments, so after you change colors and re-arrange, the next download has the new groups.

- **Elegoo Slicer / OrcaSlicer** and **Bambu Studio**: one project file with every plate (or the plates you tick), one object per part, the filament slot of each part's color, MakeGood's per-part settings (walls, infill, supports, brim) and the printer's bed. Plates sit in the slicer's shared build volume at its own grid offsets (see `src/lib/server/threemf-export/plate-grid.ts`).
- **Other slicer**: a plain 3MF per plate (a zip when you export several); the filament is part of each object's name, and PrusaSlicer also gets the extruder per object.
- Needs a printer on the build and the print geometry imported by a site admin (kit admin page, or the CLI below). Parts without imported geometry are left out and listed in the card and in `Metadata/tmt_export_notes.txt`.
- API: `GET /api/builds/<id>/export.3mf?flavor=orca|bambu|plain&plates=1,2` and `GET /api/builds/<id>/export/preview` (JSON summary). Any team member, viewers included. The file is streamed, never held in memory.

If the build's plates are not arranged for its printer, or colors changed since, the export arranges in memory (nothing is saved) and says so.

## Importing print geometry without the browser

For the 88 MB MakeGood profile, the CLI runs the same import as the kit admin page, inside the container:

```bash
docker cp profile.3mf <container>:/tmp/profile.3mf
docker exec <container> node scripts/import-print-geometry.mjs --list
docker exec <container> node scripts/import-print-geometry.mjs \
  --db /data/tmt.db --template makegood-tmt-revb --file /tmp/profile.3mf [--file /tmp/harness.zip]
```

`--file` may be repeated and may be a zip of 3MFs. `--init` migrates and seeds a brand new (scratch) database first.

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
