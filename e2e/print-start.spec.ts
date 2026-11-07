import { expect, test } from './fixtures';
import { ownerWithBuild, row } from './helpers';

test('Start printing works from the Print tab: plate grouping and part detail', async ({
	page
}) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page).toHaveURL(/\/print$/);
	// The old "Ready to print" section is gone.
	await expect(page.getByTestId('ready-to-print')).toHaveCount(0);

	// Group by plate: each plate group has its own button.
	await page.getByLabel('Group by').selectOption('plate');
	const startable = page
		.locator('.group-head')
		.getByRole('button', { name: /^Start printing plate \d+$/ });
	await expect(startable.first()).toBeVisible();
	const label = (await startable.first().getAttribute('aria-label')) as string;
	const plateNo = /\d+/.exec(label)![0];
	await startable.first().click();
	await expect(page.locator('.row[data-s="Printing"]').first()).toBeVisible();

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.getByRole('heading', { name: 'Now printing' })).toBeVisible();
	await expect(page.locator('.now-card')).toContainText(`Plate ${plateNo}`);
	await expect(page.locator('.overall-top')).toContainText('printing');

	// Start a second plate from its group.
	await page.getByRole('link', { name: 'Print', exact: true }).click();
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
