import { test } from './fixtures';
import { ownerWithBuild } from './helpers';

test.skip(!process.env.R47_SHOTS, 'set R47_SHOTS=1');

const OUT = 'data/r47-shots-shell';

for (const [w, h] of [
	[390, 844],
	[1440, 900]
] as const) {
	test(`r47 shell shots ${w}`, async ({ page }) => {
		await page.setViewportSize({ width: w, height: h });
		const { buildId } = await ownerWithBuild(page, `r47s${w}`);
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${OUT}/overview-${w}-${scheme}.png`, fullPage: true });
			if (w === 390) {
				await page.getByTestId('filament-tile').first().getByRole('button').click();
				await page.screenshot({ path: `${OUT}/overview-${w}-${scheme}-open.png`, fullPage: true });
			}
		}
		await page.emulateMedia({ colorScheme: 'light' });
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await page.screenshot({ path: `${OUT}/footer-build-${w}.png` });
		await page.goto('/builds');
		await page.waitForLoadState('networkidle');
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await page.screenshot({ path: `${OUT}/footer-builds-${w}.png` });
	});
}
