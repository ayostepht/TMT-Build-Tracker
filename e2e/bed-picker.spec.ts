import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

const SHOTS = 'data/shots-bed';

const noOverflow = (page: import('@playwright/test').Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Setup Files step and Files tab picker: bed presets, light and dark, phone and desktop', async ({
	page
}) => {
	test.setTimeout(120_000);
	const { buildId } = await ownerWithBuild(page, 'bedshots');

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.goto(`/builds/${buildId}/setup?step=4`);
			await page.waitForLoadState('networkidle');
			await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
			await expect(page.getByTestId('bed-preset-256x256')).toBeVisible();
			await page.getByTestId('bed-picker').scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${SHOTS}/setup-print-${w}-${scheme}.png`, fullPage: false });
			if (w === 390) expect(await noOverflow(page)).toBeLessThanOrEqual(0);

			await page.goto(`/builds/${buildId}/files`);
			await page.waitForLoadState('networkidle');
			await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
			await page.getByTestId('bed-custom').click();
			await expect(page.getByTestId('bed-x')).toBeVisible();
			await page.getByTestId('bed-picker').scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${SHOTS}/plates-${w}-${scheme}.png`, fullPage: false });
			if (w === 390) expect(await noOverflow(page)).toBeLessThanOrEqual(0);
		}
	}

	// A tuned profile hides the bed panel; the group is explained.
	await page.getByTestId('plate-layout').selectOption({ label: 'Bambu X1 / P1 / A1 (24 plates)' });
	await expect(page.getByTestId('arrange-bed-panel')).toHaveCount(0);
});

test('New printer dialog is a real modal: focus in, Tab trapped, Escape closes, focus restored', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	const { buildId } = await ownerWithBuild(page, 'newprinter');
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	const sel = page.getByTestId('team-printer');
	await sel.focus();
	await sel.selectOption({ label: 'New printer…' });
	const dlg = page.getByRole('dialog', { name: 'New printer' });
	await expect(dlg).toBeVisible();
	await expect(dlg.locator(':focus')).toHaveCount(1);
	for (let i = 0; i < 8; i++) {
		await page.keyboard.press('Tab');
		await expect(dlg.locator(':focus')).toHaveCount(1);
	}
	for (let i = 0; i < 8; i++) {
		await page.keyboard.press('Shift+Tab');
		await expect(dlg.locator(':focus')).toHaveCount(1);
	}
	await page.keyboard.press('Escape');
	await expect(dlg).toBeHidden();
	await expect(sel).toBeFocused();
});
