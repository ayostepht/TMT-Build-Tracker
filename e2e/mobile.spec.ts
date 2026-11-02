import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('Overview and Parts do not scroll sideways at 390px', async ({ page }) => {
	await ownerWithBuild(page, 'mobile');
	const overflow = () =>
		page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			client: document.documentElement.clientWidth
		}));

	await expect(page.locator('.overall-top')).toContainText('of 33');
	let m = await overflow();
	expect(m.scroll, 'overview').toBeLessThanOrEqual(m.client);

	await page.getByRole('link', { name: 'Parts', exact: true }).click();
	await expect(page).toHaveURL(/\/parts$/);
	await expect(page.locator('.row').first()).toBeVisible();
	m = await overflow();
	expect(m.scroll, 'parts').toBeLessThanOrEqual(m.client);
});
