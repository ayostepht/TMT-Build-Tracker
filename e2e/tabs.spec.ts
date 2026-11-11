import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

const SHOTS = 'data/shots-tabs';

// Tab bar on Overview, Print and Files: the active tab is visible (scrolled into view on
// phones) and marked current; screenshots at 360, 390 and 1440, light and dark.
test('build tab bar: order, active tab in view, screenshots', async ({ page }) => {
	await ownerWithBuild(page, 'tabbar');
	const buildUrl = page.url();
	const nav = page.getByRole('navigation', { name: 'Build sections' });
	for (const width of [360, 390, 1440]) {
		await page.setViewportSize({ width, height: 800 });
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			for (const [tab, path, label] of [
				['overview', '', 'Overview'],
				['print', '/print', 'Print'],
				['files', '/files', 'Files']
			]) {
				await page.goto(buildUrl.replace(/\/$/, '') + path);
				// On phones the nav is display: contents (the bar inside it is fixed to the bottom).
				await expect(nav.getByRole('link').first()).toBeVisible();
				const active = nav.locator('[aria-current="page"]');
				await expect(active).toHaveCount(1);
				await expect(active).toHaveText(label);
				await expect
					.poll(async () =>
						active.evaluate((el) => {
							const a = el.getBoundingClientRect();
							const p = el.parentElement!.getBoundingClientRect();
							// Desktop: the strip is the nav (its row wrapper is display: contents).
							const n = p.width ? p : el.closest('nav')!.getBoundingClientRect();
							return a.left >= n.left - 1 && a.right <= n.right + 1;
						})
					)
					.toBe(true);
				await page.screenshot({ path: `${SHOTS}/tabs-${tab}-${width}-${scheme}.png` });
			}
		}
	}
});
