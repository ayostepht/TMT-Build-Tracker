# Password reset (self-hosted)

TMT Build Tracker never sends email. If someone forgets their password, whoever runs the
server creates a one-time reset link on the command line and passes it on.

- Applies to accounts that sign in with email and password.
- Accounts that sign in with SSO (OIDC) are not affected: the command refuses them and says
  so. Public mode has no passwords at all, so the command refuses there too.

## Create a link

From the app folder (plain Node; it needs the same environment as the server, at least
`BETTER_AUTH_SECRET`, plus `DATABASE_URL` if the database is not `./data/tmt.db`):

```bash
npm run build   # once, if you have not built yet
node scripts/reset-password-link.mjs maker@example.com --url http://192.168.1.10:3000
```

With Docker:

```bash
docker exec <container> node scripts/reset-password-link.mjs maker@example.com --url https://tmt.example.com
```

`--url` is the address people open the app at (an origin only: scheme, host, port; no
path). It can be left out when `PUBLIC_URL` is set. The command prints only the link and
its expiry:

```
https://tmt.example.com/reset-password#token=...
Expires 2026-11-11T14:00:00.000Z (one hour). Works once.
```

Send the link to the person privately. A wrong address or an SSO-only account prints one
line starting with `Error:` and exits non-zero.

## What happens

- Creating the link signs that account out everywhere right away.
- The link works once and expires after one hour. Creating a new link removes older ones.
- The person opens the link, chooses a new password (at least 8 characters) and is sent to
  the sign-in page. Finishing also signs every session out again.
- The token is in the part of the address after `#`, so it is not sent to the server in the
  request; the page removes it from the address bar as soon as it loads.
- If the link is expired, already used or wrong, the page tells the person to ask for a new
  one.

## Keep it tidy

The link is a password for an hour. It appears in your terminal scrollback and in
`docker exec` output: clear the terminal afterwards (`clear`, or close the window). The
command never writes the link to a log or the database in readable form beyond the one-time
token row, which is deleted when used or replaced.
