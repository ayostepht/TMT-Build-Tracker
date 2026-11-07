import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

test('Log plate printed from the Print tab: one-tap Success, undo, and bulk log', async ({
	page
}) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	const ready = page.getByTestId('ready-to-print');
	await expect(ready.locator('.ready-row')).toHaveCount(3);
	const rows = ready.locator('.ready-row');
	const first = (await rows.nth(0).getAttribute('data-plate')) as string;

	await ready.getByRole('button', { name: `Log plate ${first} printed`, exact: true }).click();
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
	await expect(page.locator('.toasts')).toContainText(`Logged plate ${first} · Success`);
	await expect(ready.locator(`.ready-row[data-plate="${first}"]`)).toHaveCount(0);
	await expect(page.locator('.row[data-s="Printed"]').first()).toBeVisible();

	// Undo brings the plate back.
	await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
	await expect(ready.locator(`.ready-row[data-plate="${first}"]`)).toHaveCount(1);

	// Bulk: select two plates and log them together.
	const a = (await rows.nth(0).getAttribute('data-plate')) as string;
	const b = (await rows.nth(1).getAttribute('data-plate')) as string;
	await ready.getByLabel(`Select plate ${a}`).check();
	await ready.getByLabel(`Select plate ${b}`).check();
	await ready.getByRole('button', { name: 'Log 2 plates printed' }).click();
	await expect(page.locator('.toasts')).toContainText('Logged 2 plates');
	await expect(ready.locator(`.ready-row[data-plate="${a}"]`)).toHaveCount(0);
	await expect(ready.locator(`.ready-row[data-plate="${b}"]`)).toHaveCount(0);

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.locator('.overall-top')).toContainText('printed');
});

test('A plate run shows in the Print log of a part on that plate, tagged with the plate', async ({
	page
}) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	const ready = page.getByTestId('ready-to-print');
	const plate = (await ready.locator('.ready-row').first().getAttribute('data-plate')) as string;
	await ready.getByRole('button', { name: `Log plate ${plate} printed`, exact: true }).click();
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
