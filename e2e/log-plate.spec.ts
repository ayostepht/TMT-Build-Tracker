import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import type { Page } from '@playwright/test';

/** Print tab grouped by Plate; returns the first plate group's "Log plate N printed" button and N. */
async function firstPlateLog(page: Page) {
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page.getByTestId('ready-to-print')).toHaveCount(0);
	await page.getByLabel('Group by').selectOption('plate');
	const heads = page
		.locator('.group-head')
		.getByRole('button', { name: /^Log plate \d+ printed$/ });
	await expect(heads.first()).toBeVisible();
	const name = (await heads.first().getAttribute('aria-label')) as string;
	const plate = /\d+/.exec(name)![0];
	return { plate, button: heads.first(), name };
}

test('Log plate printed from a plate group: one-tap Success and undo', async ({ page }) => {
	await ownerWithBuild(page);
	const { plate, name } = await firstPlateLog(page);
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
	await ownerWithBuild(page);
	const { plate, button } = await firstPlateLog(page);
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
	const log = todo.getByRole('button', { name: /^Log plate \d+ printed$/ });
	await expect(log).toBeVisible();
	await log.click();
	await expect(page.getByRole('dialog').getByRole('button', { name: 'Success' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});
