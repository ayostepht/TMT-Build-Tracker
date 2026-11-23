import { expect, test, newClientContext } from './fixtures';
import {
	createBuild,
	invite,
	joinViaInvite,
	keepPrintedVisible,
	openNav,
	ownerWithBuild,
	signUp,
	startBuild,
	uniqueEmail
} from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';
import { randomBytes } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';

/**
 * Custom parts, follow-up tweaks (issue 113): the add sheet's Name, typed time and grams, renaming a part
 * in a build, "Update saved part", and the Custom parts page (Settings menu, add form, inline edit,
 * access). Saved parts and "Include in new builds" are workspace-wide, so every test signs up its own
 * owner and chapter, and afterEach deletes what it saved.
 */

interface ViewPlate {
	number: number;
	name: string;
	source: string;
	parts: string[];
	estSeconds: number | null;
	estSource: string | null;
	slicerGrams: number | null;
	gramsSource: string | null;
	filamentGrams: Record<string, number>;
}
interface ViewJson {
	build: { organizationId: string };
	plates: ViewPlate[];
	skipped: { slug: string; name: string }[];
	customPieces: { id: string; name: string; libraryId?: string | null; plates: number[] }[];
}
interface LibJson {
	id: string;
	name: string;
	isDefault: boolean;
	totalSeconds: number | null;
	totalGrams: number | null;
	replaces: string[];
	plates: { name: string; estSeconds: number | null; grams: number | null; runs: number }[];
}
interface Template {
	roles: { key: string; name: string }[];
	parts: { slug: string; name: string }[];
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;
const originOf = (page: Page) => ({ origin: new URL(page.url()).origin });
const customPlates = (v: ViewJson) => v.plates.filter((p) => p.source.startsWith('custom:'));
const libraryAll = async (page: Page, org: string) =>
	(await (await page.request.get(`/api/custom-library?organizationId=${org}`)).json()) as {
		pieces: LibJson[];
		template: Template;
	};
const library = async (page: Page, org: string) => (await libraryAll(page, org)).pieces;
const teamPath = (chapterUrl: string) => new URL(chapterUrl).pathname;

let cleanupOrg: string | null = null;
test.afterEach(async ({ page }) => {
	const org = cleanupOrg;
	cleanupOrg = null;
	if (!org) return;
	try {
		for (const l of await library(page, org))
			await page.request.delete(`/api/custom-library/${l.id}?organizationId=${org}`, {
				headers: originOf(page)
			});
	} catch {
		/* the test's own chapter is throwaway; best effort */
	}
});
async function orgOf(page: Page, buildId: string) {
	cleanupOrg = (await view(page, buildId)).build.organizationId;
	return cleanupOrg;
}

// ---- files built in code

const plateSpec = (name: string, seconds: number, grams: number) => ({
	name,
	prediction: seconds,
	weight: grams,
	filaments: { 1: grams },
	objects: [{ name: name.toLowerCase() }]
});
const sliced = (a: string, b: string) =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PETG'],
		plates: [plateSpec(a, 36000, 200), plateSpec(b, 18000, 100)]
	});
const cupHolder = () => sliced('CUP HOLDER BASE', 'CUP HOLDER ARM');
/** A project saved from the slicer without slicing: no time, no weight. */
const unsliced = (plate: string) =>
	makeProjectThreeMf({
		headerOnlySliceInfo: true,
		app: 'ElegooSlicer-1.0.0',
		plates: [{ name: plate, objects: [{ name: plate.toLowerCase() }] }]
	});
/** One sliced plate in two filaments. */
const twoTone = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PLA', 'PLA'],
		plates: [
			{
				name: 'TWO TONE',
				prediction: 7200,
				weight: 100,
				filaments: { 1: 60, 2: 40 },
				objects: [{ name: 'two tone' }]
			}
		]
	});
/** A sliced one-plate file padded past 1.5 MB with an incompressible entry. */
const bigFile = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PETG'],
		plates: [plateSpec('BIG PLATE', 7200, 100)],
		extra: { 'Metadata/padding.bin': new Uint8Array(randomBytes(1_700_000)) }
	});
const asFile = (buffer: Uint8Array, name: string) => ({
	name,
	mimeType: 'model/3mf',
	buffer: Buffer.from(buffer)
});

// ---- helpers

async function openFiles(page: Page, buildId: string) {
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
}

async function openSheet(page: Page, file: Uint8Array, fileName: string) {
	await page.getByTestId('add-custom-part').click();
	const dlg = page.getByTestId('custom-dialog');
	await expect(dlg).toBeVisible();
	await dlg.getByTestId('custom-3mf-file').setInputFiles(asFile(file, fileName));
	await expect(dlg.getByTestId('custom-name')).toBeVisible();
	return dlg;
}

async function fillColours(dlg: Locator) {
	const selects = dlg.locator(
		'select[aria-label^="Build color for"], select[aria-label="Color of the part"]'
	);
	for (let i = 0; i < (await selects.count()); i++)
		if (!(await selects.nth(i).inputValue())) await selects.nth(i).selectOption({ index: 1 });
}

/** Type into a time or grams box and leave it (the boxes commit on change). */
async function type(box: Locator, text: string) {
	await box.fill(text);
	await box.blur();
}

async function finishAdd(page: Page, dlg: Locator, name: string) {
	await dlg.getByTestId('custom-add').click();
	await expect(dlg).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: `Added "${name}"` })).toBeVisible();
}

/** Files tab: add a sliced custom part and tick "Save for new builds". */
async function addSavedCupHolder(page: Page) {
	const dlg = await openSheet(page, cupHolder(), 'cup holder.3mf');
	await dlg.getByTestId('custom-name').fill('Cup holder');
	await fillColours(dlg);
	await dlg.getByTestId('custom-save-library').check();
	await finishAdd(page, dlg, 'Cup holder');
}

const kpiLabel = async (page: Page, key: 'filament' | 'time') =>
	(await page.getByTestId(`header-kpi-${key}`).getAttribute('aria-label')) ?? '';
const timeEst = async (page: Page) =>
	Number(/of ~([\d,.]+) h/.exec(await kpiLabel(page, 'time'))![1].replace(',', ''));
const filamentEstKg = async (page: Page) =>
	Number(/of ~([\d,.]+) kg/.exec(await kpiLabel(page, 'filament'))![1].replace(',', ''));

const noOverflow = async (page: Page, what: string) => {
	for (const width of [390, 360]) {
		await page.setViewportSize({ width, height: 844 });
		const o = await page.evaluate(() => {
			const dlg = document.querySelector('[data-testid="custom-dialog"]');
			const vw = document.documentElement.clientWidth;
			// the first elements that stick out, to name the culprit when the page is too wide
			const wide = [...document.querySelectorAll('body *')]
				.filter(
					(el) => el.getBoundingClientRect().right > vw + 0.5 || el.scrollWidth > el.clientWidth + 1
				)
				.slice(0, 40)
				.map(
					(el) =>
						`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)}#${el.getAttribute('data-testid') ?? ''}@${Math.round(el.getBoundingClientRect().right)}`
				);
			const culprits: string[] = [];
			const form = document.querySelector('[data-testid="library-add-form"]');
			if (form && form.getBoundingClientRect().right > vw) {
				const all = [...form.querySelectorAll('*')] as HTMLElement[];
				for (const el of all) {
					const prev = el.style.display;
					el.style.display = 'none';
					if (form.getBoundingClientRect().right <= vw - 10)
						culprits.push(
							`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 20)}#${el.getAttribute('data-testid') ?? ''}`
						);
					el.style.display = prev;
				}
			}
			return {
				culprits,
				page: document.documentElement.scrollWidth - vw,
				dlg: dlg ? dlg.scrollWidth - dlg.clientWidth : 0,
				wide
			};
		});
		expect
			.soft(
				o.page,
				`${what}: page at ${width} px (wide: ${o.wide.slice(0, 3).join(' | ')}; culprits: ${o.culprits.join(' | ')})`
			)
			.toBeLessThanOrEqual(0);
		expect.soft(o.dlg, `${what}: sheet at ${width} px`).toBeLessThanOrEqual(0);
	}
};

/** Saved part made through the API (the create shape), for tests that look at the page or the access. */
async function seedSaved(page: Page, org: string, name: string, extra: object = {}) {
	const { template } = await libraryAll(page, org);
	const res = await page.request.post('/api/custom-library', {
		headers: originOf(page),
		data: {
			organizationId: org,
			name,
			plates: [
				{ name: 'Base', estSeconds: 5400, grams: 12.5, role: template.roles[0].key, runs: 1 },
				{ name: 'Arm', estSeconds: 1800, grams: 6, role: template.roles[0].key, runs: 1 }
			],
			...extra
		}
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { piece: LibJson }).piece;
}

// ---- tests

test('Build sheet: name first, unsliced note, typed time and grams, sliced prefill; rename; viewer', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'cpm-sheet');
	await orgOf(page, buildId);
	await openFiles(page, buildId);
	const time0 = await timeEst(page);
	const kg0 = await filamentEstKg(page);

	// An unsliced file: Name is the first field (with its hint), the note says to export the sliced file.
	let dlg = await openSheet(page, unsliced('ACTIVITY TABLE'), 'activity table.3mf');
	await expect(dlg.locator('input, select, textarea').first()).toHaveAttribute(
		'data-testid',
		'custom-name'
	);
	await expect(dlg.getByText('Shown on the Print tab and in saved parts.')).toBeVisible();
	await expect(dlg.getByTestId('custom-unsliced-note')).toContainText(/export the sliced file/i);
	await dlg.getByTestId('custom-name').fill('Activity table');
	await type(dlg.getByLabel('Print time'), '2h 30m');
	await type(dlg.getByTestId('custom-plate-grams'), '42,5');
	await fillColours(dlg);
	await finishAdd(page, dlg, 'Activity table');
	let v = await view(page, buildId);
	expect(customPlates(v)).toHaveLength(1);
	expect(customPlates(v)[0]).toMatchObject({
		estSeconds: 9000,
		estSource: 'manual',
		slicerGrams: 42.5,
		gramsSource: 'user'
	});
	// the cards round to an hour: 2.5 h more
	await expect
		.poll(async () => Math.abs((await timeEst(page)) - (time0 + 2.5)))
		.toBeLessThanOrEqual(1);

	// A sliced file: the boxes start with the file's numbers; an edited value wins, an untouched one stays.
	dlg = await openSheet(page, cupHolder(), 'cup holder.3mf');
	await expect(dlg.getByLabel('Print time').nth(0)).toHaveValue('10h 00m');
	await expect(dlg.getByTestId('custom-plate-grams').nth(0)).toHaveValue('200');
	await expect(dlg.getByLabel('Print time').nth(1)).toHaveValue('5h 00m');
	await expect(dlg.getByTestId('custom-plate-grams').nth(1)).toHaveValue('100');
	await dlg.getByTestId('custom-name').fill('Cup holder');
	await type(dlg.getByLabel('Print time').nth(1), '4h');
	await type(dlg.getByTestId('custom-plate-grams').nth(1), '90,5');
	await fillColours(dlg);
	await finishAdd(page, dlg, 'Cup holder');
	v = await view(page, buildId);
	const cup = customPlates(v).filter((p) => p.name.startsWith('Cup holder'));
	expect(cup[0]).toMatchObject({ estSeconds: 36000, slicerGrams: 200, gramsSource: 'file' });
	expect(cup[0].estSource).not.toBe('manual');
	expect(cup[1]).toMatchObject({
		estSeconds: 14400,
		estSource: 'manual',
		slicerGrams: 90.5,
		gramsSource: 'user'
	});
	// +42.5 g + 290.5 g = 0.33 kg on the filament card (one decimal), +2.5 h + 14 h on the time card
	await expect
		.poll(async () => Math.abs((await filamentEstKg(page)) - (kg0 + 0.333)))
		.toBeLessThanOrEqual(0.11);
	await expect
		.poll(async () => Math.abs((await timeEst(page)) - (time0 + 16.5)))
		.toBeLessThanOrEqual(1);

	// Rename: Cancel keeps the name, Save renames the part, its plates and the activity sentence.
	await openFiles(page, buildId);
	const piece = page.getByTestId('custom-piece').filter({ hasText: 'Activity table' });
	await piece.getByTestId('custom-rename').click();
	await piece.getByTestId('custom-rename-input').fill('Nothing');
	await piece.getByTestId('custom-rename-cancel').click();
	await expect(piece.getByTestId('custom-rename-input')).toHaveCount(0);
	await expect(piece).toContainText('Activity table');
	await piece.getByTestId('custom-rename').click();
	await piece.getByTestId('custom-rename-input').fill('Activity desk');
	await piece.getByTestId('custom-rename-save').click();
	const renamed = page.getByTestId('custom-piece').filter({ hasText: 'Activity desk' });
	await expect(renamed).toHaveCount(1);
	await expect(renamed.locator('b')).toHaveText('Activity desk');
	const plate = customPlates(await view(page, buildId)).find((p) =>
		p.name.startsWith('Activity desk')
	)!;
	expect(plate).toBeTruthy();
	await expect(
		page.getByRole('region', { name: `Plate ${plate.number}`, exact: true })
	).toContainText('Activity desk');
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
	await expect(
		page.locator('.group-head', { has: page.getByText(new RegExp(`^Plate ${plate.number} ·`)) })
	).toContainText('Activity desk');
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page.locator('.activity')).toContainText(
		'renamed the custom part "Activity table" to "Activity desk"'
	);

	// A viewer cannot rename.
	const pieceId = (await view(page, buildId)).customPieces.find(
		(c) => c.name === 'Activity desk'
	)!.id;
	await page.goto(chapterUrl);
	const email = uniqueEmail('cpm-viewer');
	const link = await invite(page, email, 'viewer');
	const joined = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		await openFiles(joined.page, buildId);
		await expect(joined.page.getByTestId('custom-piece')).toHaveCount(2);
		await expect(joined.page.getByTestId('custom-rename')).toHaveCount(0);
		const res = await joined.page.request.patch(`/api/builds/${buildId}/custom-pieces/${pieceId}`, {
			headers: originOf(joined.page),
			data: { name: 'Hijacked' }
		});
		expect(res.status()).toBe(403);
	} finally {
		await joined.context.close();
	}
	expect((await view(page, buildId)).customPieces.map((c) => c.name)).toContain('Activity desk');
});

test('Update saved part: later builds get the corrected values, earlier copies stay', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'cpm-update');
	const org = await orgOf(page, buildId);
	await openFiles(page, buildId);
	await addSavedCupHolder(page);

	// Build C takes the saved part now, with the original numbers.
	await page.goto(chapterUrl);
	const thirdId = await createBuild(page, 'Third chair', null);
	await openFiles(page, thirdId);
	await page.getByTestId('add-custom-part').click();
	await page.getByTestId('custom-dialog').getByTestId('custom-saved-add').click();
	await expect(page.getByTestId('custom-dialog')).toBeHidden();
	expect(customPlates(await view(page, thirdId)).map((p) => p.estSeconds)).toEqual([36000, 18000]);

	// Correct the first plate in the first build: 12 h and 250 g.
	await openFiles(page, buildId);
	const first = customPlates(await view(page, buildId))[0];
	const section = page.getByRole('region', { name: `Plate ${first.number}`, exact: true });
	// One box at a time: a save re-renders the card from the refreshed view, and that re-render writes
	// the stored value back into a box that is being typed in (a typed value that has not been committed
	// yet is lost). Wait for each save to show on the card before the next box is touched.
	await type(section.getByLabel(/^Slicer time/), '12h');
	await expect(section.getByTestId('time-override')).toBeVisible();
	await type(section.getByLabel(/^Grams/), '250');
	await expect(section.getByTestId('grams-override')).toBeVisible();
	await expect
		.poll(async () => customPlates(await view(page, buildId))[0])
		.toMatchObject({ estSeconds: 43200, slicerGrams: 250 });
	// Not saved yet.
	expect((await library(page, org))[0].plates[0]).toMatchObject({ estSeconds: 36000, grams: 200 });

	// Update saved part asks first; Cancel leaves it.
	const piece = page.getByTestId('custom-piece').filter({ hasText: 'Cup holder' });
	await piece.getByTestId('custom-update-saved').click();
	const ask = page.getByRole('dialog');
	await expect(ask).toContainText('Builds that already have it are not changed');
	await ask.getByRole('button', { name: 'Cancel' }).click();
	expect((await library(page, org))[0].plates[0]).toMatchObject({ estSeconds: 36000 });
	await piece.getByTestId('custom-update-saved').click();
	await page.getByRole('dialog').getByRole('button', { name: 'Update saved part' }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'Updated the saved part "Cup holder"' })
	).toBeVisible();
	expect((await library(page, org))[0].plates[0]).toMatchObject({ estSeconds: 43200, grams: 250 });

	// A second build adds it: corrected values. The copy in the third build is as it was.
	await page.goto(chapterUrl);
	const secondId = await createBuild(page, 'Second chair', null);
	await openFiles(page, secondId);
	await page.getByTestId('add-custom-part').click();
	await page.getByTestId('custom-dialog').getByTestId('custom-saved-add').click();
	await expect(page.getByTestId('custom-dialog')).toBeHidden();
	const second = customPlates(await view(page, secondId));
	expect(second.map((p) => p.estSeconds)).toEqual([43200, 18000]);
	expect(second[0].slicerGrams).toBe(250);
	const third = customPlates(await view(page, thirdId));
	expect(third.map((p) => p.estSeconds)).toEqual([36000, 18000]);
	expect(third[0].slicerGrams).toBe(200);
});

test('Custom parts page: Settings menu, add by hand and from files, new builds, inline edit', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'cpm-page');
	const org = await orgOf(page, buildId);
	const { template } = await libraryAll(page, org);
	const kit = template.parts[0];

	// The Settings menu opens the page.
	await page.goto(chapterUrl);
	await page.waitForLoadState('networkidle');
	await openNav(page);
	await page.getByTestId('workspace-settings-menu').click();
	await page.getByTestId('ws-custom-parts').click();
	await expect(page).toHaveURL(/\/pieces$/);
	await expect(page.getByRole('heading', { level: 2, name: 'Custom parts' })).toBeVisible();
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('saved-parts-empty')).toBeVisible();

	// By hand: two plates (a third is added and removed), comma grams, prints, replaces a kit part,
	// included in new builds.
	await expect(page.getByTestId('saved-part-add')).toBeEnabled();
	await page.getByTestId('saved-part-add').click();
	const form = page.getByTestId('library-add-form');
	await expect(form).toBeVisible();
	await form.getByTestId('library-name').fill('Hand rail');
	const plates = form.getByTestId('library-plate');
	await plates.nth(0).getByTestId('library-plate-name').fill('Rail');
	await type(plates.nth(0).getByLabel('Print time'), '1h 30m');
	await plates.nth(0).getByTestId('library-plate-grams').fill('12,5');
	await plates.nth(0).getByTestId('library-plate-runs').fill('2');
	await form.getByTestId('library-plate-add').click();
	await form.getByTestId('library-plate-add').click();
	await expect(plates).toHaveCount(3);
	await plates.nth(2).getByTestId('library-plate-remove').click();
	await expect(plates).toHaveCount(2);
	await plates.nth(1).getByTestId('library-plate-name').fill('Bracket');
	await type(plates.nth(1).getByLabel('Print time'), '45m');
	await plates.nth(1).getByTestId('library-plate-grams').fill('8');
	await plates.nth(1).getByTestId('library-plate-role').selectOption({ index: 1 });
	await form.getByTestId('library-replaces').locator('summary').click();
	await form
		.getByTestId('library-replaces')
		.getByRole('checkbox', { name: kit.name, exact: true })
		.check();
	await form.getByTestId('library-include-default').check();
	await form.getByTestId('library-create').click();
	await expect(page.getByTestId('saved-part-notice')).toContainText('Added "Hand rail"');
	await expect(form).toHaveCount(0);
	let lib = await library(page, org);
	const hand = lib.find((l) => l.name === 'Hand rail')!;
	expect(hand.isDefault).toBe(true);
	expect(hand.replaces).toEqual([kit.slug]);
	expect(hand.plates.map((p) => [p.estSeconds, p.grams, p.runs])).toEqual([
		[5400, 12.5, 2],
		[2700, 8, 1]
	]);

	// From an unsliced file: the note shows, the values are typed.
	await page.getByTestId('saved-part-add').click();
	await form
		.getByTestId('library-3mf-file')
		.setInputFiles(asFile(unsliced('WALL HOOK'), 'wall hook.3mf'));
	await expect(form.getByTestId('custom-unsliced-note')).toContainText(/export the sliced file/i);
	await expect(form.getByTestId('library-name')).toHaveValue('wall hook');
	await form.getByTestId('library-name').fill('Wall hook');
	await type(form.getByLabel('Print time'), '3h');
	await form.getByTestId('library-plate-grams').fill('55,5');
	await form.getByTestId('library-create').click();
	await expect(page.getByTestId('saved-part-notice')).toContainText('Added "Wall hook"');

	// From a sliced two-filament file: each filament gets a color; the numbers come from the file.
	await page.getByTestId('saved-part-add').click();
	await form.getByTestId('library-3mf-file').setInputFiles(asFile(twoTone(), 'two tone.3mf'));
	const slots = form.getByTestId('library-slots');
	await expect(slots).toBeVisible();
	await expect(form.getByTestId('library-plate-grams')).toHaveValue('100');
	await slots.locator('select').nth(0).selectOption({ index: 0 });
	await slots.locator('select').nth(1).selectOption({ index: 1 });
	await form.getByTestId('library-name').fill('Two tone');
	await form.getByTestId('library-include-default').check();
	await form.getByTestId('library-create').click();
	await expect(page.getByTestId('saved-part-notice')).toContainText('Added "Two tone"');
	await expect(page.getByTestId('saved-part')).toHaveCount(3);

	// A file larger than 1.5 MB is read like a small one (the inspect route takes the 3MF limit).
	const big = bigFile();
	expect(big.length).toBeGreaterThan(1_500_000);
	await page.getByTestId('saved-part-add').click();
	await form.getByTestId('library-3mf-file').setInputFiles(asFile(big, 'big plate.3mf'));
	await expect(form.getByTestId('library-name')).toHaveValue('big plate');
	await expect(form.getByTestId('library-plate-grams')).toHaveValue('100');
	await expect(form.getByLabel('Print time')).toHaveValue('2h 00m');
	await expect(form.getByRole('alert')).toHaveCount(0);
	await form.getByRole('button', { name: 'Cancel' }).first().click();
	await expect(form).toHaveCount(0);
	lib = await library(page, org);
	expect(lib.find((l) => l.name === 'Wall hook')).toMatchObject({
		totalSeconds: 10800,
		totalGrams: 55.5,
		isDefault: false
	});
	expect(lib.find((l) => l.name === 'Two tone')).toMatchObject({
		totalSeconds: 7200,
		totalGrams: 100,
		isDefault: true
	});

	// A new build made through the setup flow holds the two default parts with those numbers, and the
	// replaced kit part is Not printing.
	await page.goto(chapterUrl);
	const newId = await startBuild(page, 'Defaults chair');
	let v = await view(page, newId);
	expect(v.customPieces.map((c) => c.name).sort()).toEqual(['Hand rail', 'Two tone']);
	const plateOf = (name: string) => customPlates(v).filter((p) => p.name.startsWith(name));
	expect(plateOf('Hand rail').map((p) => p.estSeconds)).toEqual([5400, 2700]);
	expect(plateOf('Hand rail').map((p) => p.slicerGrams)).toEqual([12.5, 8]);
	expect(plateOf('Two tone')[0].estSeconds).toBe(7200);
	expect(Object.keys(plateOf('Two tone')[0].filamentGrams)).toHaveLength(2);
	expect(v.skipped.map((s) => s.slug)).toEqual([kit.slug]);
	await page.getByTestId('skip-setup').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${newId}$`));
	await keepPrintedVisible(page, newId);
	await page.goto(`/builds/${newId}/print`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('not-printing')).toContainText('Not printing (1)');
	await page.getByTestId('not-printing').locator('summary').click();
	await expect(page.getByTestId('not-printing-row')).toContainText(kit.name);

	// Inline edit: change a plate's time and grams; reload keeps them.
	await page.goto(`${teamPath(chapterUrl)}/pieces`);
	await page.waitForLoadState('networkidle');
	const row = page.getByTestId('saved-part').filter({ hasText: 'Hand rail' });
	await row.getByTestId('saved-part-edit').click();
	const edit = row.getByTestId('saved-part-edit-form');
	await expect(edit).toBeVisible();
	await type(edit.getByLabel('Print time').nth(0), '2h');
	await type(edit.getByTestId('saved-part-edit-grams').nth(0), '15,5');
	await edit.getByTestId('saved-part-edit-save').click();
	await expect(edit).toHaveCount(0);
	await expect(row.getByTestId('saved-part-plates')).toContainText('15.5 g');
	await page.reload();
	await page.waitForLoadState('networkidle');
	const again = page.getByTestId('saved-part').filter({ hasText: 'Hand rail' });
	await expect(again.getByTestId('saved-part-plates')).toContainText('15.5 g');
	const saved = (await library(page, org)).find((l) => l.name === 'Hand rail')!;
	expect(saved.plates.map((p) => [p.estSeconds, p.grams])).toEqual([
		[7200, 15.5],
		[2700, 8]
	]);

	// A build made afterwards gets the new numbers.
	await page.goto(chapterUrl);
	const laterId = await createBuild(page, 'Later chair', null);
	v = await view(page, laterId);
	expect(plateOf('Hand rail').map((p) => [p.estSeconds, p.slicerGrams])).toEqual([
		[7200, 15.5],
		[2700, 8]
	]);
});

test('Custom parts page: viewer and outsider are kept out, in the page and in the API', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'cpm-access');
	const org = await orgOf(page, buildId);
	await openFiles(page, buildId);
	await addSavedCupHolder(page);
	const saved = (await library(page, org))[0];
	const pieceId = (await view(page, buildId)).customPieces[0].id;
	const createBody = (organizationId: string) => ({
		organizationId,
		name: 'Sneaky',
		plates: [{ name: 'One', estSeconds: 600, grams: 5, role: 'primary', runs: 1 }]
	});

	// The owner: multipart bodies to inspect are refused with 415.
	const mp = await page.request.post(
		`/api/custom-library/inspect?organizationId=${org}&name=a.3mf`,
		{
			headers: originOf(page),
			multipart: {
				file: { name: 'a.3mf', mimeType: 'model/3mf', buffer: Buffer.from(cupHolder()) }
			}
		}
	);
	expect(mp.status()).toBe(415);

	/** The same four calls for someone who may not edit: `expected` is the status they must get. */
	async function expectRefused(who: Page, expected: number) {
		const h = originOf(who);
		const calls = {
			create: await who.request.post('/api/custom-library', { headers: h, data: createBody(org) }),
			inspect: await who.request.post(
				`/api/custom-library/inspect?organizationId=${org}&name=a.3mf`,
				{
					headers: { ...h, 'content-type': 'application/octet-stream' },
					data: Buffer.from(cupHolder())
				}
			),
			patch: await who.request.patch(`/api/custom-library/${saved.id}`, {
				headers: h,
				data: { organizationId: org, plates: [{ index: 0, estSeconds: 60, grams: 1 }] }
			}),
			refresh: await who.request.post(`/api/custom-library/${saved.id}/refresh`, {
				headers: h,
				data: { organizationId: org, buildId, pieceId }
			})
		};
		for (const [what, res] of Object.entries(calls))
			expect(res.status(), `${what} answers ${expected}`).toBe(expected);
	}

	await page.goto(chapterUrl);
	const email = uniqueEmail('cpm-viewer');
	const link = await invite(page, email, 'viewer');
	const joined = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		const vp = joined.page;
		await vp.goto(`${teamPath(chapterUrl)}/pieces`);
		await vp.waitForLoadState('networkidle');
		await expect(vp.getByTestId('saved-part')).toContainText('Cup holder');
		for (const id of [
			'saved-part-add',
			'saved-part-edit',
			'saved-part-rename',
			'saved-part-default',
			'saved-part-delete'
		])
			await expect(vp.getByTestId(id)).toHaveCount(0);
		await expectRefused(vp, 403);
	} finally {
		await joined.context.close();
	}

	const context = await newClientContext(browser);
	const op = await context.newPage();
	try {
		await signUp(op, 'Otto Outsider', uniqueEmail('cpm-outsider'));
		await expectRefused(op, 404);
	} finally {
		await context.close();
	}

	const after = (await library(page, org))[0];
	expect(after.name).toBe('Cup holder');
	expect(after.plates[0]).toMatchObject({ estSeconds: 36000, grams: 200 });
	expect(await library(page, org)).toHaveLength(1);
});

test('The Settings menu of My builds opens the Custom parts page', async ({ page }) => {
	await signUp(page, 'Pia Personal', uniqueEmail('cpm-personal'));
	await expect(page.getByRole('heading', { level: 1, name: 'My builds' })).toBeVisible();
	await page.waitForLoadState('networkidle');
	await openNav(page);
	await page.getByTestId('workspace-settings-menu').click();
	await page.getByTestId('ws-custom-parts').click();
	await expect(page).toHaveURL(/\/pieces$/);
	await expect(page.getByRole('heading', { level: 2, name: 'Custom parts' })).toBeVisible();
	await expect(page.getByTestId('saved-parts-empty')).toBeVisible();
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('the Custom parts page, its forms, the Settings menu and the build sheet stay inside the screen', async ({
		page
	}) => {
		const { chapterUrl, buildId } = await ownerWithBuild(page, 'cpm-phone');
		const org = await orgOf(page, buildId);
		await seedSaved(page, org, 'A saved custom part with quite a long name to wrap on a phone');

		await page.goto(`${teamPath(chapterUrl)}/pieces`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('saved-part')).toBeVisible();
		await noOverflow(page, 'Custom parts page');

		// Settings menu open.
		await openNav(page);
		await page.getByTestId('workspace-settings-menu').click();
		await expect(page.getByTestId('ws-custom-parts')).toBeVisible();
		await noOverflow(page, 'Settings menu');
		await page.getByTestId('workspace-settings-menu').click();
		await expect(page.getByTestId('ws-custom-parts')).toBeHidden();
		const toggle = page.getByTestId('nav-toggle');
		if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'true')
			await toggle.click();

		// The add form, by hand and with files.
		await expect(page.getByTestId('saved-part-add')).toBeEnabled();
		await page.getByTestId('saved-part-add').click();
		const form = page.getByTestId('library-add-form');
		await form.getByTestId('library-name').fill('A hand made part with a long name to wrap');
		await form.getByTestId('library-plate-add').click();
		await expect(form.getByTestId('library-plate')).toHaveCount(2);
		await noOverflow(page, 'add form by hand');
		await form.getByTestId('library-plate').nth(0).scrollIntoViewIfNeeded();
		await form.getByRole('button', { name: 'Cancel' }).first().click();
		await page.getByTestId('saved-part-add').click();
		await form
			.getByTestId('library-3mf-file')
			.setInputFiles(
				asFile(unsliced('WALL HOOK WITH A LONG NAME'), 'a very long file name for the phone.3mf')
			);
		await expect(form.getByTestId('custom-unsliced-note')).toBeVisible();
		await noOverflow(page, 'add form with an unsliced file');
		await form.getByTestId('library-clear-file').click();
		await form.getByTestId('library-3mf-file').setInputFiles(asFile(twoTone(), 'two tone.3mf'));
		await expect(form.getByTestId('library-slots')).toBeVisible();
		await noOverflow(page, 'add form with a two-filament file');
		await form.getByRole('button', { name: 'Cancel' }).first().click();
		await expect(form).toHaveCount(0);

		// Inline edit open.
		await page.getByTestId('saved-part-edit').click();
		await expect(page.getByTestId('saved-part-edit-form')).toBeVisible();
		await noOverflow(page, 'inline edit');

		// The build sheet with the time and grams boxes.
		await openFiles(page, buildId);
		const dlg = await openSheet(
			page,
			unsliced('ACTIVITY TABLE'),
			'a very long file name for the phone check.3mf'
		);
		await expect(dlg.getByLabel('Print time')).toBeVisible();
		await expect(dlg.getByTestId('custom-plate-grams')).toBeVisible();
		await noOverflow(page, 'build sheet (unsliced)');
		await dlg.getByRole('button', { name: 'Cancel' }).last().click();
		await expect(dlg).toBeHidden();
		const dlg2 = await openSheet(page, cupHolder(), 'cup holder.3mf');
		await noOverflow(page, 'build sheet (sliced)');
		await dlg2.getByRole('button', { name: 'Cancel' }).last().click();
	});
});
