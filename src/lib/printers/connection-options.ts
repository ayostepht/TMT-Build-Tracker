/**
 * The one list the printer setup UI renders from: every way a printer can be added, the fields
 * each needs, whether the hosted (public) site offers it, and whether it has been run against
 * real hardware. Browser-safe, no Node imports. The server filters nothing out: it reports
 * `available` per mode (`connectionOptionsFor`) and enforces the same rule on every route.
 */
import type { PrinterKind } from './status.ts';

export type ConnectionKey =
	| 'elegoo-lan'
	| 'octoeverywhere-elegoo'
	| 'octoeverywhere-klipper'
	| 'octoeverywhere-octoprint'
	| 'klipper-lan'
	| 'octoprint-lan'
	| 'bambu-lan'
	| 'manual';

/** One input the form shows. `where` says which part of the request body carries it. */
export interface ConnectionField {
	key: string;
	where: 'body' | 'secrets';
	label: string;
	required: boolean;
	/** Write-only: never returned by the API (only listed in `secretsSet`). */
	secret: boolean;
	hint?: string;
}

export interface ConnectionOption {
	key: ConnectionKey;
	label: string;
	/** `kind` to send when creating. */
	kind: PrinterKind;
	via: 'lan' | 'link' | 'manual';
	/** Options sharing a group are shown together (the OctoEverywhere link and its printer types). */
	group: 'lan' | 'octoeverywhere' | 'manual';
	/** For `via: 'link'`: the printer type behind the link, in the maintainer's words. */
	linkPrinterType?: 'Elegoo' | 'Klipper' | 'OctoPrint';
	fields: ConnectionField[];
	/** Has a camera (Bambu LAN has none; Not connected has none). */
	camera: boolean;
	/** Offered on the hosted site (`TMT_MODE=public`): OctoEverywhere links and Not connected only. */
	hosted: boolean;
	/** Run against real hardware by the maintainer (only Elegoo, directly and through a link). */
	verifiedOnHardware: boolean;
}

const name: ConnectionField = {
	key: 'name',
	where: 'body',
	label: 'Name',
	required: true,
	secret: false
};
const address: ConnectionField = {
	key: 'host',
	where: 'body',
	label: 'Address',
	required: true,
	secret: false,
	hint: 'The printer address on your network, like 192.168.0.50'
};
const port = (label = 'Port'): ConnectionField => ({
	key: 'port',
	where: 'body',
	label,
	required: false,
	secret: false
});
const link = (): ConnectionField => ({
	key: 'shareLink',
	where: 'secrets',
	label: 'OctoEverywhere shared link',
	required: true,
	secret: true,
	hint: 'Like https://shared-…octoeverywhere.com. Anyone holding the link can reach the printer, so it is stored encrypted and never shown again.'
});
const apiKey = (required: boolean): ConnectionField => ({
	key: 'apiKey',
	where: 'secrets',
	label: required ? 'API key' : 'API key (optional)',
	required,
	secret: true
});
const model: ConnectionField = {
	key: 'catalogId',
	where: 'body',
	label: 'Printer model (optional)',
	required: false,
	secret: false
};

export const CONNECTION_OPTIONS: readonly ConnectionOption[] = [
	{
		key: 'elegoo-lan',
		label: 'Elegoo on your network',
		kind: 'elegoo-sdcp',
		via: 'lan',
		group: 'lan',
		fields: [
			name,
			address,
			port(),
			{
				key: 'mainboardId',
				where: 'secrets',
				label: 'Mainboard ID (optional)',
				required: false,
				secret: false
			},
			model
		],
		camera: true,
		hosted: false,
		verifiedOnHardware: true
	},
	{
		key: 'octoeverywhere-elegoo',
		label: 'OctoEverywhere link',
		kind: 'elegoo-sdcp',
		via: 'link',
		group: 'octoeverywhere',
		linkPrinterType: 'Elegoo',
		fields: [name, link(), model],
		camera: true,
		hosted: true,
		verifiedOnHardware: true
	},
	{
		key: 'octoeverywhere-klipper',
		label: 'OctoEverywhere link',
		kind: 'moonraker',
		via: 'link',
		group: 'octoeverywhere',
		linkPrinterType: 'Klipper',
		fields: [name, link(), apiKey(false), model],
		camera: true,
		hosted: true,
		verifiedOnHardware: false
	},
	{
		key: 'octoeverywhere-octoprint',
		label: 'OctoEverywhere link',
		kind: 'octoprint',
		via: 'link',
		group: 'octoeverywhere',
		linkPrinterType: 'OctoPrint',
		fields: [name, link(), apiKey(true), model],
		camera: true,
		hosted: true,
		verifiedOnHardware: false
	},
	{
		key: 'klipper-lan',
		label: 'Klipper (Moonraker)',
		kind: 'moonraker',
		via: 'lan',
		group: 'lan',
		fields: [name, address, port('Port (default 7125)'), apiKey(false), model],
		camera: true,
		hosted: false,
		verifiedOnHardware: false
	},
	{
		key: 'octoprint-lan',
		label: 'OctoPrint',
		kind: 'octoprint',
		via: 'lan',
		group: 'lan',
		fields: [name, address, port('Port (default 80)'), apiKey(true), model],
		camera: true,
		hosted: false,
		verifiedOnHardware: false
	},
	{
		key: 'bambu-lan',
		label: 'Bambu Lab (LAN mode)',
		kind: 'bambu-lan',
		via: 'lan',
		group: 'lan',
		fields: [
			name,
			address,
			{
				key: 'accessCode',
				where: 'secrets',
				label: 'LAN access code',
				required: true,
				secret: true
			},
			{
				key: 'serial',
				where: 'secrets',
				label: 'Serial number',
				required: true,
				secret: false
			},
			model
		],
		camera: false,
		hosted: false,
		verifiedOnHardware: false
	},
	{
		key: 'manual',
		label: 'Not connected',
		kind: 'manual',
		via: 'manual',
		group: 'manual',
		fields: [name, model],
		camera: false,
		hosted: true,
		verifiedOnHardware: false
	}
];

export type ConnectionOptionView = ConnectionOption & {
	/** False on the hosted site for options that need a LAN address. */
	available: boolean;
	/** Why it is not available (shown instead of the option); null when it is. */
	unavailableReason: string | null;
};

export const HOSTED_UNAVAILABLE_REASON =
	'Not available on this hosted site. Connect through an OctoEverywhere link, or add a printer that is not connected.';

/** The options with `available` and a reason for the given mode. Order is display order. */
export function connectionOptionsFor(hosted: boolean): ConnectionOptionView[] {
	return CONNECTION_OPTIONS.map((o) => {
		const available = !hosted || o.hosted;
		return {
			...o,
			available,
			unavailableReason: available ? null : HOSTED_UNAVAILABLE_REASON
		};
	});
}
