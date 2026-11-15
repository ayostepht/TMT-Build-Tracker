import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild } from './helpers';
import type { Page } from '@playwright/test';

async function openPrintByPlate(page: Page, buildId: string) {
	await keepPrintedVisible(page, buildId);
	await page.waitForLoadState('networkidle');
	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page).toHaveURL(/\/print$/);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
}
const head = (page: Page, n: number) =>
	page.locator('.group-head', { has: page.getByText(new RegExp(`^Plate ${n} ·`)) });

test('Plate header shows grams: estimate, flag with quick add, your entry', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pg');
	await openPrintByPlate(page, buildId);

	// An estimate from the kit's part weights is marked "~".
	const p16 = head(page, 16).getByTestId('plate-grams');
	await expect(p16.getByTestId('plate-grams-main')).toHaveText(/^~\d[\d,]* g/);
	await expect(p16.getByTestId('plate-grams-flag')).toHaveCount(0);

	// Plate 9 (the KIT caster mounts) has no weights: a flag, not "0 g".
	const p9 = head(page, 9).getByTestId('plate-grams');
	await expect(p9.getByTestId('plate-grams-flag')).toContainText('2 parts without weight');
	await p9.getByTestId('plate-grams-flag').click();
	const form = head(page, 9).getByTestId('plate-grams-form');
	await form.getByLabel('Weight of Rear Caster Mount Left (KIT) in grams').fill('62');
	await form.getByRole('button', { name: 'Save weight' }).click();
	await expect(p9.getByTestId('plate-grams-flag')).toContainText('1 part without weight');
	await expect(p9.getByTestId('plate-grams-main')).toHaveText(/^≥ 62 g/);

	await p9.getByTestId('plate-grams-flag').click();
	await head(page, 9)
		.getByTestId('plate-grams-form')
		.getByLabel('Weight of Rear Caster Mount Right (KIT) in grams')
		.fill('58');
	await head(page, 9).getByRole('button', { name: 'Save weight' }).click();
	await expect(p9.getByTestId('plate-grams-flag')).toHaveCount(0);
	await expect(p9.getByTestId('plate-grams-main')).toHaveText(/^120 g/);

	// A typed plate total is shown as "your entry".
	const res = await page.request.patch(`/api/builds/${buildId}/plates/16`, {
		data: { slicerGrams: 417 }
	});
	expect(res.ok()).toBe(true);
	await page.reload();
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
	await expect(head(page, 16).getByTestId('plate-grams')).toContainText('417 g');
	await expect(head(page, 16).getByTestId('plate-grams')).toContainText('your entry');
});
