import { describe, expect, it } from 'vitest';
import { connectionOptionsFor } from './connection-options.ts';
import {
	chooserGroups,
	connectionLabel,
	hasConnectedPrinter,
	hostedLabel,
	optionForPrinter,
	NEW_LABEL,
	VERIFIED_LABEL
} from './integrations-view.ts';
import { PRINTER_KINDS } from './status.ts';
import { SETUP_TEXT, guideUrl, PRINTER_GUIDE_URL } from './setup-steps.ts';

describe('chooser groups', () => {
	it('groups in order: your network (4), OctoEverywhere (1 card, 3 types), Not connected', () => {
		const g = chooserGroups(connectionOptionsFor(false));
		expect(g.map((x) => x.title)).toEqual([
			'On your network',
			'Through OctoEverywhere',
			'Not connected'
		]);
		expect(g[0].entries.map((e) => e.id)).toEqual([
			'elegoo-lan',
			'klipper-lan',
			'octoprint-lan',
			'bambu-lan'
		]);
		expect(g[1].entries).toHaveLength(1);
		expect(g[1].entries[0].options.map((o) => o.linkPrinterType)).toEqual([
			'Elegoo',
			'Klipper',
			'OctoPrint'
		]);
		expect(g[2].entries[0].description).toBe('Log prints by hand; the app shows no live status.');
	});

	it('hosted: network cards are disabled with the reason, the rest stay available', () => {
		const g = chooserGroups(connectionOptionsFor(true));
		for (const e of g[0].entries) {
			expect(e.available).toBe(false);
			expect(e.unavailableReason).toMatch(/hosted site/);
			expect(hostedLabel(e.hosted)).toBe('Needs the app on your own network');
		}
		expect(g[1].entries[0]).toMatchObject({
			available: true,
			unavailableReason: null,
			hosted: true
		});
		expect(hostedLabel(true)).toBe('Works on a hosted site');
		expect(g[2].entries[0].available).toBe(true);
	});

	it('the two labels follow the data: Elegoo in regular use, the rest new, link card says which', () => {
		const g = chooserGroups(connectionOptionsFor(false));
		const by = Object.fromEntries(g.flatMap((x) => x.entries).map((e) => [e.id, e.verifiedLabel]));
		expect(by['elegoo-lan']).toBe(VERIFIED_LABEL);
		expect(by['klipper-lan']).toBe(NEW_LABEL);
		expect(by['bambu-lan']).toBe(NEW_LABEL);
		expect(by.manual).toBeNull(); // no hardware label for a printer the app never contacts
		expect(by.octoeverywhere).toBe('In regular use with Elegoo; new for Klipper and OctoPrint');
	});
});

describe('saved printers', () => {
	const opts = connectionOptionsFor(false);
	it('finds the option a printer was made from', () => {
		expect(optionForPrinter(opts, { kind: 'moonraker', connection: 'link' })?.key).toBe(
			'octoeverywhere-klipper'
		);
		expect(optionForPrinter(opts, { kind: 'moonraker', connection: 'lan' })?.key).toBe(
			'klipper-lan'
		);
		expect(optionForPrinter(opts, { kind: 'manual', connection: 'manual' })?.key).toBe('manual');
		expect(optionForPrinter(opts, { kind: 'bambu-lan', connection: 'lan' })?.key).toBe('bambu-lan');
	});
	it('labels the connection and spots connected printers', () => {
		expect(connectionLabel({ kind: 'manual', connection: 'manual' })).toBe('Not connected');
		expect(connectionLabel({ kind: 'octoprint', connection: 'link' })).toBe(
			'OctoPrint · OctoEverywhere link'
		);
		expect(connectionLabel({ kind: 'elegoo-sdcp', connection: 'lan' })).toBe(
			'Elegoo · on your network'
		);
		expect(hasConnectedPrinter([{ connection: 'manual' }])).toBe(false);
		expect(hasConnectedPrinter([])).toBe(false);
		expect(hasConnectedPrinter([{ connection: 'manual' }, { connection: 'link' }])).toBe(true);
	});
});

describe('setup text', () => {
	it('every option has a description, 3 to 5 steps and a guide anchor', () => {
		for (const o of connectionOptionsFor(false)) {
			const t = SETUP_TEXT[o.key];
			expect(t.description.length).toBeGreaterThan(10);
			expect(t.steps.length).toBeGreaterThanOrEqual(3);
			expect(t.steps.length).toBeLessThanOrEqual(5);
			expect(guideUrl(t.anchor)).toBe(`${PRINTER_GUIDE_URL}#${t.anchor}`);
		}
		expect(PRINTER_KINDS.length).toBe(5);
	});
});
