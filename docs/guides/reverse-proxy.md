# Running behind a reverse proxy

You only need a proxy if you want an https address (`https://tmt.example.com`), for example to use the app from outside your home, to sign in with single sign-on, or so phones get the offline page and the update prompt (see [Install on your phone](phone-install.md)). On a LAN, `http://<server-ip>:3000` works without one.

The examples use `tmt.example.com` as your address and `192.168.1.20:8420` as the host and port the container is published on. Replace both.

> **Examples.** The Nginx Proxy Manager setup is the one the project runs. The Caddy and Traefik sections are minimal examples derived from how the app reads the request origin (see "How the app decides its address"); the project has not run them yet, so adapt them to your setup. Corrections are welcome.

## How the app decides its address

Out of the box the app accepts the address a request arrives on, so `http://<server-ip>:3000` works directly and so does an https reverse proxy (Nginx Proxy Manager, Traefik, Caddy) as long as it forwards the `Host` and `X-Forwarded-Proto` headers. NPM does this by default. Live updates use Server-Sent Events, so do not buffer responses on the proxy.

- **`PUBLIC_URL` unset (default):** the scheme comes from `X-Forwarded-Proto` (`http` if absent) and the host from `X-Forwarded-Host` or `Host`. Cross-site form posts are still rejected, because the browser's `Origin` must match. Sign-in cookies are not marked `Secure`, since the app cannot know in advance whether you will use https. OIDC sign-in needs `PUBLIC_URL`.
- **`PUBLIC_URL=https://tmt.example.com`:** that origin is used for every request regardless of headers, cookies are `Secure`, and OIDC redirect URIs are built from it. Opening the app through any other address (for example the LAN IP) then fails form posts and sign-in by design; pick one address.

`BETTER_AUTH_URL` and `ORIGIN` are accepted as older names for `PUBLIC_URL`. Do not expose the container port directly to the internet when `PUBLIC_URL` is unset; put it behind the proxy.

The app has to be started from its own folder with `node --import ./scripts/proxy-origin.mjs build` (the image already does this): that preload is what implements the rules above.

## What every proxy must do

1. Forward `Host` (or `X-Forwarded-Host`) and `X-Forwarded-Proto`.
2. Allow request bodies up to about 1100 MB. STEP zips, 3MF files and photos are uploaded as one request; Nginx's own default is 1 MB. The app caps each route itself (see the [environment reference](environment.md#upload-and-body-limits)).
3. Not buffer responses and not cut idle ones, so live updates flow. The live-update stream is `/api/builds/<id>/events` and sends a keepalive every 25 seconds.
4. Pass the client address in `X-Forwarded-For` and tell the app about it (see [Client address and rate limits](#client-address-and-rate-limits)).

## Nginx Proxy Manager

In NPM: **Hosts**, **Proxy Hosts**, **Add Proxy Host**.

1. **Details:** Domain Names `tmt.example.com`; Scheme `http`; Forward Hostname / IP: your server's IP (`192.168.1.20`); Forward Port: the host port you chose (`8420`). Switch **Websockets Support** on (the app itself uses Server-Sent Events, not websockets, but it does no harm) and **Block Common Exploits** on. Leave **Cache Assets** off.
2. **SSL:** request a Let's Encrypt certificate (or pick your existing one), tick **Force SSL**; HTTP/2 is fine.
3. **Advanced**, custom Nginx configuration:

   ```nginx
   client_max_body_size 1100m;
   proxy_buffering off;
   proxy_read_timeout 1h;
   proxy_send_timeout 1h;
   ```

   `client_max_body_size` lets STEP zips, 3MF files and photos through (Nginx's own default is 1 MB); `proxy_buffering off` and the long timeouts keep the live-update stream (`/api/builds/<id>/events`, a keepalive every 25 s) flowing. Sliced 3MF projects with G-code can be several hundred MB; use a larger size if you raised `MAX_3MF_MB` above 1024.

4. Save. Edit the container and set `PUBLIC_URL` to `https://tmt.example.com` (no trailing slash; on Unraid: Docker tab, Edit, **Apply**). The container restarts and from now on only that address works for sign-in. Accounts you made over `http://<ip>:8420` keep working; you just sign in again through the https address.

If the NPM container and this one share a custom Docker network you can forward to the container name and port `3000` instead, but forwarding to the server IP and host port works in every setup.

## Caddy

Caddy gets the certificate itself and should set `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For` on proxied requests by default (not yet confirmed; check that they arrive). A `Caddyfile` entry:

```caddyfile
tmt.example.com {
	request_body {
		max_size 1100MB
	}
	reverse_proxy 192.168.1.20:8420 {
		flush_interval -1
	}
}
```

- `max_size` matches the image's `BODY_SIZE_LIMIT=1100M`. Caddy does not limit request bodies unless told to, so this line is optional; it only keeps the limits consistent.
- `flush_interval -1` sends every chunk to the browser immediately, which the live-update stream needs.

Then set `PUBLIC_URL=https://tmt.example.com` on the container. If Caddy sits behind another proxy, it should not trust the incoming forwarding headers unless `trusted_proxies` is configured (not yet confirmed).

## Traefik

With the Docker provider, add labels to the container (in Compose) and keep the container off the published ports if only Traefik should reach it. The router and entry point names (`websecure`, `letsencrypt`) are whatever you called them in your Traefik setup:

```yaml
services:
  tmt-build-tracker:
    image: ghcr.io/ayostepht/tmt-build-tracker:latest
    volumes:
      - ./data:/data
    environment:
      BETTER_AUTH_SECRET: '<your secret>'
      PUBLIC_URL: https://tmt.example.com
      ADDRESS_HEADER: X-Forwarded-For
    labels:
      - traefik.enable=true
      - traefik.http.routers.tmt.rule=Host(`tmt.example.com`)
      - traefik.http.routers.tmt.entrypoints=websecure
      - traefik.http.routers.tmt.tls.certresolver=letsencrypt
      - traefik.http.services.tmt.loadbalancer.server.port=3000
```

Traefik should forward `Host` and set `X-Forwarded-Proto` and `X-Forwarded-For` by default and should not limit request body size unless you add a `buffering` middleware (not yet confirmed). The container must share a Docker network with Traefik. If large uploads are cut off after about a minute, check the `respondingTimeouts` of the entry point in your Traefik configuration (some Traefik versions default to a 60-second read timeout); raise `readTimeout` there.

`ADDRESS_HEADER` is set above only because Traefik is then the only way in. Remove that line if the container port is also reachable by other means (see the next section).

## Client address and rate limits

Better Auth rate-limits sign-in and sign-up (3 requests per 10 seconds per address). Behind a proxy every request seems to come from the proxy's own address, so everyone shares one limit and a few people can lock each other out. The log shows a one-time warning "A reverse proxy appears to be in front of this server".

Set `ADDRESS_HEADER=x-forwarded-for` (and `XFF_DEPTH` if more than one proxy is in front; default 1) **only when all traffic reaches the app through proxies you control that overwrite the header**. If a client can reach the container port directly, it can send any `X-Forwarded-For` it likes and pick its own address. That is a known gap, not something the app can fix alone: keep the port off the internet and off the LAN (publish it on `127.0.0.1` or a private Docker network). For a header other than `X-Forwarded-For` the value is used verbatim. When `ADDRESS_HEADER` is set but the header is missing (or `XFF_DEPTH` exceeds the chain), sign-in requests are refused with 400 and a line is logged. See the [environment reference](environment.md).

## Security headers and HSTS

Every response (pages, API, static files, error pages) carries `Content-Security-Policy` (or a frame lockdown), `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy`. `Strict-Transport-Security` (`max-age=15552000`, 180 days, without `includeSubDomains` or `preload`) is sent only when the request counts as https: with `PUBLIC_URL=https://...` always, otherwise only when your proxy sends `X-Forwarded-Proto: https`. It is never sent over plain http, so a LAN install at `http://<server-ip>:8420` is not pinned to https. It leaves out `includeSubDomains` and `preload` because the parent domain (`example.com`) may host other services that are not ready for https-only; add those at your proxy if you want them. Once a browser has seen the header it refuses plain http for this host for 180 days, so turn on https at the proxy before setting `PUBLIC_URL`.

## Problems

Uploads failing with 413, changes appearing only after a reload, or "Cross-site POST form submissions are forbidden": see [Troubleshooting](troubleshooting.md).
