/**
 * Maker-facing text for the Integrations page: a one-line description and the short numbered
 * "How to set it up" for every connection option, plus the Spoolman steps. Browser-safe, no Node
 * imports. The facts come from the form hints, `PRINTER_KIND_INFO`, the adapters and
 * `docs/guides/printers.md`; where a printer's exact menu path is not known the step says what to
 * look for instead of naming a menu.
 */
import type { ConnectionKey } from './connection-options.ts';

/** The printers guide in the public repository (a section is reached with `#<anchor>`). */
export const PRINTER_GUIDE_URL =
	'https://github.com/ayostepht/TMT-Build-Tracker/blob/main/docs/guides/printers.md';

export interface SetupText {
	/** One line for the option card. */
	description: string;
	/** 3 to 5 short steps. */
	steps: string[];
	/** Section of `docs/guides/printers.md` ("Full guide" link target). */
	anchor: string;
}

const LINK_STEP_COPY =
	'Copy the shared link. It looks like https://shared-…octoeverywhere.com. Anyone who holds it can reach the printer through OctoEverywhere, so keep it private: the app stores it encrypted and never shows it again.';
const LINK_STEP_CREATE =
	'In OctoEverywhere, create a shared connection for the printer (OctoEverywhere explains how in its own help).';
const LINK_STEP_PASTE =
	'Paste the link below. You do not need the printer’s address, port or camera address.';

export const SETUP_TEXT: Record<ConnectionKey, SetupText> = {
	'elegoo-lan': {
		description:
			'Centauri Carbon and other Elegoo printers: live status and camera over your network.',
		steps: [
			'Make sure the printer is on the same network as the computer that runs this app.',
			'Find the printer’s IP address on its network screen (or use “Find Elegoo printers” below; it only finds printers on the same network segment as this app).',
			'Enter the address below. Leave the port empty: 3030 is the default. The mainboard ID is found automatically.',
			'Press Test connection, then Add printer. The app only reads status; the one command it sends turns the camera on.'
		],
		anchor: 'elegoo-sdcp'
	},
	'octoeverywhere-elegoo': {
		description: 'Reach an Elegoo printer through OctoEverywhere.',
		steps: [
			LINK_STEP_CREATE,
			LINK_STEP_COPY,
			LINK_STEP_PASTE,
			'Press Test connection, then Add printer. Status and the camera both come through the link.'
		],
		anchor: 'through-an-octoeverywhere-shared-link'
	},
	'octoeverywhere-klipper': {
		description: 'Reach a Klipper printer through OctoEverywhere.',
		steps: [
			LINK_STEP_CREATE,
			LINK_STEP_COPY,
			LINK_STEP_PASTE,
			'Enter Moonraker’s API key only if it requires one.',
			'Press Test connection, then Add printer.'
		],
		anchor: 'klipper-moonraker-through-an-octoeverywhere-shared-link'
	},
	'octoeverywhere-octoprint': {
		description: 'Reach an OctoPrint printer through OctoEverywhere.',
		steps: [
			LINK_STEP_CREATE,
			LINK_STEP_COPY,
			LINK_STEP_PASTE,
			'OctoPrint still needs its API key: create an application key in OctoPrint’s settings and paste it below.',
			'Press Test connection, then Add printer.'
		],
		anchor: 'octoprint-through-an-octoeverywhere-shared-link'
	},
	'klipper-lan': {
		description: 'Klipper printers through Moonraker, on your network.',
		steps: [
			'Make sure Moonraker (the service behind Mainsail or Fluidd) is running and the printer is on the same network as this app.',
			'Find the printer’s IP address (its network screen, or your router’s list of devices).',
			'Enter the address below. Leave the port empty unless yours is not 7125.',
			'Leave the API key empty if Moonraker trusts your network (the machine that runs this app must be a trusted client in Moonraker’s configuration). Otherwise enter the key.',
			'Press Test connection, then Add printer.'
		],
		anchor: 'klipper-moonraker'
	},
	'octoprint-lan': {
		description: 'OctoPrint printers, on your network.',
		steps: [
			'Make sure OctoPrint is running and on the same network as this app.',
			'In OctoPrint’s settings, create an application key and copy it.',
			'Enter the address of the machine OctoPrint runs on. Leave the port empty unless it is not 80.',
			'Paste the API key. Press Test connection, then Add printer.'
		],
		anchor: 'octoprint'
	},
	'bambu-lan': {
		description: 'Bambu Lab printers in LAN mode: live status, no camera.',
		steps: [
			'In the printer’s network settings, switch on LAN mode. The app does not use Bambu’s cloud.',
			'On the printer’s screen, find its IP address, the LAN access code and its serial number.',
			'Enter all three below. The app does not verify the printer’s self-signed certificate for this one connection.',
			'Press Test connection, then Add printer. The camera is not supported for Bambu printers.'
		],
		anchor: 'bambu-lab-lan-mode'
	},
	manual: {
		description: 'Log prints by hand; the app shows no live status.',
		steps: [
			'Give the printer a name. You will pick it when you start a plate and when you log a print.',
			'Optionally choose its model.',
			'The app never contacts it: there is no address, no key and no camera.'
		],
		anchor: 'a-printer-that-is-not-connected'
	}
};

/** The option card for the OctoEverywhere group (three printer types behind one card). */
export const LINK_GROUP_DESCRIPTION =
	'Use OctoEverywhere’s shared connection: works from a hosted site, and when this app is not on the printer’s network. Elegoo, Klipper or OctoPrint.';

export const SPOOLMAN_TEXT = {
	description:
		'Spoolman tracks your filament spools. With it connected, the grams you log are taken off the spool you linked.',
	steps: [
		'Spoolman is a separate app. Run it on your own network, for example on the same server as this app.',
		'Enter its address below, like http://192.168.0.20:7912. The address must be reachable from where this app runs.',
		'Turn on “Deduct logged grams” so each logged print takes its grams off the linked spool. Link each filament to a spool in a build’s Settings.'
	],
	anchor: 'spoolman-and-automatic-logging',
	hostedReason:
		'A hosted site cannot reach a Spoolman on your own network, so this is only available when you run the app yourself.'
} as const;

export const HOSTED_NOTE =
	'On this hosted site, OctoEverywhere links, printers that are not connected and logging prints by hand all work. Anything that needs the app on your own network (a printer’s local address, Spoolman) needs your own install of the app.';

export const guideUrl = (anchor: string) => `${PRINTER_GUIDE_URL}#${anchor}`;
