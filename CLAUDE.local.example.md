# CLAUDE.local.md (template)

Copy to `CLAUDE.local.md` (gitignored) and fill in for this machine. Only private values
and machine facts go here; rules and workflow live in `CLAUDE.md` and
`docs/dev/dev-environments.md`. The maintainer keeps the canonical copy outside git: ask for
it instead of guessing.

## This machine

- Machine: <Mac | Unraid dev container | ...>
- Repo path: <...> (Unraid: also the host path, `<HOST_REPO>`)
- Commit identity: <GITHUB_USER> <<COMMIT_EMAIL>>
- E2E lock available: yes/no. Docker: yes/no. Deploys from here: yes/no.

## Network

- Unraid LAN IP: <LAN_IP> · Tailscale IP: <TAILSCALE_IP>

## Test copy (Unraid)

- URLs: http://<LAN_IP>:8420, http://<TAILSCALE_IP>:8420
- Container `tmt-build-tracker`, image `tmt-build-tracker:test`; latest deploy: <rNN = commit>
- Data dir: <host path> (`secret.env` holds `BETTER_AUTH_SECRET`, root-only; never print it)
- MakeGood files: <host path> (mounted read-only at `/makegood`)
- Pre-reset archive: <path>

## Exact deploy commands (Unraid)

<backup one-liner, docker run flags, health check URL>

## Real-file tests

- `<HOST_REPO>`, `<MAKEGOOD_FILES>`, `TMT_SLICED_3MF=<file>`, `TMT_XPA_3MF=<file>`
- `TMT_REAL_ELEGOO=<PRINTER_IP>`

## Printer (never commit)

- Elegoo Centauri Carbon: <PRINTER_IP>, SDCP port 3030, camera `http://<PRINTER_IP>:3031/video`;
  keep-out: filament cutter x 246..256, y 0..20

## Secrets (locations only, never values)

- GitHub token: <where>; Anthropic key: <where>; Claude login: <where>

## Other

- Scratch awaiting the maintainer's OK to delete: <paths>
