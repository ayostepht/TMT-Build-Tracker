/**
 * Pure view logic for the Integrations page: how the options are grouped into chooser cards, the
 * two small labels, and the one-line connection label of a saved printer. No Svelte, no Node, so
 * the hosted/available rendering rules can be unit-tested.
 */
import type { ConnectionOptionView } from './connection-options.ts';
import { LINK_GROUP_DESCRIPTION, SETUP_TEXT } from './setup-steps.ts';
import { PRINTER_KIND_INFO, type PrinterPublic } from './status.ts';

export const hostedLabel = (hosted: boolean) =>
	hosted ? 'Works on a hosted site' : 'Needs the app on your own network';

export const VERIFIED_LABEL = 'In regular use';
export const NEW_LABEL = 'New: not yet run on a real printer';

export interface ChooserEntry {
	id: string;
	title: string;
	description: string;
	/** One option, or the three OctoEverywhere printer types. */
	options: ConnectionOptionView[];
	available: boolean;
	unavailableReason: string | null;
	hosted: boolean;
	/** Label for "run on real hardware yet?", wording for makers; null for a printer the app never contacts. */
	verifiedLabel: string | null;
}
export interface ChooserGroup {
	id: 'lan' | 'octoeverywhere' | 'manual';
	title: string;
	entries: ChooserEntry[];
}

const GROUP_TITLE = {
	lan: 'On your network',
	octoeverywhere: 'Through OctoEverywhere',
	manual: 'Not connected'
} as const;

/** Printer-type words for the three link options, and for a saved printer's label. */
const TYPE_WORD: Record<string, string> = {
	'elegoo-sdcp': 'Elegoo',
	moonraker: 'Klipper',
	octoprint: 'OctoPrint',
	'bambu-lan': 'Bambu Lab'
};

function linkVerifiedLabel(opts: ConnectionOptionView[]): string {
	const yes = opts.filter((o) => o.verifiedOnHardware).map((o) => o.linkPrinterType);
	const no = opts.filter((o) => !o.verifiedOnHardware).map((o) => o.linkPrinterType);
	if (!no.length) return VERIFIED_LABEL;
	if (!yes.length) return NEW_LABEL;
	const list = (a: (string | undefined)[]) =>
		a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : String(a[0]);
	return `${VERIFIED_LABEL} with ${list(yes)}; new for ${list(no)}`;
}

/** Chooser groups in display order; empty groups are left out. */
export function chooserGroups(options: ConnectionOptionView[]): ChooserGroup[] {
	const lan: ChooserEntry[] = options
		.filter((o) => o.group === 'lan')
		.map((o) => ({
			id: o.key,
			title: o.label,
			description: SETUP_TEXT[o.key].description,
			options: [o],
			available: o.available,
			unavailableReason: o.unavailableReason,
			hosted: o.hosted,
			verifiedLabel: o.verifiedOnHardware ? VERIFIED_LABEL : NEW_LABEL
		}));
	const links = options.filter((o) => o.group === 'octoeverywhere');
	const link: ChooserEntry[] = links.length
		? [
				{
					id: 'octoeverywhere',
					title: 'OctoEverywhere shared link',
					description: LINK_GROUP_DESCRIPTION,
					options: links,
					available: links.some((o) => o.available),
					unavailableReason: links.find((o) => o.unavailableReason)?.unavailableReason ?? null,
					hosted: links.every((o) => o.hosted),
					verifiedLabel: linkVerifiedLabel(links)
				}
			]
		: [];
	const manual: ChooserEntry[] = options
		.filter((o) => o.group === 'manual')
		.map((o) => ({
			id: o.key,
			title: o.label,
			description: SETUP_TEXT[o.key].description,
			options: [o],
			available: o.available,
			unavailableReason: o.unavailableReason,
			hosted: o.hosted,
			verifiedLabel: null // nothing to run on a real printer: the app never contacts it
		}));
	return (
		[
			{ id: 'lan', title: GROUP_TITLE.lan, entries: lan },
			{ id: 'octoeverywhere', title: GROUP_TITLE.octoeverywhere, entries: link },
			{ id: 'manual', title: GROUP_TITLE.manual, entries: manual }
		] as ChooserGroup[]
	).filter((g) => g.entries.length);
}

/** The option a saved printer was created from (for editing it). */
export function optionForPrinter(
	options: ConnectionOptionView[],
	p: Pick<PrinterPublic, 'kind' | 'connection'>
): ConnectionOptionView | undefined {
	if (p.connection === 'manual') return options.find((o) => o.via === 'manual');
	return options.find((o) => o.via === p.connection && o.kind === p.kind);
}

/** "Elegoo · on your network", "Klipper · OctoEverywhere link", "Not connected". */
export function connectionLabel(p: Pick<PrinterPublic, 'kind' | 'connection'>): string {
	if (p.connection === 'manual') return 'Not connected';
	const type = TYPE_WORD[p.kind] ?? PRINTER_KIND_INFO[p.kind].label;
	return p.connection === 'link' ? `${type} · OctoEverywhere link` : `${type} · on your network`;
}

/** Automatic print logging needs a printer that reports jobs: any lan or link printer. */
export const hasConnectedPrinter = (printers: Pick<PrinterPublic, 'connection'>[]) =>
	printers.some((p) => p.connection !== 'manual');
