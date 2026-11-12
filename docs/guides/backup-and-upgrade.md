# Backup and upgrade

## What to back up

Everything that matters is in the data folder you mounted at `/data` (on Unraid `/mnt/user/appdata/tmt-build-tracker`, in the README quick start `./data`):

- `tmt.db` (plus `tmt.db-wal` and `tmt.db-shm` while the app runs): accounts, chapters, builds and progress. The path is `DATABASE_URL`, default `/data/tmt.db`.
- `uploads/`: the installed kit pack, 3D models, imported print geometry, 3MF and photo uploads.

Also keep a copy of `BETTER_AUTH_SECRET` (for example your `tmt.env` file or the Unraid template value). Without the same secret a restored install signs everyone out and saved printer access codes must be entered again; builds and accounts are fine.

## Backing up

- **Stop, copy, start (safest):** stop the container, copy the whole data folder, start the container.
- **Without stopping,** a consistent copy of the database only (it does not include `uploads/`):

  ```bash
  docker exec tmt-build-tracker node -e "const D=require('better-sqlite3');new D('/data/tmt.db',{readonly:true}).backup('/data/tmt-backup.db').then(()=>console.log('backup ok'))"
  ```

  The copy `tmt-backup.db` appears in the data folder; move it elsewhere. Do not copy `tmt.db` alone with `cp` while the app is running: the `-wal` file holds recent changes.

- **Unraid:** the Appdata Backup plugin works too, see the [Unraid guide](unraid.md#backups).

Keep at least one backup off the machine itself.

## Restoring

Stop the container, put the data folder contents back (the container user must own them: `1000:1000` for the quick start, `99:100` on Unraid), and start the container. Start it with the same `BETTER_AUTH_SECRET`. If you only have a database copy such as `tmt-backup.db`, put it in the data folder as `tmt.db` and remove any old `tmt.db-wal` and `tmt.db-shm` next to it. That restores the data but not your uploads (photos, imported models), so restore `uploads/` as well whenever you have it. If the standard kit's 3D model or print files are missing afterwards, see [Troubleshooting](troubleshooting.md). Restoring from a database copy alone has not been tried yet.

## Upgrading

1. Take a backup (above). Database migrations run automatically at start and are not reversible.
2. Pull the new image and recreate the container with the same data folder and settings:

   ```bash
   docker compose pull && docker compose up -d
   ```

   or, with plain `docker run`, `docker pull ghcr.io/ayostepht/tmt-build-tracker:latest`, then `docker stop tmt-build-tracker && docker rm tmt-build-tracker` and run your original `docker run` command again. The data stays in the folder you mounted.

3. Check `docker logs tmt-build-tracker` and open the app. Phones that installed the app show a small "A new version is available" message with a Reload button (https only, see [Install on your phone](phone-install.md)).

Tags: `latest` follows the main branch; `1.2.3` and `1.2` follow release tags `v1.2.3`. Pin a tag (for example `ghcr.io/ayostepht/tmt-build-tracker:1.2.3`) to upgrade only when you choose. To go back to an older image, restore the backup you took before the upgrade (a newer database may not work with an older image). On Unraid the steps are in the [Unraid guide](unraid.md#updating). If the pull fails with `unauthorized`, see [Image access](../../README.md#image-access).

## Forgotten passwords

The app sends no email, so there is no "forgot password" mail and no email verification. Whoever runs the server creates a one-time reset link on the command line and passes it on:

```bash
docker exec tmt-build-tracker node scripts/reset-password-link.mjs maker@example.com --url https://tmt.example.com
```

`--url` is the address people open the app at (an origin only); it can be left out when `PUBLIC_URL` is set. The link works once and expires after one hour; creating it signs that account out everywhere. Accounts that sign in with SSO are not affected (the command refuses them), and public mode has no passwords. Details: [docs/password-reset.md](../password-reset.md).
