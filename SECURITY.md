# Security policy

## Supported versions

Only the latest release receives security fixes. Before reporting, check that the problem is still present in the latest release (or, until the first release, on the `main` branch).

## Reporting a vulnerability

Please report privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability** (GitHub's private vulnerability reporting). Do not open a public issue or pull request for a security problem.

Include what you found, the steps to reproduce it, the version or commit, and how you run the app (Docker or Unraid, with or without a reverse proxy, `PUBLIC_URL` set or not, self-host or public mode). Never include real secrets, access codes or other people's data in a report.

This is a volunteer project: expect an acknowledgement within a few days and a fix or a decision as soon as the maintainer can manage. Please give a reasonable time to fix a problem before you publish it.

## What is in scope

- Sign-in, sessions, accounts, teams (chapters), invitations and the roles owner, editor and viewer: getting access you should not have, acting as someone else, changing another team's data.
- The HTTP API and uploads: missing permission checks, path traversal, unsafe file handling, request smuggling or limits that can be bypassed to exhaust the server.
- Printer, camera and Spoolman connections: reaching addresses the app should refuse (outbound connections are limited to private addresses, plus OctoEverywhere shared-link hosts for Elegoo, Klipper and OctoPrint printers), leaking printer access codes, API keys or shared links, or making the app send printer commands (it only reads status; the single exception is Elegoo's camera-on command).
- The Docker image and its startup: secrets or personal data in the image, unsafe defaults.

## Out of scope and known gaps

These are documented limits, not new findings:

- **Open sign-up.** By default anyone who can reach the web page can create an account (`SIGNUP=open`). Use `SIGNUP=invite` or `SIGNUP=closed` and keep the port off the internet, or behind a proxy with access control.
- **`X-Forwarded-For` can be spoofed without a proxy.** The sign-in rate limit uses the client address. Without `ADDRESS_HEADER` it uses the socket address; with `ADDRESS_HEADER` set, a client that can reach the container port directly can choose its own address. Set it only when all traffic comes through proxies you control (see [docs/guides/reverse-proxy.md](docs/guides/reverse-proxy.md)).
- **Email addresses are unverified on self-hosted installs.** No email is sent, so whoever first registers an address listed in `ADMIN_EMAILS`, or an address that has been invited, gets that admin role or that invitation. Keep sign-up at `invite` or `closed`, or register those addresses yourself first.
- **Printer and link peers can still cost some resources.** OctoEverywhere link connections validate the link name (every answer must be a public address) and then dial that exact address (the connection is pinned, with the certificate checked for the link name), and a printer or link peer cannot make the server read a message larger than 1 MiB: bigger messages, binary messages and compressed frames close the connection, and the printer then shows an error and is retried slowly. A hostile link can still cost a few MiB of memory and some CPU per connection, bounded by per-connection message and byte budgets and a reconnect backoff of at least 10 s.
- **The same OctoEverywhere link can be added in more than one workspace** on a hosted site. The number of link printers is bounded by the site-wide cap (`QUOTA_LINK_PRINTERS_TOTAL`).
- **Rate limits are kept in memory per process.** They reset when the server restarts, and are not shared between several instances.
- A site admin, and anyone who may add a printer, can make the server connect to services on its own private network (loopback is allowed on purpose, because some setups run Spoolman or OctoPrint on the same host).
- Problems that need access to the host, the data folder or the `BETTER_AUTH_SECRET`, an outdated or modified install, or a browser or proxy you configured without the documented headers.
- Denial of service by an authenticated user within the limits you configured (self-hosted installs have no quotas unless you set them; see [docs/guides/environment.md](docs/guides/environment.md)).
- Reports from automated scanners without a demonstrated impact.

## Hardening checklist for operators

Set a strong `BETTER_AUTH_SECRET` and keep it private; serve over https with `PUBLIC_URL` set; use `SIGNUP=invite` or `closed` when the install is reachable from the internet or when you use single sign-on; keep the container port private and set `ADDRESS_HEADER` only behind your own proxy; back up the data folder; update to the latest release.
