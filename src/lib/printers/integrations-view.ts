/**
 * Pure view logic for the Integrations page: how the options are grouped into chooser rows, the
 * "Experimental" tag, and the one-line connection label of a saved printer. No Svelte, no Node, so
 * the hosted/available rendering rules can be unit-tested.
 */
import type { ConnectionOptionView } from './connection-options.ts';
import { LINK_GROUP_DESCRIPTION, SETUP_TEXT } from './setup-steps.ts';
import { PRINTER_KIND_INFO, type PrinterPublic } from './status.ts';

export const hostedLabel = (hosted: boolean) =>
	hosted ? 'Works on a hosted site' : 'Needs the app on your own network';

/** The one quiet tag on options that have not been run on real printers yet. */
export const EXPERIMENTAL_TAG = 'Experimental';

/** Experimental: not run on a real printer yet. A printer the app never contacts has nothing to run. */
export const isExperimental = (o: Pick<ConnectionOptionView, 'verifiedOnHardware' | 'via'>) =>
	!o.verifiedOnHardware && o.via !== 'manual';

export interface ChooserEntry {
	id: string;
	title: string;
	/** A few words: what the option gives you. */
	description: string;
	/** One option, or the three OctoEverywhere printer types. */
	options: ConnectionOptionView[];
	available: boolean;
	/** Shown (disabled row) only when `available` is false, i.e. on a hosted site. */
	unavailableReason: string | null;
	/** Gets the small "Experimental" tag at the end of its row. The link row never does: its form does. */
	experimental: boolean;
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
			experimental: isExperimental(o)
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
					experimental: false
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
			experimental: false
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
