# Printers

Printers are optional. Adding one shows its live status (state, progress, temperatures, file name, filament when the printer reports it) next to your builds, can link a print job to a plate, and can show the camera. You add, edit and remove printers on your workspace's **Integrations** page: choose **Add a printer**, pick how the printer is reached, and follow the short steps shown there. A chapter's **Printers** tab only shows the status of the printers that are already set up.

## Hosted or self-hosted

It depends on where the app runs.

- **On your own server (self-hosted):** every option below works. The app runs on your network, so it can reach a printer by its local address, find Elegoo printers, show a printer's own camera address and talk to a Spoolman you run.
- **On a hosted site (a public-mode install run by someone else):** the app runs on the internet, so it cannot see your home network, and a printer address like `192.168.0.50` means nothing to it. Two options work there: a printer reached through an **OctoEverywhere shared link** (OctoEverywhere carries the connection from your printer to the internet) and a printer that is **not connected** (a name only, for logging by hand). Local addresses, finding printers, custom camera addresses and Spoolman are not available on a hosted site. To use those, run the app yourself.
- A hosted site limits how many link printers each workspace and the whole site may have, because every link is a long-lived connection from the server to OctoEverywhere. If you hit the limit the message says so. The site's admin can change the numbers ([Environment reference](environment.md#limits)).

OctoEverywhere and OctoPrint are different things with similar names. OctoEverywhere is a separate remote-access service, not part of OctoPrint. It works with several kinds of printers (OctoPrint, Klipper and Elegoo among them) through a plugin or companion that runs on the printer side. A "shared connection" is a link OctoEverywhere gives you that reaches that printer's own web interface from anywhere. OctoPrint itself has no built-in remote link: without OctoEverywhere (or your own VPN or reverse proxy) it can only be reached on your network, which is the plain **OctoPrint** option below. OctoEverywhere has a free tier; its pages do not say whether shared connections need a paid plan, so check there before you start.

## What works how well

- **In regular use on a real printer:** Elegoo on your network, and Elegoo through an OctoEverywhere link (Centauri Carbon).
- **Not yet run against real printers by the project:** Klipper (Moonraker), OctoPrint and Bambu Lab LAN mode on the network, and Klipper and OctoPrint through an OctoEverywhere link.
- **Not yet confirmed:** whether an OctoEverywhere link carries everything Klipper and OctoPrint need (Moonraker's WebSocket, OctoPrint's status requests and the camera) is expected from OctoEverywhere's documentation but has not been checked.

If you try one of these, please report what worked and what did not in the [issue tracker](https://github.com/ayostepht/TMT-Build-Tracker/issues).

## The app is read-only towards your printers

The app reads status. It never moves, heats, pauses, stops or starts anything, and it never sends a file to a printer. The only messages it sends, per brand (the same over an OctoEverywhere link):

| Brand               | What the app sends                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Elegoo (SDCP)       | Status refresh (Cmd 0) and attributes refresh (Cmd 1), both with empty data, and one command, Cmd 386 `{"Enable":1}`: camera on.    |
| Klipper (Moonraker) | A `printer.objects.subscribe` request and `server.info`: both only read.                                                            |
| OctoPrint           | HTTP `GET` requests (`/api/job`, `/api/printer`) with your API key.                                                                 |
| Bambu Lab (LAN)     | Subscribes to the printer's report topic and publishes the `pushall` request, which only asks the printer to resend its full state. |
| Not connected       | Nothing. The app never contacts it.                                                                                                 |

The camera-on command is sent only to an Elegoo printer, on your network or through its link. These rules are enforced in code (`src/lib/server/printers/adapters/`); the Elegoo adapter refuses to build any other command.

Starting a plate in the app (the plate's status badge, then **Where is it printing?**) only tells the app which printer to follow and starts the clock. You start the print at the printer itself.

## Network rules

- The server must reach the printer: it opens the connection, the printer never calls the app.
- A printer or Spoolman host must be on a private address: `10.x`, `172.16-31.x`, `192.168.x`, `100.64-127.x` (for example Tailscale), loopback, or an IPv6 local address. Public addresses are refused (the one exception is an OctoEverywhere shared link, below), as is the cloud-metadata address range. A host name is resolved first and every answer must be private.
- Redirects are never followed (neither for status nor for camera streams).
- Private values such as access codes and API keys are stored encrypted with a key derived from `BETTER_AUTH_SECRET`. They are never returned to the browser or written to logs. Changing the secret means entering them again.
- `TMT_PRINTERS=off` switches the background printer connections off completely.

### Docker networking

Bridge networking (the Docker default) can reach printers on your LAN by IP address, because the app only makes outgoing connections. Add printers by IP address.

The Elegoo **find printers** button uses a UDP broadcast, which does not cross Docker's bridge: it finds nothing in bridge mode. Either add the printer by its IP address, or give the container an address on your LAN (a macvlan or `br0` network, or host networking). With host networking the container uses the server's ports directly: set `PORT` to a free port. On Unraid's `br0` the server itself cannot reach the container unless "Host access to custom networks" is enabled in Docker settings (see the [Unraid guide](unraid.md#5-printers-on-your-network)).

## Elegoo (SDCP)

Centauri Carbon and other printers that speak SDCP. Status comes over a WebSocket on port 3030 (the default in the form); the camera is the printer's own stream at `http://<printer-ip>:3031/video`.

1. Find the printer's IP address on its network screen (or use **find printers** with host or `br0` networking).
2. On the **Integrations** page choose **Add a printer**, then **Elegoo on your network**, and enter that IP address. The mainboard ID is found automatically; fill it in only if status stays empty.
3. For the camera, the app sends the one camera-on command (Cmd 386) and reads the stream. Without that command the printer's camera port answers "camera not ready".

The printer allows only a few simultaneous connections (about five on the Centauri Carbon; observed, not from Elegoo's documentation). If other tools (Elegoo's app, Home Assistant) already use them up, status may fail to connect.

### Through an OctoEverywhere shared link

If you already use OctoEverywhere with the printer, you can use its existing connection instead of using up one of the printer's limited direct connections. On the **Integrations** page choose **Add a printer**, then **OctoEverywhere link**, pick Elegoo and paste the **shared link**. With a link the address, port and camera address are not needed. This works on a hosted site too.

- The link must look like `https://shared-<token>.octoeverywhere.com` (https, no port, path or query). Anything else is refused, and an OctoEverywhere address typed into the address field is refused: it belongs in the link field.
- The link is a secret: anyone holding it can reach the printer through OctoEverywhere. It is stored encrypted and never shown again; the form offers **Remove link**.
- Status uses the link's WebSocket (`wss://shared-<token>.octoeverywhere.com/websocket`) and the camera is the stream at `/video` on the same host.
- OctoEverywhere links are reached over https only. The server connects to the address it checked, never follows redirects, and drops the connection if the printer side sends a message over 1 MiB or too much data per second.
- An OctoEverywhere link is the only public destination the app will ever connect to; the name must resolve to public addresses only.
- How to create a shared link inside OctoEverywhere is described in OctoEverywhere's own documentation.

## Klipper (Moonraker)

Not yet run against a real printer by the project. Choose **Klipper (Moonraker)** under **Add a printer**. Moonraker's WebSocket on port 7125 (the default). Add the printer with its IP address. The API key is optional: leave it empty when Moonraker trusts your network (in Moonraker's configuration the machine running this app must be a trusted client), and enter it if Moonraker requires one. The camera address is taken from the webcam list Moonraker reports; you can set your own, which must be on the same address as the printer.

### Klipper (Moonraker) through an OctoEverywhere shared link

Not yet run against a real printer by the project. You need Klipper with OctoEverywhere's companion installed and linked to your OctoEverywhere account, and a shared connection created there. Then, instead of the printer's address, paste an OctoEverywhere **shared link** (the same kind of link as for Elegoo above: `https://shared-<token>.octoeverywhere.com`, stored encrypted, shown once). Status uses the link's Moonraker WebSocket and the camera comes from the link too. Leave the API key empty unless Moonraker requires one. The app asks the link more gently than a local connection and backs off when it does not answer. This works on a hosted site.

## OctoPrint

Not yet run against a real printer by the project. Choose **OctoPrint** under **Add a printer**. REST polling on port 80 (the default; change the port if yours differs). An **API key** is required: create an application key in OctoPrint's settings and paste it into the printer form. The camera address is taken from OctoPrint's settings; you can set your own, on the printer's own address.

### OctoPrint through an OctoEverywhere shared link

Not yet run against a real printer by the project. You need OctoPrint with the OctoEverywhere plugin installed and linked to an OctoEverywhere account, and a shared connection created there. The link only carries the connection: the app still talks to OctoPrint's own API through it, which is why OctoPrint's **API key** is still needed. Paste the **shared link** instead of the address, and create an application key in OctoPrint's settings and paste that too. Status is polled through the link (slower and gentler than on your network) and the camera comes from the link. This works on a hosted site.

## Bambu Lab (LAN mode)

Not yet run against a real printer by the project. LAN-only mode over MQTT with TLS on port 8883. In the printer's network settings switch on **LAN mode** (the app does not use Bambu's cloud), then enter:

- the printer's IP address,
- the **LAN access code** (on the printer screen),
- the printer's **serial number**.

Notes: the printer uses a self-signed certificate, so the app does not verify it for this one connection. The camera is **not supported** for Bambu printers (their LAN camera is a proprietary stream), so no camera tile is offered. A Bambu printer cannot be reached through an OctoEverywhere link (LAN mode is a direct connection to the printer), so it needs the app on your own network.

## A printer that is not connected

Choose **Not connected** under **Add a printer** when the printer has no connection the app can use, or you simply want to log prints by hand. Give it a name and, if you like, its model. The app never contacts it: there is no address, key or camera and no live status. You still pick it when you start a plate (**Where is it printing?**) and when you log a print. It works on a hosted site and on your own server. A hosted site may limit how many of these a workspace can have.

## Spoolman and automatic logging

The **Integrations** page also holds the optional Spoolman address (a private address, see above) and a switch to log finished prints automatically. Neither is needed to use the app. Spoolman needs the app on your own network, so it is not available on a hosted site.

## Problems

"Printer shows offline" and "find printers finds nothing": see [Troubleshooting](troubleshooting.md).
