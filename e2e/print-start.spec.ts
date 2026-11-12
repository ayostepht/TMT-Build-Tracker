import { expect, test } from './fixtures';
import { ownerWithBuild, row } from './helpers';
import { chooseStatus } from './status-helpers';

test('Marking Printing works from the Print tab: plate grouping and part detail', async ({
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
		.locator('[data-testid="plate-status"][data-status="To print"]');
	await expect(startable.first()).toBeVisible();
	const label = (await startable.first().getAttribute('aria-label')) as string;
	const plateNo = /Plate (\d+) status/.exec(label)![1];
	await chooseStatus(startable.first(), 'Printing');
	await expect(page.locator('.row[data-s="Printing"]').first()).toBeVisible();

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.getByRole('heading', { name: 'Now printing' })).toBeVisible();
	await expect(page.getByTestId('now-card')).toContainText(`Plate ${plateNo}`);
	await expect(page.locator('.overall-top')).toContainText('printing');

	// Start a second plate from its group.
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(startable.first()).toBeVisible();
	await chooseStatus(startable.first(), 'Printing');
	await expect.poll(() => page.locator('.row[data-s="Printing"]').count()).toBeGreaterThan(1);

	// A part's detail offers its plate too.
	const todo = page.locator('.row[data-s="To print"]').first();
	const slug = (await todo.getAttribute('data-id')) as string;
	await row(page, slug)
		.getByRole('button', { name: /^Details for/ })
		.click();
	const plateBadge = row(page, slug).getByTestId('plate-status');
	await expect(plateBadge).toHaveAccessibleName(/^Plate \d+ status: To print\. Change status$/);
	await chooseStatus(plateBadge, 'Printing');
	await expect(row(page, slug)).toHaveAttribute('data-s', 'Printing');
});
