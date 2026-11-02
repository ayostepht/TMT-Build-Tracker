import { expect, test } from './fixtures';
import { ownerWithBuild, row } from './helpers';

test('owner signs up, makes a chapter and build, and tracks a part to Printed', async ({
	page
}) => {
	await ownerWithBuild(page);

	const header = page.locator('.overall-top');
	await expect(header).toContainText('0 of 33');
	await expect(page.getByText('Nothing on the printer')).toBeVisible();

	await page.getByRole('link', { name: 'Parts', exact: true }).click();
	await expect(page).toHaveURL(/\/parts$/);
	const first = page.locator('.row').first();
	const slug = (await first.getAttribute('data-id')) as string;
	const name = (await first.locator('.pbtn').innerText()).trim();

	await row(page, slug).getByRole('button', { name: 'Printing', exact: true }).click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Printing');

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.getByRole('heading', { name: 'Now printing' })).toBeVisible();
	await expect(page.locator('.now-card')).toContainText(name);
	await expect(header).toContainText('1 printing');

	await page.getByRole('link', { name: 'Parts', exact: true }).click();
	await row(page, slug)
		.getByRole('button', { name: `Details for ${name}` })
		.click();
	await row(page, slug).getByRole('button', { name: 'Log print' }).click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Printed');
	await expect(row(page, slug).locator('.seg button[aria-pressed="true"]')).toHaveText('Printed');

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(header).toContainText('1 of 33');
	await expect(page.getByText('Nothing on the printer')).toBeVisible();
	await expect(page.locator('.activity')).toContainText('Olive Owner logged a successful print');
	await expect(page.locator('.activity')).toContainText(`Olive Owner set ${name} to Printing`);
});

test('filament labels do not repeat the material', async ({ page }) => {
	await ownerWithBuild(page, 'labels');
	await expect(page.locator('body')).not.toContainText(/PETG Primary PETG|TPU 95A Tire TPU/);
	await page.getByRole('link', { name: 'Parts', exact: true }).click();
	await expect(page.locator('.chips').first().locator('.chip')).toHaveText([
		'All filament',
		'Accent PETG',
		'Primary PETG',
		'Soft TPU',
		'Tire TPU'
	]);
});
