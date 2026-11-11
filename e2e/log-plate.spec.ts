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
