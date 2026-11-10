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

/** Anything wider than the screen, or a text field iOS would zoom into (under 16px). */
async function sideways(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const vw = document.documentElement.clientWidth;
		const clipped = (e: Element) => {
			for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
				const o = getComputedStyle(p);
				if (
					/(hidden|auto|scroll|clip)/.test(o.overflowX) &&
					p.getBoundingClientRect().right <= vw + 1
				)
					return true;
			}
			return false;
		};
		const wide: string[] = [];
		const small: string[] = [];
		for (const e of document.querySelectorAll('body *')) {
			const cs = getComputedStyle(e);
			if (cs.display === 'none' || cs.visibility === 'hidden') continue;
			const r = e.getBoundingClientRect();
			if (!r.width && !r.height) continue;
			if ((r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed' && !clipped(e))
				wide.push(
					`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${Math.round(r.left)}..${Math.round(r.right)}`
				);
			if (
				/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) &&
				!['checkbox', 'radio', 'hidden', 'range', 'color', 'file'].includes(
					(e as HTMLInputElement).type
				) &&
				parseFloat(cs.fontSize) < 16
			)
				small.push(`${e.tagName.toLowerCase()} ${cs.fontSize}`);
		}
		return {
			scroll: document.documentElement.scrollWidth,
			vw,
			wide: wide.slice(0, 6),
			small: small.slice(0, 6)
		};
	});
}

for (const width of [360, 390]) {
	test(`Design tab states do not scroll sideways at ${width}px and fields are 16px`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 800 });
		const { buildId } = await ownerWithBuild(page, `mobile${width}`);
		await page.goto(`/builds/${buildId}/design`);
		const check = async (state: string) => {
			const m = await sideways(page);
			expect(m.scroll, `${state}: page width`).toBeLessThanOrEqual(m.vw);
			expect(m.wide, `${state}: elements past the screen edge`).toEqual([]);
			expect(m.small, `${state}: fields under 16px`).toEqual([]);
		};
		await expect(page.getByTestId('design-workspace')).toBeVisible();
		await check('colors');

		await page.getByRole('tab', { name: 'Palettes' }).click();
		await expect(page.locator('[data-palette]')).toHaveCount(13);
		await check('palettes');
		await page.locator('[data-palette]').first().click();
		await expect(page.getByTestId('palette-bar')).toBeVisible();
		await check('palette preview and apply bar');
		await page.getByTestId('generator-toggle').locator('summary').click();
		await check('palette generator');

		await page.getByRole('tab', { name: 'Parts' }).click();
		await check('parts');
		await page.locator('button.row[data-slug="wing-left"]').click();
		await expect(page.getByTestId('part-sheet')).toBeVisible();
		await check('parts with a part selected');
		await page.keyboard.press('Escape');

		await page.getByRole('tab', { name: 'Colors' }).click();
		await page
			.getByRole('button', { name: /^Change filament for/ })
			.first()
			.click();
		await expect(page.getByTestId('swatch-picker')).toBeVisible();
		await expect(page.getByTestId('swatch').first()).toBeVisible();
		await check('swatch picker');
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('swatch-picker')).toHaveCount(0);

		await page.getByTestId('open-share').click();
		await check('share dialog');
		await page.keyboard.press('Escape');
		await page.getByTestId('open-apply').click();
		await check('apply dialog');
	});
}
