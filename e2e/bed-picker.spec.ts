import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

const SHOTS = 'data/shots-bed';

const noOverflow = (page: import('@playwright/test').Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('New build form and Plates tab picker: bed presets, light and dark, phone and desktop', async ({
	page
}) => {
	test.setTimeout(120_000);
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'bedshots');

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.goto(chapterUrl);
			await page.waitForLoadState('networkidle');
			const form = page.locator('form[action="?/newBuild"]');
			await expect(form.getByTestId('plate-layout')).toHaveValue('__arrange__');
			await expect(form.getByTestId('bed-preset-256x256')).toHaveAttribute('aria-pressed', 'true');
			await form.getByTestId('bed-picker').scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${SHOTS}/newbuild-${w}-${scheme}.png`, fullPage: true });
			if (w === 390) expect(await noOverflow(page)).toBeLessThanOrEqual(0);

			await page.goto(`/builds/${buildId}/plates`);
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
