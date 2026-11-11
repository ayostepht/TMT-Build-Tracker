# CLAUDE.local.md (template)

Copy to `CLAUDE.local.md` (gitignored) and fill in for this machine. Never commit the
filled copy. The maintainer keeps the canonical private values outside the repo; ask for
them instead of guessing. See `docs/dev-environments.md`.

## This machine

- Machine: <Mac | Unraid dev container | ...>
- Repo path: <...>
- E2E lock: `flock node_modules/.e2e.lock` (installed: yes/no)
- Docker available: yes/no. Can deploy from here: yes/no.

## Test copy

- URL: <TEST_COPY_URL>
- Container name / template: <...>
- Data (appdata) path: <...>
- Backup location: <...>

## Deploy routine (exact commands)

1. <build>
2. <backup>
3. <swap container>
4. <health check>
5. <rollback if needed>

## Migration rehearsal

- Copy of test data: <path>; command: <...>

## Real-file tests

- `KITPACK_DIR=<path>`
- `TMT_SLICED_3MF=<path to the maintainer's sliced project>`
- `TMT_REAL_ELEGOO=<printer host>` (opt-in, read-only probe)

## Printer (never commit these)

- Elegoo Centauri Carbon: host <PRINTER_IP>, camera `http://<PRINTER_IP>:3031/video`

## Other

- GitHub/GHCR access: <gh auth status, token scopes>
- Notes:
