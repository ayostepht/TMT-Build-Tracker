import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild, row } from './helpers';
import type { Page } from '@playwright/test';

const SLUG = 'rear-caster-left'; // "Rear Caster Mount Left (KIT)": the kit gives it no weight

async function openPrint(page: Page, buildId: string) {
	await keepPrintedVisible(page, buildId);
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page).toHaveURL(/\/print$/);
	await page.waitForLoadState('networkidle');
}

/** Parts still to print without a weight, summed over the filament tiles on Overview. */
const unweighed = async (page: Page) => {
	const texts = await page.getByTestId('unknown-weights').allInnerTexts();
	return texts.reduce((a, t) => a + Number(/^\s*(\d+) parts? without weight/.exec(t)![1]), 0);
};

test('Add weight on a part with no weight flows into the part row, the plate log and Overview', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page);

	// Overview first: the parts without a weight are counted, not treated as 0 g.
	await page.getByRole('link', { name: 'Overview' }).click();
	const before = await unweighed(page);
	expect(before).toBeGreaterThan(0);
	await expect(page.getByTestId('unknown-weights').first()).toContainText('not counted');
	await expect(page.getByText(/≥ [\d,]+ g/).first()).toBeVisible();

	await openPrint(page, buildId);
	const r = row(page, SLUG);
	await expect(r.getByTestId('part-weight')).toHaveCount(0);
	await expect(r.getByTestId('add-weight')).toBeVisible();

	// Typing something invalid is refused inline.
	await r.getByTestId('add-weight').click();
	const input = r.getByTestId('weight-input');
	await input.fill('abc');
	await expect(r.getByRole('alert')).toContainText('number');
	await expect(r.getByTestId('weight-save')).toBeDisabled();

	await input.fill('62');
	await r.getByTestId('weight-save').click();
	await expect(r.getByTestId('part-weight')).toHaveText(/^62 g · your entry$/);
	await expect(r.getByTestId('add-weight')).toHaveCount(0);

	// It persists across a reload.
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(row(page, SLUG).getByTestId('part-weight')).toContainText('62 g · your entry');

	// The plate log sheet shows the plate's known total (62 g; the other mount is still unknown).
	await page.getByLabel('Group by').selectOption('plate');
	const logBtn = page
		.locator('.group-head')
		.getByRole('button', { name: /^Log a print on plate 9$/ });
	await logBtn.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByLabel('Filament used (g)')).toHaveAttribute('placeholder', /62/);
	await sheet.locator('.btn', { hasText: 'Cancel' }).click();

	// Overview now counts one part less without a weight.
	await page.getByRole('link', { name: 'Overview' }).click();
	await expect.poll(() => unweighed(page)).toBe(before - 1);

	// Clearing the entry puts it back to "Add weight".
	await openPrint(page, buildId);
	await row(page, SLUG)
		.getByRole('button', { name: 'Details for Rear Caster Mount Left (KIT)' })
		.click();
	await row(page, SLUG).getByRole('button', { name: 'Change weight' }).click();
	await row(page, SLUG).getByRole('button', { name: 'Use the estimate' }).click();
	await expect(row(page, SLUG).getByTestId('add-weight')).toBeVisible();
});

test('A kit weight shows as an estimate, and a typed one replaces it', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'est');
	await openPrint(page, buildId);
	const r = row(page, 'push-top'); // 251 g in the kit
	await expect(r.getByTestId('part-weight')).toHaveText('~251 g');
	await r.getByRole('button', { name: /^Details for/ }).click();
	await r.getByRole('button', { name: 'Enter weight' }).click();
	await r.getByTestId('weight-input').fill('260,5');
	await r.getByTestId('weight-save').click();
	await expect(r.getByTestId('part-weight')).toContainText('· your entry');
});
