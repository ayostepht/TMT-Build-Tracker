import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Phone bottom-bar clearance on the Design tab. Screenshots only with STAGE2_SHOTS=1.
const SHOTS = '.playwright-mcp/stage2b-design';

for (const w of [360, 390]) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`design tab clears the bottom tab bar at ${w}px ${scheme}`, async ({ page }) => {
			await page.setViewportSize({ width: w, height: 844 });
			await page.emulateMedia({ colorScheme: scheme });
			const shot = (name: string) =>
				process.env.STAGE2_SHOTS
					? page.screenshot({ path: `${SHOTS}/${name}-${w}-${scheme}.png` })
					: Promise.resolve(undefined);
			const { buildId } = await ownerWithBuild(page, `s2b${w}${scheme}`);
			await page.goto(`/builds/${buildId}/design`);
			const tabs = page.locator('nav.tabs[data-bottom] .tb-in');
			await expect(tabs).toBeVisible();
			const barTop = async () => (await tabs.boundingBox())!.y;

			// Scrolled to the bottom: the last element ends above the bar.
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			await page.waitForTimeout(200);
			await shot('bottom');

			// Picker open: its bottom edge sits above the bar.
			await page
				.locator('li.slot[data-role="primary"]')
				.getByRole('button', { name: /^Change filament for/ })
				.first()
				.click();
			const picker = page.getByTestId('swatch-picker');
			await expect(picker).toBeVisible();
			await page.waitForTimeout(300);
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			await page.waitForTimeout(200);
			const pb = (await picker.boundingBox())!;
			expect(pb.y + pb.height).toBeLessThanOrEqual((await barTop()) + 1);
			await shot('picker');
			await picker.getByRole('button', { name: 'Done' }).click();

			// Palette preview: the sticky Apply bar sits just above the tab bar.
			await page.getByRole('tab', { name: 'Palettes' }).click();
			await page.getByTestId('readymade-toggle').locator('summary').click();
			await page.locator('[data-palette="fire-truck"]').click();
			const apply = page.getByTestId('palette-bar');
			await expect(apply).toBeVisible();
			await page.waitForTimeout(200);
			const ab = (await apply.boundingBox())!;
			expect(ab.y + ab.height).toBeLessThanOrEqual((await barTop()) + 1);
			expect(ab.y + ab.height).toBeGreaterThan((await barTop()) - 24);
			await shot('apply-bar');
		});
	}
}
