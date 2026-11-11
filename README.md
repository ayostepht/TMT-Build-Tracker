# TMT Build Tracker

A self-hostable web app for makers 3D-printing MakeGood 3D TMT (toddler mobility trainer) chairs. Teams ("chapters") plan, print, assemble and hand off builds together: parts and print plates, filament colors, print logs, a 3D color designer, 3MF export for your slicer, and optional read-only printer status. It has accounts, chapters and roles.

> **Status:** pre-release. All features are built and running on a test copy; the public release (public repository and container package) is still to come. Until then see "Image access" below.

## MakeGood files and credit

The MakeGood 3D TMT 3D model and print files are by MakeGood, released as Creative Commons Public Domain (CC0); bundled as a kit pack. The maker guide is not included: get it from MakeGood.

The git repository itself contains only data about the kit (part names, settings, plate groupings). The converted 3D model and print geometry ship separately as a versioned **kit pack** (a GitHub release asset, about 30 MB), which the Docker image downloads at build time and installs into your `/data` volume on first start, so the standard kit works with nothing to upload. See [docs/kit-pack.md](docs/kit-pack.md) for the format, the environment variables (`KITPACK_DIR`, `KITPACK_URL`, `KITPACK_DOWNLOAD=off`) and how a maintainer builds a pack. Files you import yourself in the kit admin always win over the pack.

## Install

- **Unraid:** follow [Install on Unraid](#install-on-unraid) below.
- **Docker Compose or plain Docker:** see [Self-hosting with Docker](#self-hosting-with-docker).

The image is `ghcr.io/ayostepht/tmt-build-tracker`. Tags: `latest` (the main branch), `1.2.3` and `1.2` (release tags `v1.2.3`), and `sha-<short commit>`.

### Image access

While the repository is private, the container package is private too and pulling it fails with `unauthorized` or `denied`. Pick one:

- **Make the package public** (once the project is released): on GitHub open your profile or organization, **Packages**, **tmt-build-tracker**, **Package settings**, **Danger Zone**, **Change visibility**, **Public**. Nothing else is needed on the server.
- **Log in to ghcr.io on the server:** create a GitHub **classic** personal access token with only the `read:packages` scope (GitHub does not accept fine-grained tokens for container packages), then in the Unraid terminal run `docker login ghcr.io -u <your GitHub user>` and paste the token at the password prompt. On Unraid the login is stored under `/root`, which lives in RAM, so **it is gone after a reboot**; repeat it before updating the container after a restart.

## Install on Unraid

Tested with the Docker tab of Unraid 7. Allow about 0.5 GB of disk for the image and about 150 MB in appdata (the installed kit pack: 3D model and print geometry). Memory use is small (about 250 MB at rest); a site admin who imports STEP files peaks near 650 MB for a minute or two, and an admin print-geometry import near 500 MB.

### 1. Prepare the appdata folder

The container runs as the unprivileged user `99:100` (Unraid's `nobody:users`) and cannot write to a folder owned by root, which is what Docker creates if the folder does not exist. In the Unraid terminal:

```bash
mkdir -p /mnt/user/appdata/tmt-build-tracker
chown 99:100 /mnt/user/appdata/tmt-build-tracker
```

Without this the container stops at start with `SqliteError: unable to open database file`.

### 2. Generate the secret

In the Unraid terminal:

```bash
openssl rand -hex 32
```

Copy the 64 characters; they go into `BETTER_AUTH_SECRET` below. Store a copy somewhere safe (a password manager). The secret signs sessions and encrypts printer access codes, so if you change or lose it everyone is signed out and saved printer access codes must be entered again. Your builds and accounts are not affected.

### 3. Add the container

#### Option A: with the template (recommended)

Copy the template onto the flash drive, from the Unraid terminal:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-tmt-build-tracker.xml \
  https://raw.githubusercontent.com/ayostepht/TMT-Build-Tracker/main/unraid/tmt-build-tracker.xml
```

While the repository is private `wget` gets a 404. Use a GitHub token that can read the repository (classic `repo` scope, or a fine-grained token with Contents: read) instead, and do not leave the token in a script:

```bash
curl -fL -H "Authorization: token <your token>" \
  -o /boot/config/plugins/dockerMan/templates-user/my-tmt-build-tracker.xml \
  https://raw.githubusercontent.com/ayostepht/TMT-Build-Tracker/main/unraid/tmt-build-tracker.xml
```

(Or copy the contents of `unraid/tmt-build-tracker.xml` into a file of that name yourself.) The template icon is loaded from GitHub, so it only shows once the repository is public.

Then:

1. Open the **Docker** tab, press **Add Container**.
2. Choose **tmt-build-tracker** in the **Template** dropdown (under "User templates").
3. Fill in `BETTER_AUTH_SECRET` (step 2). Check **WebUI port** (default `8420`, any free port) and **Data** (default `/mnt/user/appdata/tmt-build-tracker`). Everything else is optional; see the table below.
4. Press **Apply**. Unraid pulls the image and starts the container.

#### Option B: manual

In the Docker tab press **Add Container**, then **Toggle advanced view** (top right) and fill in exactly:

| Field            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Name             | `tmt-build-tracker`                                                                             |
| Repository       | `ghcr.io/ayostepht/tmt-build-tracker:latest`                                                    |
| Network Type     | `Bridge`                                                                                        |
| Console shell    | `sh`                                                                                            |
| Privileged       | Off                                                                                             |
| Extra Parameters | `--user 99:100`                                                                                 |
| WebUI            | `http://[IP]:[PORT:3000]/`                                                                      |
| Icon URL         | `https://raw.githubusercontent.com/ayostepht/TMT-Build-Tracker/main/unraid/icon.svg` (optional) |

Then **Add another Path, Port, Variable, Label or Device** for each of:

| Type     | Name                 | Container            | Host / value                                        |
| -------- | -------------------- | -------------------- | --------------------------------------------------- |
| Port     | WebUI port           | `3000` (TCP)         | `8420` (any free port)                              |
| Path     | Data                 | `/data` (Read/Write) | `/mnt/user/appdata/tmt-build-tracker`               |
| Variable | `BETTER_AUTH_SECRET` | `BETTER_AUTH_SECRET` | the output of `openssl rand -hex 32`                |
| Variable | `PUBLIC_URL`         | `PUBLIC_URL`         | optional, see [Settings](#settings-in-the-template) |
| Variable | `ADMIN_EMAILS`       | `ADMIN_EMAILS`       | optional                                            |

Add the `OIDC_*` variables only if you use single sign-on (see [Authentik](#single-sign-on-with-authentik)). Press **Apply**.

### Settings in the template

| Setting                                               | Required | Default                               | Meaning                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebUI port (container `3000`)                         | yes      | host `8420`                           | The container always listens on 3000. The host port is only a suggestion (3000 is often taken on Unraid).                                                                                                                                     |
| Data (`/data`)                                        | yes      | `/mnt/user/appdata/tmt-build-tracker` | SQLite database `tmt.db` (plus `-wal` and `-shm` files), `uploads/` (installed kit pack, 3D models, imported print geometry, 3MF and photo uploads). Must be owned by `99:100`.                                                               |
| `BETTER_AUTH_SECRET`                                  | yes      | none                                  | The app refuses to start without it. See step 2.                                                                                                                                                                                              |
| `PUBLIC_URL`                                          | no       | empty                                 | Empty: any address works, for example `http://<server-ip>:8420`. Set to `https://tmt.example.com` (no trailing slash) behind an https reverse proxy; required for SSO. See [Running behind a reverse proxy](#running-behind-a-reverse-proxy). |
| `ADMIN_EMAILS`                                        | no       | empty                                 | Comma-separated emails that are site admins as well as the first account.                                                                                                                                                                     |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | no       | empty                                 | All three enable SSO. The secret is masked.                                                                                                                                                                                                   |
| `OIDC_PROVIDER_NAME`                                  | no       | `SSO`                                 | Button label: "Sign in with NAME".                                                                                                                                                                                                            |
| `MAX_3MF_MB` (advanced)                               | no       | `1024`                                | Largest slicer 3MF the Files tab accepts.                                                                                                                                                                                                     |
| `TMT_PRINTERS` (advanced)                             | no       | on                                    | `off` disables the background printer connections.                                                                                                                                                                                            |
| `KITPACK_DOWNLOAD` (advanced)                         | no       | on                                    | `off` never downloads a kit pack (the one inside the image is used regardless).                                                                                                                                                               |

Empty optional variables are harmless: they behave as if unset. The template has no `TZ` setting because the app does not read one. Not set by the template either, because the image already has them: `DATABASE_URL=/data/tmt.db`, `PORT=3000`, `HOST=0.0.0.0`, `BODY_SIZE_LIMIT=1100M`, `KITPACK_DIR=/app/kitpacks`.

### 4. First start

1. In the Docker tab the container should show as **started**, and after about 20 seconds **healthy**. If it does not start, open its **Logs** (the container's menu, or `docker logs tmt-build-tracker`).
2. In the log you should see `[tmt] seeded templates: makegood-tmt-revb`, `Listening on http://0.0.0.0:3000`, and within a few seconds `[tmt] kit pack: makegood-tmt-revb 1.0.1: model installed, 40 print geometry row(s)...`. A Better Auth warning "Base URL is not set" is normal while `PUBLIC_URL` is empty.
3. Click the container icon and choose **WebUI** (or open `http://<unraid-ip>:8420`). Press **Sign up** and create your account. **The first account created on the install is the site admin** (kit admin pages at `/admin/templates`). More admins can be named in `ADMIN_EMAILS` (match is case-insensitive; the variable is read at start, so restart the container after changing it).
4. The MakeGood kit (model, print geometry, credit) is already installed; nothing to upload.

Sign-up is open: anyone who can reach the web page can create an account, and the app does not send email. Keep the port on your LAN, or put it behind a proxy with access control, rather than forwarding it straight to the internet. Builds belong to a person's own workspace or to a chapter, and chapter invitations are copyable `/invite/<id>` links (no email is sent).

### 5. Printers on your network

Bridge networking can reach printers on your LAN by IP address (the app only makes outgoing connections; it reads status and never sends control commands). Add printers on the **Printers** page by IP address. The Elegoo "find printers" button uses a UDP broadcast, which does not cross Docker's bridge: it finds nothing in bridge mode. Either add the printer by its IP address, or give the container an address on the LAN (Network Type `Custom: br0`, or `Host`). With `Host` the container uses the server's ports directly: add a variable `PORT` with a free port such as `8420` and open `http://<unraid-ip>:8420`. On `br0` the Unraid server itself cannot reach the container unless "Host access to custom networks" is enabled in Docker settings.

### Updating

With the `latest` tag: Docker tab, **Check for Updates**, then **apply update** next to the container (or the container menu, **Force update**). Unraid pulls the new image and recreates the container with your settings. Database migrations run automatically at start and are not reversible, so take a backup first (below). If the update ends in an `unauthorized` error see [Image access](#image-access). The CA Auto Update Applications plugin can update it on a schedule. To stay on a fixed version change the Repository to a release tag such as `ghcr.io/ayostepht/tmt-build-tracker:1.2.3`.

### Backups

Everything that matters is in the Data folder (`/mnt/user/appdata/tmt-build-tracker`).

- **Appdata Backup plugin:** the folder is included when `/mnt/user/appdata` is in the plugin's source. Leave the container's stop-during-backup option on so the database file is not copied while it is written.
- **By hand:** stop the container, copy the whole folder (database `tmt.db` and `uploads/`), start the container.
- **Without stopping,** a consistent copy of the database only, from the Unraid terminal:

  ```bash
  docker exec tmt-build-tracker node -e "const D=require('better-sqlite3');new D('/data/tmt.db',{readonly:true}).backup('/data/tmt-backup.db').then(()=>console.log('backup ok'))"
  ```

  The copy `tmt-backup.db` appears in the Data folder; move it elsewhere. (It does not include `uploads/`.)

To restore, stop the container, put the folder contents (owned by `99:100`) back and start it.

### Uninstall

Docker tab, container menu, **Remove** (tick "also remove image" if you like). This leaves your data in `/mnt/user/appdata/tmt-build-tracker`, so reinstalling later picks up where you left off. To delete all data, delete that folder yourself. The template file in `/boot/config/plugins/dockerMan/templates-user/my-tmt-build-tracker.xml` stays until you delete it.

## Self-hosting with Docker

```bash
cp docker-compose.example.yml docker-compose.yml
# edit BETTER_AUTH_SECRET (and PUBLIC_URL if you serve it over https)
docker compose up -d
```

The example file maps `./data` to `/data` and publishes port 3000. The container runs as the image's `node` user (uid 1000), so give the data folder to it first: `mkdir -p data && sudo chown 1000:1000 data` (on Unraid use `99:100` as above). The SQLite database lives in `/data`. Migrations and template seeding run automatically at start. The health check is `GET /api/health` (returns `{"ok":true}`).

## Environment variables

| Variable                                              | Description                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                  | Required in production, the app does not start without it. Generate with `openssl rand -hex 32`. Also derives the key that encrypts printer access codes: changing it makes them unreadable.                                                                                                              |
| `PUBLIC_URL`                                          | Optional public URL (no trailing slash). See below. `BETTER_AUTH_URL` and `ORIGIN` still work.                                                                                                                                                                                                            |
| `ADMIN_EMAILS`                                        | Optional comma-separated emails that are site admins (kit and 3D model management), besides the first user.                                                                                                                                                                                               |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Optional OpenID Connect login (for example Authentik). All three enable the SSO button. The app uses `<OIDC_ISSUER>/.well-known/openid-configuration` to find the endpoints.                                                                                                                              |
| `OIDC_PROVIDER_NAME`                                  | Label for the SSO button. Default `SSO`.                                                                                                                                                                                                                                                                  |
| `DATABASE_URL`                                        | SQLite file path. Default `/data/tmt.db` in production, `./data/tmt.db` in dev. Uploads and the installed kit pack live in an `uploads` folder next to it.                                                                                                                                                |
| `PORT`, `HOST`                                        | Listen port and address. Default `3000` and `0.0.0.0` in the image (the health check follows `PORT`).                                                                                                                                                                                                     |
| `BODY_SIZE_LIMIT`                                     | Largest request body adapter-node accepts. The image sets `1100M` (above `MAX_3MF_MB`, so sliced projects fit).                                                                                                                                                                                           |
| `MAX_3MF_MB`                                          | Largest 3MF in MB the Files tab and the kit drop zone accept (default `1024`; a project sliced with G-code for every plate is several hundred MB). It is streamed to disk, parsed (only the small `Metadata/` entries are read, never the G-code) and deleted. Needs `BODY_SIZE_LIMIT` at least as large. |
| `KITPACK_DIR`, `KITPACK_URL`, `KITPACK_DOWNLOAD`      | Kit pack location (default `/app/kitpacks` in the image), download URL pattern (`{slug}` `{version}` `{file}`) and `KITPACK_DOWNLOAD=off` to never download. See `docs/kit-pack.md`.                                                                                                                      |
| `TMT_PRINTERS`                                        | `off` disables the background printer status connections (default on).                                                                                                                                                                                                                                    |
| `TMT_ARRANGE_OPTIMIZE`                                | `off` makes the plate arranger use only its basic packer. A diagnostic switch for bug reports; leave unset.                                                                                                                                                                                               |

For OIDC, register the redirect URI `<PUBLIC_URL>/api/auth/callback/oidc` with your provider.

### Running behind a reverse proxy

Out of the box the app accepts the address a request arrives on, so `http://<server-ip>:3000` works directly and so does an https reverse proxy (Nginx Proxy Manager, Traefik, Caddy) as long as it forwards the `Host` and `X-Forwarded-Proto` headers. NPM does this by default. Live updates use Server-Sent Events, so do not buffer responses on the proxy.

- **`PUBLIC_URL` unset (default):** the scheme comes from `X-Forwarded-Proto` (`http` if absent) and the host from `X-Forwarded-Host` or `Host`. Cross-site form posts are still rejected, because the browser's `Origin` must match. Sign-in cookies are not marked `Secure`, since the app cannot know in advance whether you will use https. OIDC sign-in needs `PUBLIC_URL`.
- **`PUBLIC_URL=https://tmt.example.com`:** that origin is used for every request regardless of headers, cookies are `Secure`, and OIDC redirect URIs are built from it. Opening the app through any other address (for example the LAN IP) then fails form posts and sign-in by design; pick one address.

Do not expose the container port directly to the internet when `PUBLIC_URL` is unset; put it behind the proxy.

#### Nginx Proxy Manager

In NPM: **Hosts**, **Proxy Hosts**, **Add Proxy Host**.

1. **Details:** Domain Names `tmt.example.com`; Scheme `http`; Forward Hostname / IP: your Unraid IP (`<unraid-ip>`); Forward Port: the host port you chose (`8420`). Switch **Websockets Support** on (the app itself uses Server-Sent Events, not websockets, but it does no harm) and **Block Common Exploits** on. Leave **Cache Assets** off.
2. **SSL:** request a Let's Encrypt certificate (or pick your existing one), tick **Force SSL**; HTTP/2 is fine.
3. **Advanced**, custom Nginx configuration:

   ```nginx
   client_max_body_size 1100m;
   proxy_buffering off;
   proxy_read_timeout 1h;
   proxy_send_timeout 1h;
   ```

   `client_max_body_size` lets STEP zips, 3MF files and photos through (Nginx's own default is 1 MB); `proxy_buffering off` and the long timeouts keep the live-update stream (`/api/builds/<id>/events`, a keepalive every 25 s) flowing. Sliced 3MF projects with G-code can be several hundred MB; use a larger size if you raised `MAX_3MF_MB` above 1024.

4. Save. In the Docker tab edit the container, set `PUBLIC_URL` to `https://tmt.example.com` (no trailing slash), **Apply**. The container restarts and from now on only that address works for sign-in. Accounts you made over `http://<ip>:8420` keep working; you just sign in again through the https address.

If the NPM container and this one share a custom Docker network you can forward to the container name and port `3000` instead, but forwarding to the server IP and host port works in every setup.

### Single sign-on with Authentik

Needs `PUBLIC_URL` set to the https address (above): the redirect URI is built from it.

1. In Authentik: **Applications**, **Providers**, **Create**, **OAuth2/OpenID Provider**. Name `TMT Build Tracker`; Authorization flow of your choice (for example explicit consent); **Client type: Confidential**; **Redirect URIs/Origins (RegEx)**: `https://tmt.example.com/api/auth/callback/oidc` (escape the dots if your Authentik version treats it as a regular expression, or choose strict matching); signing key: your certificate (RS256); scopes: `openid`, `profile`, `email` (the default scope mappings). Save and note the **Client ID** and **Client Secret**.
2. **Applications**, **Create**: Name `TMT Build Tracker`, Slug `tmt`, Provider the one above. Optionally restrict who may use it with a policy or group binding.
3. The issuer is the **OpenID Configuration Issuer** on the provider's page, normally `https://auth.example.com/application/o/tmt/`. Check that `https://auth.example.com/application/o/tmt/.well-known/openid-configuration` opens in a browser.
4. In the container settings (Docker tab, Edit) set:
   - `OIDC_ISSUER` = `https://auth.example.com/application/o/tmt/`
   - `OIDC_CLIENT_ID` = the client ID
   - `OIDC_CLIENT_SECRET` = the client secret
   - `OIDC_PROVIDER_NAME` = `Authentik` (the button reads "Sign in with Authentik")
   - `PUBLIC_URL` = `https://tmt.example.com`

   **Apply**. The sign-in and sign-up pages now show the SSO button.

5. Users are created on their first SSO login (name and email come from Authentik) and get their own "My builds" workspace. Password sign-up stays available alongside SSO. The first account of the install is the site admin whichever way it signs in; list your Authentik email in `ADMIN_EMAILS` to make an SSO user an admin.

The container itself fetches the issuer's discovery document, so it must be able to resolve and reach `auth.example.com` from inside Docker (on a LAN this usually works through your router or AdGuard DNS rewrite). If the SSO button shows but sign-in fails, check the container log.

### Troubleshooting

| Symptom                                                                                | Cause and fix                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container stops at start, log says `unable to open database file`                      | The Data folder is not writable by `99:100`. Run `chown 99:100 /mnt/user/appdata/tmt-build-tracker` and start again.                                                                                                                                                                                                  |
| Container stops with `BETTER_AUTH_SECRET must be set in production`                    | The variable is empty. Set it (`openssl rand -hex 32`).                                                                                                                                                                                                                                                               |
| Pull fails with `unauthorized` / `denied`                                              | The package is private. See [Image access](#image-access).                                                                                                                                                                                                                                                            |
| Sign-in or any form fails with "Cross-site POST form submissions are forbidden" or 403 | You opened the app through an address that does not match `PUBLIC_URL` (the LAN IP while `PUBLIC_URL` is the https domain, or the reverse). Use the `PUBLIC_URL` address, or empty `PUBLIC_URL` to allow the plain IP. With a proxy and `PUBLIC_URL` empty, make sure the proxy sends `Host` and `X-Forwarded-Proto`. |
| Uploads (STEP zip, 3MF, photos) fail with 413 or a stalled upload through the proxy    | The proxy limits body size. Add `client_max_body_size 1100m;` (NPM, Advanced). The app itself accepts 3MF files up to 1024 MB (`MAX_3MF_MB`, `BODY_SIZE_LIMIT=1100M`) and STEP zips up to 200 MB.                                                                                                                     |
| Changes from other people appear only after a reload                                   | The proxy buffers the live-update stream. Add `proxy_buffering off;` and a long `proxy_read_timeout` (see above); on other proxies disable response buffering for `/api/builds/*/events`.                                                                                                                             |
| Printer shows offline or "find printers" finds nothing                                 | The container must reach the printer's IP on your LAN. Bridge mode does; broadcast discovery needs Host or `br0` networking (see "Printers on your network"). Check the printer's IP, access code and that LAN mode is on (Bambu).                                                                                    |
| The standard kit's 3D model or print files are missing                                 | Check the log for `[tmt] kit pack:` lines. The pack is inside the image and installs a few seconds after start; a failure is logged as `[tmt] kit pack: ...` and retried at the next start. If it needs a download (`KITPACK_URL`), the container needs internet access and `KITPACK_DOWNLOAD` must not be `off`.     |
| SSO button missing                                                                     | One of `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` is empty.                                                                                                                                                                                                                                                |
| Printer access codes ask to be entered again                                           | `BETTER_AUTH_SECRET` changed. Re-enter them.                                                                                                                                                                                                                                                                          |

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
3. **Hardware model (maintainers only)**: casters, bolts and bearings come from the assembly STEP,
   which needs about 1.4 GB of memory. The hardware GLB ships inside the kit pack and the app
   draws generic stand-ins (casters, harness, buckles) when none is present; it is not
   user-uploadable. To rebuild the pack's hardware GLB, convert it once on a machine with enough RAM:

   ```bash
   npm ci
   node --max-old-space-size=4096 scripts/step-to-glb.mjs "TMT 3D TOP ASSEMBLY.step" hardware.glb
   # see which products are in the assembly / pick them yourself:
   node scripts/step-to-glb.mjs "TMT 3D TOP ASSEMBLY.step" --list
   node scripts/step-to-glb.mjs "TMT 3D TOP ASSEMBLY.step" hardware.glb --include 'caster|bearing' --exclude 'wheel'
   ```

   then put `hardware.glb` into the kit pack (see `docs/kit-pack.md`). There is no upload route.

Uploads are sent as the raw file body (not multipart), so the server streams them to disk instead of
holding hundreds of MB in memory. adapter-node rejects request bodies over `BODY_SIZE_LIMIT` (default 512 kB),
so the image sets `BODY_SIZE_LIMIT=1100M`; if you run it another way, set that variable (it applies to
every route, each of which has its own smaller limit where it matters). A reverse proxy needs the
same: in Nginx Proxy Manager add `client_max_body_size 1100m;` under Advanced.

Developing without the zip: `node scripts/dev-register-model.mjs <db file> <template slug> <model.glb>`
copies a GLB you built earlier into the data directory next to the database and registers it.

## Export for your slicer (3MF)

The **Files** tab has an **Export for your slicer** card. It builds a 3MF from the build's arranged plates and filaments, so after you change colors and re-arrange, the next download has the new groups.

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
