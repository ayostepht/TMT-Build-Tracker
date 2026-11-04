import { expect, test } from './fixtures';
import { ownerWithBuild, row } from './helpers';

test('owner signs up, makes a chapter and build, and tracks a part to Printed', async ({
	page
}) => {
	await ownerWithBuild(page);

	const header = page.locator('.overall-top');
	await expect(header).toContainText('0 of 33');
	await expect(page.getByText('Nothing on the printer')).toBeVisible();

	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page).toHaveURL(/\/print$/);
	const first = page.locator('.row').first();
	const slug = (await first.getAttribute('data-id')) as string;
	const name = (await first.locator('.pbtn').innerText()).trim();

	await row(page, slug).getByRole('button', { name: 'Printing', exact: true }).click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Printing');

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.getByRole('heading', { name: 'Now printing' })).toBeVisible();
	await expect(page.locator('.now-card')).toContainText(name);
	await expect(header).toContainText('1 printing');

	// Finishing opens the sheet; nothing is logged until a result is chosen and saved.
	const plateNo = ((await page.locator('.now-plate').first().innerText()).match(/Plate (\d+)/i) ??
		[])[1];
	await page.getByRole('button', { name: /Finish & log print/ }).click();
	const sheet = page.getByRole('dialog');
	const save = sheet.getByRole('button', { name: 'Save', exact: true });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Success' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await expect(save).toBeDisabled();
	await sheet.getByRole('button', { name: 'Failed' }).click();
	await expect(save).toBeEnabled();
	await sheet.getByLabel('Total print time').fill('2h 30m');
	await sheet.getByLabel('Filament used (g)').fill('120');
	await sheet.getByLabel('Notes').fill('Warped corner');
	await expect(sheet).toContainText('for reprint');
	await save.click();
	await expect(sheet).toBeHidden();
	await expect(page.locator('.toasts')).toContainText(`Logged plate ${plateNo} · Failed`);
	await expect(page.getByText('Nothing on the printer')).toBeVisible();

	await page.getByRole('link', { name: 'Files', exact: true }).click();
	const logged = page.getByRole('region', { name: `Plate ${plateNo}` }).locator('tbody tr');
	await expect(logged).toHaveCount(1);
	await expect(logged).toContainText('Failed');
	await expect(logged).toContainText('2.5');
	await expect(logged).toContainText('120');
	await expect(logged).toContainText('Warped corner');

	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Reprint');

	// Log a success from the part row (phone-sized: the sheet must fit without side scrolling).
	await page.setViewportSize({ width: 390, height: 844 });
	await row(page, slug)
		.getByRole('button', { name: `Details for ${name}` })
		.click();
	await row(page, slug).getByRole('button', { name: 'Log a print…' }).click();
	await expect(sheet).toBeVisible();
	const fits = await page.evaluate(() => {
		const d = document.querySelector('dialog[open]') as HTMLElement;
		return {
			page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
			dialog: d.scrollWidth <= d.clientWidth && d.getBoundingClientRect().width <= 390
		};
	});
	expect(fits).toEqual({ page: true, dialog: true });
	await sheet.getByRole('button', { name: 'Success' }).click();
	await save.click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Printed');
	await expect(row(page, slug).locator('.seg button[aria-pressed="true"]')).toHaveText('Printed');

	// Undo puts the previous status back and removes the run again.
	await page.locator('.toasts').getByRole('button', { name: 'Undo' }).last().click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Reprint');
	await expect(row(page, slug).locator('tbody tr')).toHaveCount(0);

	await row(page, slug).getByRole('button', { name: 'Log a print…' }).click();
	await sheet.getByRole('button', { name: 'Success' }).click();
	await save.click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Printed');

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(header).toContainText('1 of 33');
	await expect(page.getByText('Nothing on the printer')).toBeVisible();
	await expect(page.locator('.activity')).toContainText('Olive Owner logged a successful print');
	await expect(page.locator('.activity')).toContainText('Olive Owner undid a successful print');
	await expect(page.locator('.activity')).toContainText(`Olive Owner set ${name} to Printing`);
});

test('filament labels do not repeat the material', async ({ page }) => {
	await ownerWithBuild(page, 'labels');
	await expect(page.locator('body')).not.toContainText(/PETG Primary PETG|TPU 95A Tire TPU/);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page.locator('.chips').first().locator('.chip')).toHaveText([
		'All filament',
		'Accent PETG',
		'Primary PETG',
		'Soft TPU',
		'Tire TPU'
	]);
});
