import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild } from './helpers';
import type { Page } from '@playwright/test';

/** Print tab grouped by Plate; returns the first plate group's "Log plate N printed" button and N. */
async function firstPlateLog(page: Page, buildId: string) {
	await keepPrintedVisible(page, buildId);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page.getByTestId('ready-to-print')).toHaveCount(0);
	await page.getByLabel('Group by').selectOption('plate');
	const heads = page
		.locator('.group-head')
		.getByRole('button', { name: /^Log a print on plate \d+$/ });
	await expect(heads.first()).toBeVisible();
	const name = (await heads.first().getAttribute('aria-label')) as string;
	const plate = /\d+/.exec(name)![0];
	return { plate, button: heads.first(), name };
}

test('Log plate printed from a plate group: one-tap Success and undo', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page);
	const { plate, name } = await firstPlateLog(page, buildId);
	const inHead = page.locator('.group-head').getByRole('button', { name, exact: true });

	await inHead.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	// Success is preselected, so Save works straight away.
	await expect(sheet.getByRole('button', { name: 'Success' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(sheet).toContainText('printed');
	const save = sheet.getByRole('button', { name: 'Save', exact: true });
	await expect(save).toBeEnabled();
	await save.click();
	await expect(sheet).toBeHidden();
	await expect(page.locator('.toasts')).toContainText(`Logged plate ${plate} · Success`);
	// The plate is done: its group no longer offers the log button.
	await expect(inHead).toHaveCount(0);
	await expect(page.locator('.row[data-s="Printed"]').first()).toBeVisible();

	// Undo brings the plate back.
	await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
	await expect(inHead).toHaveCount(1);

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.locator('.overall-top')).toContainText('printed');
});

test('A plate run shows in the Print log of a part on that plate, tagged with the plate', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page);
	const { plate, button } = await firstPlateLog(page, buildId);
	await button.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeHidden();

	const part = page
		.locator('.row[data-s="Printed"]')
		.filter({ hasText: `Plate ${plate}` })
		.first();
	await part.getByRole('button', { name: /^Details for / }).click();
	const log = part.locator('.detail table.log');
	await expect(log).toContainText(new RegExp(`Plate ${plate} · `));
	await expect(part.locator('.detail .empty')).toHaveCount(0);
});

test('A part detail offers Log plate printed and logs the run', async ({ page }) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	const todo = page.locator('.row[data-s="To print"]').first();
	await todo.getByRole('button', { name: /^Details for/ }).click();
	const log = todo.getByRole('button', { name: /^Log a print on plate \d+$/ });
	await expect(log).toBeVisible();
	await log.click();
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Success' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('Choosing Failed does not prefill the plate grams (empty counts as 0 g)', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'failedgrams');
	const { button } = await firstPlateLog(page, buildId);
	await button.click();
	const sheet = page.getByRole('dialog');
	const grams = sheet.getByLabel('Filament used (g)');
	await sheet.getByRole('button', { name: 'Failed', exact: true }).click();
	await expect(grams).toHaveValue('');
	await expect(grams).toHaveAttribute('placeholder', 'optional');
	await expect(sheet).toContainText('Left empty it counts as 0 g');
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(page.locator('.row[data-s="Reprint"]').first()).toBeVisible();
});

test('a plate printed during this visit stays visible, marked, until reload (Hide printed on)', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'justnow');
	await page.goto(`/builds/${buildId}/print`);
	await page.getByLabel('Group by').selectOption('plate');
	const log = page.getByRole('button', { name: /^Log a print on plate \d+$/ });
	await log.first().click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	// The build is now under way, so Printed parts are hidden by default, but not the ones just done.
	await expect(page.getByLabel('Hide printed').first()).toBeChecked();
	await expect(page.getByTestId('printed-just-now').first()).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('printed-just-now')).toHaveCount(0);
	await expect(page.locator('.row[data-s="Printed"]')).toHaveCount(0);
});

test('A fractional slicer estimate prefills a value the field takes, and Save works untouched', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'fraction');
	const { plate, button } = await firstPlateLog(page, buildId);
	const r = await page.request.patch(`/api/builds/${buildId}/plates/${plate}`, {
		data: { slicerGrams: 162.52 },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(r.ok()).toBe(true);
	await page.reload();
	await page.getByLabel('Group by').selectOption('plate');
	await button.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByLabel('Filament used (g)')).toHaveValue('162.52');
	await sheet.getByRole('button', { name: 'Success', exact: true }).click();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	const v = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		runs: { grams: number | null }[];
	};
	expect(v.runs.map((x) => x.grams)).toEqual([162.52]);
});

test('Grams that are not a number keep the sheet open with the message; a decimal comma is accepted', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'badgrams');
	const { button } = await firstPlateLog(page, buildId);
	await button.click();
	const sheet = page.getByRole('dialog');
	const grams = sheet.getByLabel('Filament used (g)');
	const save = sheet.getByRole('button', { name: 'Save', exact: true });
	const msg = sheet.getByText('Enter the grams as a number, 0 or more');
	for (const bad of ['abc', '-5']) {
		await grams.fill(bad);
		await expect(msg).toBeVisible();
		await save.click();
		await expect(sheet).toBeVisible();
		await expect(grams).toBeFocused();
	}
	await grams.fill('162,5');
	await expect(msg).toHaveCount(0);
	await save.click();
	await expect(sheet).toBeHidden();
	const v = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		runs: { grams: number | null }[];
	};
	expect(v.runs.map((x) => x.grams)).toEqual([162.5]);
});

test('A one-part-per-run plate taken off the printer after run 1 reads Partly printed, not To print', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'rimstop');
	const headers = { origin: new URL(page.url()).origin };
	const post = (path: string, data: unknown) =>
		page.request.post(`/api/builds/${buildId}/${path}`, { data, headers });
	expect(
		(
			await post('runs', {
				plateNumber: 13,
				partSlug: 'rims-1-4',
				date: '2026-11-03',
				result: 'Success'
			})
		).ok()
	).toBe(true);
	expect((await post('printing', { action: 'start', slugs: ['rims-1-4'] })).ok()).toBe(true);
	expect((await post('printing', { action: 'stop', slugs: ['rims-1-4'] })).ok()).toBe(true);
	const v = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		state: Record<string, { status: string; startedAt: string | null }>;
	};
	expect(v.state['rims-1-4']).toMatchObject({ status: 'Printing', startedAt: null });

	await keepPrintedVisible(page, buildId);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await page.getByLabel('Group by').selectOption('plate');
	await expect(
		page.locator('.group-head', { hasText: 'Plate 13' }).getByText('Partly printed')
	).toBeVisible();
});
