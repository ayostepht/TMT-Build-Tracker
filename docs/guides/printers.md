# Printers

Printers are optional. Adding one shows its live status (state, progress, temperatures, file name, filament when the printer reports it) next to your builds, can link a print job to a plate, and can show the camera. Printers belong to a chapter: open the chapter and use its **Printers** tab. Printers and Spoolman are only available on self-hosted installs, not on a public-mode site.

## The app is read-only towards your printers

The app reads status. It never moves, heats, pauses, stops or starts anything, and it never sends a file to a printer. The only messages it sends, per brand:

| Brand               | What the app sends                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Elegoo (SDCP)       | Status refresh (Cmd 0) and attributes refresh (Cmd 1), both with empty data, and one command, Cmd 386 `{"Enable":1}`: camera on.    |
| Klipper (Moonraker) | A `printer.objects.subscribe` request and `server.info`: both only read.                                                            |
| OctoPrint           | HTTP `GET` requests (`/api/job`, `/api/printer`) with your API key.                                                                 |
| Bambu Lab (LAN)     | Subscribes to the printer's report topic and publishes the `pushall` request, which only asks the printer to resend its full state. |

The Elegoo connection (Centauri Carbon) is the one in regular use on a real printer. Klipper (Moonraker), OctoPrint and Bambu Lab LAN are newer and the project has not yet run them against real printers: please report problems in the [issue tracker](https://github.com/ayostepht/TMT-Build-Tracker/issues).

These rules are enforced in code (`src/lib/server/printers/adapters/`); the Elegoo adapter refuses to build any other command.

## Network rules

- The server must reach the printer: it opens the connection, the printer never calls the app.
- A printer or Spoolman host must be on a private address: `10.x`, `172.16-31.x`, `192.168.x`, `100.64-127.x` (for example Tailscale), loopback, or an IPv6 local address. Public addresses are refused (the one exception is an OctoEverywhere shared link for Elegoo, below), as is the cloud-metadata address range. A host name is resolved first and every answer must be private.
- Redirects are never followed (neither for status nor for camera streams).
- Private values such as access codes and API keys are stored encrypted with a key derived from `BETTER_AUTH_SECRET`. They are never returned to the browser or written to logs. Changing the secret means entering them again.
- `TMT_PRINTERS=off` switches the background printer connections off completely.

### Docker networking

Bridge networking (the Docker default) can reach printers on your LAN by IP address, because the app only makes outgoing connections. Add printers by IP address.

The Elegoo **find printers** button uses a UDP broadcast, which does not cross Docker's bridge: it finds nothing in bridge mode. Either add the printer by its IP address, or give the container an address on your LAN (a macvlan or `br0` network, or host networking). With host networking the container uses the server's ports directly: set `PORT` to a free port. On Unraid's `br0` the server itself cannot reach the container unless "Host access to custom networks" is enabled in Docker settings (see the [Unraid guide](unraid.md#5-printers-on-your-network)).

## Elegoo (SDCP)

Centauri Carbon and other printers that speak SDCP. Status comes over a WebSocket on port 3030 (the default in the form); the camera is the printer's own stream at `http://<printer-ip>:3031/video`.

1. Find the printer's IP address on its network screen (or use **find printers** with host or `br0` networking).
2. In the chapter's **Printers** tab add a printer of type **Elegoo (SDCP)** with that IP address. The mainboard ID is found automatically; fill it in only if status stays empty.
3. For the camera, the app sends the one camera-on command (Cmd 386) and reads the stream. Without that command the printer's camera port answers "camera not ready".

The printer allows only a few simultaneous connections (about five on the Centauri Carbon; observed, not from Elegoo's documentation). If other tools (Elegoo's app, Home Assistant) already use them up, status may fail to connect.

### Through an OctoEverywhere shared link

If you already use OctoEverywhere with the printer, you can use its existing connection instead of using up one of the printer's limited direct connections. Paste the **shared link** in the printer form's "OctoEverywhere shared link (optional)" field. With a link the address, port and camera address are not needed.

- The link must look like `https://shared-<token>.octoeverywhere.com` (https, no port, path or query). Anything else is refused, and an OctoEverywhere address typed into the address field is refused: it belongs in the link field.
- The link is a secret: anyone holding it can reach the printer through OctoEverywhere. It is stored encrypted and never shown again; the form offers **Remove link**.
- Status uses the link's WebSocket (`wss://shared-<token>.octoeverywhere.com/websocket`) and the camera is the stream at `/video` on the same host.
- This is the only public destination the app will ever connect to; the name must resolve to public addresses only.
- How to create a shared link inside OctoEverywhere is described in OctoEverywhere's own documentation.

## Klipper (Moonraker)

Moonraker's WebSocket on port 7125 (the default). Add the printer with its IP address. The API key is optional: leave it empty when Moonraker trusts your network (in Moonraker's configuration the machine running this app must be a trusted client), and enter it if Moonraker requires one. The camera address is taken from the webcam list Moonraker reports; you can set your own, which must be on the same address as the printer.

## OctoPrint

REST polling on port 80 (the default; change the port if yours differs). An **API key** is required: create an application key in OctoPrint's settings and paste it into the printer form. The camera address is taken from OctoPrint's settings; you can set your own, on the printer's own address.

## Bambu Lab (LAN mode)

LAN-only mode over MQTT with TLS on port 8883. In the printer's network settings switch on **LAN mode** (the app does not use Bambu's cloud), then enter:

- the printer's IP address,
- the **LAN access code** (on the printer screen),
- the printer's **serial number**.

Notes: the printer uses a self-signed certificate, so the app does not verify it for this one connection. The camera is **not supported** for Bambu printers (their LAN camera is a proprietary stream), so no camera tile is offered.

## Spoolman and automatic logging

The chapter's **Integrations** tab holds the optional Spoolman address (a private address, see above) and a switch to log finished prints automatically. Neither is needed to use the app.

## Problems

"Printer shows offline" and "find printers finds nothing": see [Troubleshooting](troubleshooting.md).
