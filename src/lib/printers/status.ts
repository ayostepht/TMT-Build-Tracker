/** Printer integration types shared by server and browser. No Node imports. */

export const PRINTER_KINDS = ['elegoo-sdcp', 'moonraker', 'octoprint', 'bambu-lan'] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

export const PRINTER_KIND_INFO: Record<
	PrinterKind,
	{ label: string; defaultPort: number; secrets: SecretField[]; hint: string }
> = {
	'elegoo-sdcp': {
		label: 'Elegoo (SDCP)',
		defaultPort: 3030,
		secrets: [
			{
				key: 'mainboardId',
				label: 'Mainboard ID (optional)',
				secret: false,
				hint: 'Found automatically; fill in only if status stays empty.'
			}
		],
		hint: 'Centauri Carbon and other SDCP printers. Read-only status over WebSocket.'
	},
	moonraker: {
		label: 'Klipper (Moonraker)',
		defaultPort: 7125,
		secrets: [{ key: 'apiKey', label: 'API key (optional)', secret: true }],
		hint: 'Moonraker WebSocket on port 7125.'
	},
	octoprint: {
		label: 'OctoPrint',
		defaultPort: 80,
		secrets: [{ key: 'apiKey', label: 'API key', secret: true }],
		hint: 'OctoPrint REST API; create an application key in its settings.'
	},
	'bambu-lan': {
		label: 'Bambu Lab (LAN mode)',
		defaultPort: 8883,
		secrets: [
			{ key: 'accessCode', label: 'LAN access code', secret: true },
			{ key: 'serial', label: 'Serial number', secret: false }
		],
		hint: 'LAN-only mode over MQTT (TLS). Access code and serial are on the printer screen.'
	}
};

export interface SecretField {
	key: string;
	label: string;
	/** Secret values are write-only: never returned to the browser. */
	secret: boolean;
	hint?: string;
}

export const PRINTER_STATES = [
	'idle',
	'printing',
	'paused',
	'done',
	'failed',
	'offline',
	'error'
] as const;
export type PrinterState = (typeof PRINTER_STATES)[number];

export interface PrinterFilament {
	slot: string;
	color?: string;
	type?: string;
}

/** What every adapter reports, whatever the protocol. */
export interface PrinterStatus {
	state: PrinterState;
	/** 0-100 */
	progress: number | null;
	layer?: number;
	totalLayers?: number;
	fileName?: string;
	elapsedSec?: number;
	remainingSec?: number;
	nozzleC?: number;
	bedC?: number;
	chamberC?: number;
	filaments?: PrinterFilament[];
	/** Print was stopped by the user rather than failing. */
	cancelled?: boolean;
	/** Short error text when state is 'error' or 'offline'. */
	message?: string;
	/** Protocol detail for debugging (never secrets). */
	raw?: Record<string, unknown>;
}

export const OFFLINE: PrinterStatus = { state: 'offline', progress: null };

export const ACTIVE_STATES: readonly PrinterState[] = ['printing', 'paused'];

/** A printer as the browser sees it. Secrets never appear, only whether they are set. */
export interface PrinterPublic {
	id: string;
	organizationId: string;
	name: string;
	kind: PrinterKind;
	host: string;
	port: number | null;
	catalogId: string | null;
	enabled: boolean;
	lastSeenAt: string | null;
	status: PrinterStatus | null;
	/** Names of stored secret fields that are set (values are never sent). */
	secretsSet: string[];
	/** Non-secret identifiers (serial, mainboard id). */
	identifiers: Record<string, string>;
}

export interface PrinterJobView {
	id: string;
	printerId: string;
	printerName: string;
	buildId: string | null;
	plateNumber: number | null;
	partSlugs: string[] | null;
	fileName: string;
	status: 'printing' | 'paused' | 'done' | 'failed' | 'cancelled';
	progress: number | null;
	startedAt: string | null;
	finishedAt: string | null;
	runId: string | null;
	/** Finished, linked to a plate and not logged yet: show "Confirm print log". */
	pendingConfirm: boolean;
}

export const fmtRemaining = (sec: number | undefined | null): string => {
	if (sec == null || !Number.isFinite(sec)) return '';
	const s = Math.max(0, Math.round(sec));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return h ? `${h} h ${m} min` : `${m} min`;
};
