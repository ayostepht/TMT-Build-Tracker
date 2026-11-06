import { expect, test } from './fixtures';
import { ownerWithBuild, row } from './helpers';

test('Start printing works from the Print tab: ready list, plate grouping and part detail', async ({
	page
}) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page).toHaveURL(/\/print$/);

	// The default view lists the next plates that have nothing printed yet.
	const ready = page.getByTestId('ready-to-print');
	await expect(ready).toBeVisible();
	await expect(ready.locator('.ready-row')).toHaveCount(3);
	const plateNo = (await ready.locator('.ready-row').first().getAttribute('data-plate')) as string;
	await ready.getByRole('button', { name: `Start printing plate ${plateNo}` }).click();

	// The plate's parts are Printing, and the plate drops out of the ready list.
	await expect(page.locator('.row[data-s="Printing"]').first()).toBeVisible();
	await expect(ready.locator(`.ready-row[data-plate="${plateNo}"]`)).toHaveCount(0);

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.getByRole('heading', { name: 'Now printing' })).toBeVisible();
	await expect(page.locator('.now-card')).toContainText(`Plate ${plateNo}`);
	await expect(page.locator('.overall-top')).toContainText('printing');

	// Group by plate: each plate group has its own button.
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await page.getByLabel('Group by').selectOption('plate');
	const startable = page
		.locator('.group-head')
		.getByRole('button', { name: /^Start printing plate/ });
	await expect(startable.first()).toBeVisible();
	await startable.first().click();
	await expect.poll(() => page.locator('.row[data-s="Printing"]').count()).toBeGreaterThan(1);

	// A part's detail offers its plate too.
	const todo = page.locator('.row[data-s="To print"]').first();
	const slug = (await todo.getAttribute('data-id')) as string;
	await row(page, slug)
		.getByRole('button', { name: /^Details for/ })
		.click();
	await expect(
		row(page, slug).getByRole('button', { name: /^Start printing plate \d+$/ })
	).toBeVisible();
	await row(page, slug)
		.getByRole('button', { name: /^Start printing plate \d+$/ })
		.click();
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Printing');
});
