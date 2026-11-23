import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild, row } from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';
import type { Page } from '@playwright/test';

/**
 * Custom parts (issue 113): a maker adds an accessory or beta replacement from its own 3MF on the Files
 * tab; its plates join the Print tab as ordinary plates. Every test makes its own build. The 3MFs are
 * built in code (no MakeGood data).
 */

interface ViewJson {
	plates: {
		number: number;
		name: string;
		source: string;
		parts: string[];
		estSeconds: number | null;
		runs: number;
		perPartRuns: boolean;
	}[];
	parts: { slug: string; name: string; custom?: boolean }[];
	state: Record<string, { status: string }>;
	skipped: { slug: string; name: string }[];
	customPieces: {
		id: string;
		name: string;
		removable: boolean;
		plates: number[];
		parts: string[];
	}[];
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

const kpi = (page: Page, key: 'parts' | 'filament' | 'time') =>
	page.getByTestId(`header-kpi-${key}`);
const label = async (page: Page, key: 'parts' | 'filament' | 'time') =>
	(await kpi(page, key).getAttribute('aria-label')) ?? '';
/** "Parts printed: 3 of 33" -> [3, 33]. */
async function partsCount(page: Page): Promise<[number, number]> {
	const m = /: (\d+) of (\d+)/.exec(await label(page, 'parts'))!;
	return [Number(m[1]), Number(m[2])];
}
/** The estimate in the time card: "... 0 h of ~382 h" -> 382. */
async function timeEst(page: Page) {
	return Number(/of ~([\d,.]+) h/.exec(await label(page, 'time'))![1].replace(',', ''));
}
async function filamentEstKg(page: Page) {
	return Number(/of ~([\d,.]+) kg/.exec(await label(page, 'filament'))![1].replace(',', ''));
}

/** Two sliced plates: 10 h and 200 g, 5 h and 100 g (all in filament 1). */
const slicedFile = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PETG'],
		plates: [
			{
				name: 'CUP HOLDER BASE',
				prediction: 36000,
				weight: 200,
				filaments: { 1: 200 },
				objects: [{ name: 'Cup holder base' }]
			},
			{
				name: 'CUP HOLDER ARM',
				prediction: 18000,
				weight: 100,
				filaments: { 1: 100 },
				objects: [{ name: 'Cup holder arm' }]
			}
		]
	});

const unslicedFile = () =>
	makeProjectThreeMf({
		plates: [{ name: 'ACTIVITY TABLE', objects: [{ name: 'Activity table' }] }]
	});

async function openFiles(page: Page, buildId: string) {
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
}

/** Opens the add sheet and chooses the file; stops at the review step. */
async function openSheet(page: Page, file: Uint8Array, fileName: string) {
	await page.getByTestId('add-custom-part').click();
	const dlg = page.getByTestId('custom-dialog');
	await expect(dlg).toBeVisible();
	await dlg.getByTestId('custom-3mf-file').setInputFiles({
		name: fileName,
		mimeType: 'model/3mf',
		buffer: Buffer.from(file)
	});
	await expect(dlg.getByTestId('custom-name')).toBeVisible();
	return dlg;
}

/** Gives every colour select that has no suggestion the first colour of the build. */
async function fillColours(dlg: ReturnType<Page['getByTestId']>) {
	const selects = dlg.locator(
		'select[aria-label^="Build color for"], select[aria-label="Color of the part"]'
	);
	for (let i = 0; i < (await selects.count()); i++) {
		if (!(await selects.nth(i).inputValue())) await selects.nth(i).selectOption({ index: 1 });
	}
}

/** Add a custom part from the Files tab; `replaces` are kit part names to tick. */
async function addPiece(
	page: Page,
	o: { file: Uint8Array; fileName: string; name: string; replaces?: string[] }
) {
	const dlg = await openSheet(page, o.file, o.fileName);
	await dlg.getByTestId('custom-name').fill(o.name);
	await fillColours(dlg);
	if (o.replaces?.length) {
		await dlg.getByTestId('custom-replaces').locator('summary').click();
		for (const n of o.replaces) await dlg.getByRole('checkbox', { name: n, exact: true }).check();
	}
	await dlg.getByTestId('custom-add').click();
	await expect(dlg).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: `Added "${o.name}"` })).toBeVisible();
}

const customPlates = (v: ViewJson) => v.plates.filter((p) => p.source.startsWith('custom:'));

async function openPrintByPlate(page: Page, buildId: string) {
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
}
const head = (page: Page, n: number) =>
	page.locator('.group-head', { has: page.getByText(new RegExp(`^Plate ${n} ·`)) });

/** Log plate `n` as a Success from its group head. */
async function logPlate(page: Page, n: number) {
	await head(page, n)
		.getByRole('button', { name: `Log a print on plate ${n}`, exact: true })
		.click();
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
}

/** A kit part (name and slug) on a multi-part plate, to be the one a custom part replaces. */
function kitPartToReplace(v: ViewJson) {
	const slug = v.plates.find((p) => !p.source.startsWith('custom:') && p.parts.length >= 3)!
		.parts[0];
	return { slug, name: v.parts.find((p) => p.slug === slug)!.name };
}

test('A sliced two-plate file becomes a custom part that replaces a kit part', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'custom');
	const v0 = await view(page, buildId);
	const kit = kitPartToReplace(v0);
	await openFiles(page, buildId);
	await expect(page.getByTestId('custom-pieces')).toHaveCount(0);
	const [, total0] = await partsCount(page);

	await addPiece(page, {
		file: slicedFile(),
		fileName: 'cup holder.3mf',
		name: 'Cup holder',
		replaces: [kit.name]
	});

	// Files tab: listed with its file, plates and the part it replaces; its plates are tagged Custom.
	const piece = page.getByTestId('custom-piece');
	await expect(piece).toHaveCount(1);
	await expect(piece).toContainText('Cup holder');
	await expect(piece).toContainText('cup holder.3mf');
	await expect(piece).toContainText('2 plates');
	await expect(piece).toContainText(`Replaces ${kit.name}`);
	const v1 = await view(page, buildId);
	const plates = customPlates(v1);
	expect(plates).toHaveLength(2);
	expect(plates.map((p) => p.estSeconds)).toEqual([36000, 18000]);
	await expect(page.getByTestId('custom-tag')).toHaveCount(2);
	await expect(
		page.getByRole('region', { name: `Plate ${plates[0].number}`, exact: true })
	).toContainText('CUP HOLDER BASE');
	// Parts printed: the replaced part left, the two custom parts joined.
	await expect.poll(async () => (await partsCount(page))[1]).toBe(total0 - 1 + 2);

	// Print tab: the replaced part is under "Not printing"; the custom plates are ordinary plates.
	await openPrintByPlate(page, buildId);
	const group = page.getByTestId('not-printing');
	await expect(group).toContainText('Not printing (1)');
	await group.locator('summary').click();
	await expect(group.getByTestId('not-printing-row')).toContainText(kit.name);
	const n = plates[0].number;
	await expect(head(page, n)).toBeVisible();
	await expect(head(page, n)).toContainText('200 g');
	await expect(head(page, n)).toContainText('10 h');
	// A one-part plate has no heading badge (#115): its part row's badge stands for the plate.
	await expect(row(page, plates[0].parts[0]).getByTestId('part-status')).toBeVisible();

	// Log a print on the custom plate: its part is Printed and the parts-printed count rises.
	const [printed0] = await partsCount(page);
	await logPlate(page, n);
	await expect.poll(async () => (await partsCount(page))[0]).toBe(printed0 + 1);
	await expect(row(page, plates[0].parts[0])).toHaveAttribute('data-s', 'Printed');
	expect((await view(page, buildId)).state[plates[0].parts[0]].status).toBe('Printed');

	// Switching the plate layout keeps the custom plates and the piece.
	await openFiles(page, buildId);
	await page.getByTestId('plate-layout').selectOption({ label: 'Bambu H2D / H2S (22 plates)' });
	// The build has a logged print, so the change asks first.
	await page.getByRole('dialog').getByRole('button', { name: 'Change plates' }).click();
	await expect(page.getByTestId('layout-name')).toContainText("MakeGood's Bambu H2D");
	await expect(page.getByTestId('custom-piece')).toHaveCount(1);
	// The printed plate is folded away on the Files tab; the other one is still tagged.
	await expect(page.getByTestId('custom-tag')).toHaveCount(1);
	await expect
		.poll(async () => customPlates(await view(page, buildId)).map((p) => p.name))
		.toEqual(['Cup holder - CUP HOLDER BASE', 'Cup holder - CUP HOLDER ARM']);
	expect((await view(page, buildId)).state[plates[0].parts[0]].status).toBe('Printed');

	// The Design tab lists kit parts only: no custom part there.
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('main')).not.toContainText('Cup holder');
	await expect(page.locator('main')).not.toContainText('Custom');

	// Activity has the sentence.
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page.locator('.activity')).toContainText('added the custom piece "Cup holder"');
});

test('Totals follow the file: time and grams of its plates are added', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'custom-totals');
	await openFiles(page, buildId);
	const time0 = await timeEst(page);
	const kg0 = await filamentEstKg(page);
	await addPiece(page, { file: slicedFile(), fileName: 'totals.3mf', name: 'Totals piece' });
	// +15 h and +0.3 kg (the cards round: 1 h / 0.1 kg of slack).
	await expect
		.poll(async () => Math.abs((await timeEst(page)) - (time0 + 15)))
		.toBeLessThanOrEqual(1);
	await expect
		.poll(async () => Math.abs((await filamentEstKg(page)) - (kg0 + 0.3)))
		.toBeLessThanOrEqual(0.11);
});

test('Removing an unlogged piece brings back the replaced part; a logged one cannot be removed', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'custom-remove');
	const kit = kitPartToReplace(await view(page, buildId));
	await openFiles(page, buildId);
	const [, total0] = await partsCount(page);

	await addPiece(page, {
		file: slicedFile(),
		fileName: 'one.3mf',
		name: 'Removable',
		replaces: [kit.name]
	});
	await page.getByTestId('custom-remove').click();
	const dlg = page.getByTestId('custom-remove-dialog');
	await expect(dlg).toContainText('Remove "Removable"?');
	await expect(dlg.getByTestId('custom-restore')).toBeChecked();
	await expect(dlg).toContainText(`Bring back 1 replaced part: ${kit.name}`);
	await dlg.getByTestId('custom-remove-confirm').click();
	await expect(dlg).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: 'Removed "Removable"' })).toContainText(
		'brought back 1 part'
	);
	await expect(page.getByTestId('custom-pieces')).toHaveCount(0);
	await expect.poll(async () => (await partsCount(page))[1]).toBe(total0);
	const v = await view(page, buildId);
	expect(customPlates(v)).toHaveLength(0);
	expect(v.skipped).toHaveLength(0);
	expect(v.parts.some((p) => p.slug === kit.slug)).toBe(true);

	// A piece with a print log: no removal, "Mark Not printing" instead.
	await addPiece(page, { file: slicedFile(), fileName: 'two.3mf', name: 'Logged piece' });
	const plate = customPlates(await view(page, buildId))[0];
	await openPrintByPlate(page, buildId);
	await logPlate(page, plate.number);
	await expect.poll(async () => (await view(page, buildId)).customPieces[0].removable).toBe(false);
	const pieceId = (await view(page, buildId)).customPieces[0].id;
	const res = await page.request.delete(`/api/builds/${buildId}/custom-pieces/${pieceId}`, {
		headers: { origin: new URL(page.url()).origin }
	});
	expect(res.status()).toBe(409);

	await openFiles(page, buildId);
	await page.getByTestId('custom-remove').click();
	await expect(dlg).toContainText('cannot be deleted');
	await expect(dlg.getByTestId('custom-restore')).toHaveCount(0);
	await dlg.getByTestId('custom-remove-confirm').click();
	await expect(dlg).toBeHidden();
	await expect.poll(async () => (await view(page, buildId)).skipped.length).toBe(2);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('not-printing')).toContainText('Not printing (2)');
	await page.getByTestId('not-printing').locator('summary').click();
	await expect(page.getByTestId('not-printing-row').first()).toContainText('Custom');
});

test('An unsliced file is added without time or grams; they are typed on its plate', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'custom-unsliced');
	await openFiles(page, buildId);
	const dlg = await openSheet(page, unslicedFile(), 'activity table.3mf');
	await expect(dlg.getByTestId('custom-unsliced-note')).toBeVisible();
	await expect(dlg.getByTestId('custom-name')).toHaveValue('activity table');
	await dlg.getByTestId('custom-name').fill('Activity table');
	await dlg.getByLabel('Color of the part').selectOption({ index: 0 });
	await dlg.getByTestId('custom-add').click();
	await expect(dlg).toBeHidden();
	await expect(page.getByTestId('custom-piece')).toContainText('not sliced');

	const plate = customPlates(await view(page, buildId))[0];
	expect(plate.estSeconds).toBeNull();
	// Grams and time are typed on the plate card of the Files tab.
	await openFiles(page, buildId);
	const section = page.getByRole('region', { name: `Plate ${plate.number}`, exact: true });
	await expect(section).toContainText('Type the grams and time from your slicer.');
	const grams = section.getByLabel(/^Grams/);
	await grams.fill('85');
	await grams.press('Enter');
	await expect(section.getByTestId('plate-grams')).toContainText('85 g');
	const time = section.getByLabel(/^Slicer time/);
	await time.fill('2h 30m');
	await time.press('Enter');
	await expect(section).toContainText('2.5 h');
	await expect.poll(async () => customPlates(await view(page, buildId))[0].estSeconds).toBe(9000);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('the add sheet and the Files tab with a piece stay inside the screen', async ({ page }) => {
		const { buildId } = await ownerWithBuild(page, 'custom-phone');
		const kit = kitPartToReplace(await view(page, buildId));
		await openFiles(page, buildId);
		const noOverflow = async (what: string) => {
			for (const width of [390, 360]) {
				await page.setViewportSize({ width, height: 844 });
				const o = await page.evaluate(() => {
					const dlg = document.querySelector('[data-testid="custom-dialog"]');
					return {
						page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
						dlg: dlg ? dlg.scrollWidth - dlg.clientWidth : 0
					};
				});
				expect(o.page, `${what}: page at ${width} px`).toBeLessThanOrEqual(0);
				expect(o.dlg, `${what}: sheet at ${width} px`).toBeLessThanOrEqual(0);
			}
		};

		const dlg = await openSheet(
			page,
			slicedFile(),
			'a very long file name for the phone check.3mf'
		);
		await dlg.getByTestId('custom-name').fill('A custom part with quite a long name to wrap');
		await fillColours(dlg);
		await dlg.getByTestId('custom-replaces').locator('summary').click();
		await dlg.getByRole('checkbox', { name: kit.name, exact: true }).check();
		await noOverflow('add sheet');
		await dlg.getByTestId('custom-add').scrollIntoViewIfNeeded();
		await dlg.getByTestId('custom-add').click();
		await expect(dlg).toBeHidden();

		await expect(page.getByTestId('custom-piece')).toBeVisible();
		await noOverflow('Files tab');
	});
});
