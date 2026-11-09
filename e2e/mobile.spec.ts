import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('Design: selecting a part floats a chip on the stage without growing the page', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'mobilepart');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Parts' }).click();
	const height = () => page.evaluate(() => document.documentElement.scrollHeight);
	const before = await height();
	await page.locator('button.row[data-slug="wing-left"]').click();
	const sheet = page.getByTestId('part-sheet');
	await expect(sheet).toBeVisible();
	expect(await height()).toBe(before);
	const sb = await sheet.boundingBox();
	const stage = await page.locator('.stagebox').boundingBox();
	expect(sb!.y).toBeGreaterThanOrEqual(stage!.y);
	expect(sb!.y + sb!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
	const w = await page.evaluate(() => ({
		s: document.documentElement.scrollWidth,
		c: document.documentElement.clientWidth
	}));
	expect(w.s).toBeLessThanOrEqual(w.c);
});

test('Overview and Print do not scroll sideways at 390px', async ({ page }) => {
	await ownerWithBuild(page, 'mobile');
	const overflow = () =>
		page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			client: document.documentElement.clientWidth
		}));

	await expect(page.locator('.overall-top')).toContainText('of 33');
	let m = await overflow();
	expect(m.scroll, 'overview').toBeLessThanOrEqual(m.client);

	await page.getByRole('link', { name: 'Print', exact: true }).click();
	await expect(page).toHaveURL(/\/print$/);
	await expect(page.locator('.row').first()).toBeVisible();
	m = await overflow();
	expect(m.scroll, 'print').toBeLessThanOrEqual(m.client);
});
