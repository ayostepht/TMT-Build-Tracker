import { test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Screenshots of the Options tab and the swatch picker. Runs only with R47_SHOTS=1
// (images land in the gitignored data/r47-shots-design/).
test.skip(!process.env.R47_SHOTS, 'set R47_SHOTS=1');

test('r47 design screenshots', async ({ page }) => {
	test.setTimeout(180_000);
	const { buildId } = await ownerWithBuild(page, 'r47shots');
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of [
			{ w: 390, h: 844 },
			{ w: 1440, h: 900 }
		]) {
			await page.setViewportSize({ width: w, height: h });
			await page.goto(`/builds/${buildId}/design`);
			await page.waitForLoadState('networkidle');
			await page.getByRole('tab', { name: 'Options' }).click();
			await page.waitForTimeout(400);
			await page.screenshot({ path: `data/r47-shots-design/options-${w}-${scheme}.png` });
			await page.getByRole('tab', { name: 'Colors' }).click();
			await page
				.locator('li.slot[data-role="primary"]')
				.getByRole('button', { name: /^Change filament for/ })
				.first()
				.click();
			await page.getByTestId('swatch-picker').waitFor();
			await page.waitForTimeout(700);
			await page.screenshot({ path: `data/r47-shots-design/picker-${w}-${scheme}.png` });
		}
	}
});
