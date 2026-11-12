# Install on Unraid

Tested with the Docker tab of Unraid 7. Allow about 0.5 GB of disk for the image and about 150 MB in appdata (the installed kit pack: 3D model and print geometry). Memory use is small (about 250 MB at rest); a site admin who imports STEP files peaks near 650 MB for a minute or two, and an admin print-geometry import near 500 MB.

The image is `ghcr.io/ayostepht/tmt-build-tracker`. The image is public: Unraid pulls it without a login. It is published for x86-64 and arm64; only x86-64 has been run by the project.

## 1. Prepare the appdata folder

The container runs as the unprivileged user `99:100` (Unraid's `nobody:users`) and cannot write to a folder owned by root, which is what Docker creates if the folder does not exist. In the Unraid terminal:

```bash
mkdir -p /mnt/user/appdata/tmt-build-tracker
chown 99:100 /mnt/user/appdata/tmt-build-tracker
```

Without this the container stops at start with `SqliteError: unable to open database file`.

## 2. Generate the secret

In the Unraid terminal:

```bash
openssl rand -hex 32
```

Copy the 64 characters; they go into `BETTER_AUTH_SECRET` below. Store a copy somewhere safe (a password manager). The secret signs sessions and encrypts printer access codes, so if you change or lose it everyone is signed out and saved printer access codes must be entered again. Your builds and accounts are not affected.

## 3. Add the container

### Option A: with the template (recommended)

Copy the template onto the flash drive, from the Unraid terminal:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-tmt-build-tracker.xml \
  https://raw.githubusercontent.com/ayostepht/TMT-Build-Tracker/main/unraid/tmt-build-tracker.xml
```

(Or copy the contents of `unraid/tmt-build-tracker.xml` into a file of that name yourself.) The template icon is loaded from GitHub.

Then:

1. Open the **Docker** tab, press **Add Container**.
2. Choose **tmt-build-tracker** in the **Template** dropdown (under "User templates").
3. Fill in `BETTER_AUTH_SECRET` (step 2). Check **WebUI port** (default `8420`, any free port) and **Data** (default `/mnt/user/appdata/tmt-build-tracker`). Everything else is optional; see the table below.
4. Press **Apply**. Unraid pulls the image and starts the container.

### Option B: manual

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

Add the `OIDC_*` variables only if you use single sign-on (see [Single sign-on](sso.md)). Press **Apply**.

## Settings in the template

| Setting                                               | Required | Default                               | Meaning                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebUI port (container `3000`)                         | yes      | host `8420`                           | The container always listens on 3000. The host port is only a suggestion (3000 is often taken on Unraid).                                                                                                     |
| Data (`/data`)                                        | yes      | `/mnt/user/appdata/tmt-build-tracker` | SQLite database `tmt.db` (plus `-wal` and `-shm` files), `uploads/` (installed kit pack, 3D models, imported print geometry, 3MF and photo uploads). Must be owned by `99:100`.                               |
| `BETTER_AUTH_SECRET`                                  | yes      | none                                  | The app refuses to start without it. See step 2.                                                                                                                                                              |
| `PUBLIC_URL`                                          | no       | empty                                 | Empty: any address works, for example `http://<server-ip>:8420`. Set to `https://tmt.example.com` (no trailing slash) behind an https reverse proxy; required for SSO. See [Reverse proxy](reverse-proxy.md). |
| `ADMIN_EMAILS`                                        | no       | empty                                 | Comma-separated emails that are site admins as well as the first account.                                                                                                                                     |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | no       | empty                                 | All three enable SSO. The secret is masked.                                                                                                                                                                   |
| `OIDC_PROVIDER_NAME`                                  | no       | `SSO`                                 | Button label: "Sign in with NAME".                                                                                                                                                                            |
| `MAX_3MF_MB` (advanced)                               | no       | `1024` (`256` in public mode)         | Largest slicer 3MF the Files tab accepts.                                                                                                                                                                     |
| `TMT_PRINTERS` (advanced)                             | no       | on                                    | `off` disables the background printer connections.                                                                                                                                                            |
| `KITPACK_DOWNLOAD` (advanced)                         | no       | on                                    | `off` never downloads a kit pack (the one inside the image is used regardless).                                                                                                                               |

Empty optional variables are harmless: they behave as if unset. The template has no `TZ` setting because the app does not read one. Not set by the template either, because the image already has them: `DATABASE_URL=/data/tmt.db`, `PORT=3000`, `HOST=0.0.0.0`, `BODY_SIZE_LIMIT=1100M`, `KITPACK_DIR=/app/kitpacks`. For every other variable see the [environment reference](environment.md).

## 4. First start

1. In the Docker tab the container should show as **started**, and after about 20 seconds **healthy**. If it does not start, open its **Logs** (the container's menu, or `docker logs tmt-build-tracker`).
2. In the log you should see `[tmt] seeded templates: makegood-tmt-revb`, `Listening on http://0.0.0.0:3000`, and within a few seconds `[tmt] kit pack: makegood-tmt-revb 1.0.1: model installed, 40 print geometry row(s)...`. A Better Auth warning "Base URL is not set" is normal while `PUBLIC_URL` is empty.
3. Click the container icon and choose **WebUI** (or open `http://<unraid-ip>:8420`). On the sign-in page choose **Create one** (next to "No account?") and create your account. **The first account created on the install is the site admin** (kit admin pages at `/admin/templates`). More admins can be named in `ADMIN_EMAILS` (match is case-insensitive; the variable is read at start, so restart the container after changing it).
4. The MakeGood kit (model, print geometry, credit) is already installed; nothing to upload. To see it, press **New build** on the page you land on, then **Create build**: a five-step setup opens and the 3D chair appears at the Colors step.

Sign-up is open: anyone who can reach the web page can create an account, and the app does not send email. Keep the port on your LAN, or put it behind a proxy with access control, rather than forwarding it straight to the internet. Builds belong to a person's own workspace or to a chapter, and chapter invitations are copyable `/invite/<id>` links (no email is sent).

## 5. Printers on your network

Bridge networking can reach printers on your LAN by IP address (the app only makes outgoing connections; it reads status and never sends control commands). Add printers on the **Integrations** page (**Add a printer**) by IP address. The Elegoo "find printers" button uses a UDP broadcast, which does not cross Docker's bridge: it finds nothing in bridge mode. Either add the printer by its IP address, or give the container an address on the LAN (Network Type `Custom: br0`, or `Host`). With `Host` the container uses the server's ports directly: add a variable `PORT` with a free port such as `8420` and open `http://<unraid-ip>:8420`. On `br0` the Unraid server itself cannot reach the container unless "Host access to custom networks" is enabled in Docker settings. Per-brand details: [Printers](printers.md).

## Updating

With the `latest` tag (always the newest release): Docker tab, **Check for Updates**, then **apply update** next to the container (or the container menu, **Force update**). Unraid pulls the new image and recreates the container with your settings. Database migrations run automatically at start and are not reversible, so take a backup first (below). If the update ends in an `unauthorized` error see [Image access](../../README.md#image-access). The CA Auto Update Applications plugin can update it on a schedule. To stay on a fixed version change the Repository to a release tag such as `ghcr.io/ayostepht/tmt-build-tracker:0.9.0`. The `edge` tag is the current `main` branch for testing unreleased changes: it can break, take a backup first, and do not expect to move back to an older release without restoring it if a migration ran. The general upgrade routine is in [Backup and upgrade](backup-and-upgrade.md).

## Backups

Everything that matters is in the Data folder (`/mnt/user/appdata/tmt-build-tracker`).

- **Appdata Backup plugin:** the folder is included when `/mnt/user/appdata` is in the plugin's source. Leave the container's stop-during-backup option on so the database file is not copied while it is written.
- **By hand:** stop the container, copy the whole folder (database `tmt.db` and `uploads/`), start the container.
- **Without stopping,** a consistent copy of the database only, from the Unraid terminal:

  ```bash
  docker exec tmt-build-tracker node -e "const D=require('better-sqlite3');new D('/data/tmt.db',{readonly:true}).backup('/data/tmt-backup.db').then(()=>console.log('backup ok'))"
  ```

  The copy `tmt-backup.db` appears in the Data folder; move it elsewhere. (It does not include `uploads/`.)

To restore, stop the container, put the folder contents (owned by `99:100`) back and start it.

## Uninstall

Docker tab, container menu, **Remove** (tick "also remove image" if you like). This leaves your data in `/mnt/user/appdata/tmt-build-tracker`, so reinstalling later picks up where you left off. To delete all data, delete that folder yourself. The template file in `/boot/config/plugins/dockerMan/templates-user/my-tmt-build-tracker.xml` stays until you delete it.

## Problems

See [Troubleshooting](troubleshooting.md).
