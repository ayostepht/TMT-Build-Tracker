import { describe, expect, it } from 'vitest';
import { connectionOptionsFor } from './connection-options.ts';
import {
	chooserGroups,
	connectionLabel,
	hasConnectedPrinter,
	hostedLabel,
	isExperimental,
	optionForPrinter
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
		expect(g[2].entries[0].description).toBe('A name only, for logging by hand');
	});

	it('hosted: network rows are disabled with the reason, the rest stay available and carry no label', () => {
		const g = chooserGroups(connectionOptionsFor(true));
		for (const e of g[0].entries) {
			expect(e.available).toBe(false);
			expect(e.unavailableReason).toMatch(/hosted site/);
		}
		expect(g[1].entries[0]).toMatchObject({ available: true, unavailableReason: null });
		expect(g[2].entries[0]).toMatchObject({ available: true, unavailableReason: null });
		expect(hostedLabel(true)).toBe('Works on a hosted site');
		expect(hostedLabel(false)).toBe('Needs the app on your own network');
	});

	it('only Klipper, OctoPrint and Bambu on the network are experimental', () => {
		const g = chooserGroups(connectionOptionsFor(false));
		const by = Object.fromEntries(g.flatMap((x) => x.entries).map((e) => [e.id, e.experimental]));
		expect(by).toEqual({
			'elegoo-lan': false,
			'klipper-lan': true,
			'octoprint-lan': true,
			'bambu-lan': true,
			octoeverywhere: false,
			manual: false
		});
		// the link's Klipper and OctoPrint types are experimental too: the form shows the tag
		const link = connectionOptionsFor(false).filter((o) => o.via === 'link');
		expect(link.map((o) => [o.linkPrinterType, isExperimental(o)])).toEqual([
			['Elegoo', false],
			['Klipper', true],
			['OctoPrint', true]
		]);
	});

	it('descriptions are a few words and match what each option supports', () => {
		const g = chooserGroups(connectionOptionsFor(false));
		const by = Object.fromEntries(g.flatMap((x) => x.entries).map((e) => [e.id, e.description]));
		expect(by).toEqual({
			'elegoo-lan': 'Live status and camera',
			'klipper-lan': 'Live status and camera',
			'octoprint-lan': 'Live status and camera',
			'bambu-lan': 'Live status, no camera',
			octoeverywhere: 'For Elegoo, Klipper or OctoPrint, from anywhere',
			manual: 'A name only, for logging by hand'
		});
		for (const e of g.flatMap((x) => x.entries)) {
			expect(e.description.split(/\s+/).length).toBeLessThanOrEqual(8);
			const cam = e.options.every((o) => o.camera);
			expect(/no camera/.test(e.description)).toBe(!cam && e.id !== 'manual');
		}
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
