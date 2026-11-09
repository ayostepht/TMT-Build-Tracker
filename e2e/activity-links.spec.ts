import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import type { Page } from '@playwright/test';

/** Logs the first plate group on the Print tab; returns its number. */
async function logFirstPlate(page: Page): Promise<string> {
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await page.getByLabel('Group by').selectOption('plate');
	const btn = page
		.locator('.group-head')
		.getByRole('button', { name: /^Log plate \d+ printed$/ })
		.first();
	await expect(btn).toBeVisible();
	const plate = /\d+/.exec((await btn.getAttribute('aria-label')) as string)![0];
	await btn.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	return plate;
}

test('A plate in the Activity feed links to its plate group on the Print tab', async ({ page }) => {
	await ownerWithBuild(page);
	const plate = await logFirstPlate(page);
	await page.getByRole('link', { name: 'Overview' }).click();

	await page
		.locator('.activity')
		.getByRole('link', { name: `plate ${plate}` })
		.first()
		.click();
	await expect(page).toHaveURL(new RegExp(`/print#plate-${plate}$`));
	const group = page.locator(`#plate-${plate}`);
	await expect(group).toBeInViewport();
	await expect(group).toHaveClass(/flash/);
	await expect(group).not.toHaveClass(/flash/, { timeout: 5000 });

	// Grouping is a per-visit override: set Role, follow the link again, Role comes back on reload.
	await page.getByLabel('Group by').selectOption('role');
	await expect(page.locator('.group-head h2').first()).not.toHaveText(/^Plate/);
	await page.getByRole('link', { name: 'Overview' }).click();
	await page
		.locator('.activity')
		.getByRole('link', { name: `plate ${plate}` })
		.first()
		.click();
	await expect(page.getByLabel('Group by')).toHaveValue('plate');
	await expect(page.locator(`#plate-${plate}`)).toBeInViewport();
	// A reload keeps the hash (and so the override); a plain Print tab visit shows the saved toolbar.
	await page.goto(page.url().split('#')[0]);
	await expect(page.getByLabel('Group by')).toHaveValue('role');
});

test('A hash link shows the plate despite filters, without saving the overrides', async ({
	page
}) => {
	await ownerWithBuild(page);
	const plate = await logFirstPlate(page);
	// Hide printed would hide the just-printed plate; the link still lands on it.
	await page.getByLabel('Hide printed').check();
	await page.getByLabel('Group by').selectOption('role');
	await page.getByRole('link', { name: 'Overview' }).click();
	await page
		.locator('.activity')
		.getByRole('link', { name: `plate ${plate}` })
		.first()
		.click();
	await expect(page.locator(`#plate-${plate}`)).toBeInViewport();
	await expect(page.getByLabel('Hide printed')).not.toBeChecked();
	// A reload keeps the hash (and so the override); a plain Print tab visit shows the saved toolbar.
	await page.goto(page.url().split('#')[0]);
	await expect(page.getByLabel('Hide printed')).toBeChecked();
	await expect(page.getByLabel('Group by')).toHaveValue('role');
});

test('A part name in the Activity feed opens its detail on the Print tab', async ({ page }) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	const row = page.locator('.row[data-s="To print"]').first();
	const slug = (await row.getAttribute('data-id')) as string;
	await row.getByRole('button', { name: 'Printing', exact: true }).click();
	await page.getByRole('link', { name: 'Overview' }).click();

	await page.locator(`.activity a[href$="#part-${slug}"]`).first().click();
	const target = page.locator(`#part-${slug}`);
	await expect(target).toBeInViewport();
	await expect(target.locator('.detail')).toBeVisible();
	await expect(target).toHaveClass(/flash/);
});

test('Unknown plate and part hashes do nothing', async ({ page }) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	const url = page.url();
	await page.goto(`${url}#plate-9999`);
	await expect(page.locator('.flash')).toHaveCount(0);
	await page.goto(`${url}#part-nope`);
	await expect(page.locator('.flash')).toHaveCount(0);
	await expect(page.locator('.row .detail')).toHaveCount(0);
});
