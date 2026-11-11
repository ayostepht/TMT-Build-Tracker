import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Screenshots + content-share measurement for the Print tab and the Now card. Off unless
// STAGE2_SHOTS=1 (files land in a gitignored folder).
const SHOTS = '.playwright-mcp/stage2-build-state';
test.skip(!process.env.STAGE2_SHOTS, 'screenshot run only');

test('Print tab and Now card screenshots; content share at 390 x 844', async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'stage2');
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');

	// Under way: print one plate so "Hide printed" defaults on, and start another so a Now card exists.
	const logs = page.getByRole('button', { name: /^Log a print on plate \d+$/ });
	await logs.first().click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await page
		.getByRole('button', { name: /^Start printing plate \d+$/ })
		.first()
		.click();
	await expect(
		page.getByRole('button', { name: /^Finish & log plate \d+$/ }).first()
	).toBeVisible();

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const vp of [
			{ width: 390, height: 844, tag: 'phone' },
			{ width: 1440, height: 900, tag: 'desktop' }
		]) {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await page.goto(`/builds/${buildId}/print`);
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${SHOTS}/print-${vp.tag}-${scheme}.png` });
			// scrolled: what stays pinned over the content
			await page.evaluate(() => window.scrollTo(0, 500));
			await page.waitForTimeout(200);
			const pinned = await page.evaluate(() => {
				const rects: { top: number; bottom: number; cls: string }[] = [];
				for (const el of document.querySelectorAll('body *')) {
					const cs = getComputedStyle(el);
					if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
					const r = el.getBoundingClientRect();
					if (r.width < 100 || r.height < 20 || r.bottom <= 0 || r.top >= innerHeight) continue;
					if (el.closest('dialog') || el.closest('.toasts')) continue;
					rects.push({ top: r.top, bottom: r.bottom, cls: String(el.className).slice(0, 30) });
				}
				rects.sort((a, b) => a.top - b.top);
				let h = 0;
				let end = -1;
				for (const r of rects) {
					const t = Math.max(r.top, end, 0);
					if (r.bottom > t) h += r.bottom - t;
					end = Math.max(end, r.bottom);
				}
				return { h, rects, vh: innerHeight };
			});
			console.log(
				`PINNED ${vp.tag} ${scheme}: ${Math.round(pinned.h)}px of ${pinned.vh} -> content ${Math.round((1 - pinned.h / pinned.vh) * 100)}% ${JSON.stringify(pinned.rects.map((r) => [r.cls, Math.round(r.top), Math.round(r.bottom)]))}`
			);
			await page.screenshot({ path: `${SHOTS}/print-scrolled-${vp.tag}-${scheme}.png` });
			await page.evaluate(() => window.scrollTo(0, 0));
			if (vp.tag === 'phone') {
				await page.getByTestId('print-filter-open').click();
				await expect(page.getByRole('dialog', { name: 'Filter parts' })).toBeVisible();
				await page.screenshot({ path: `${SHOTS}/print-filter-open-${vp.tag}-${scheme}.png` });
				await page.getByRole('button', { name: 'Done' }).click();
			}
			await page.goto(`/builds/${buildId}`);
			await expect(page.locator('.now-card').first()).toBeVisible();
			await page.waitForLoadState('networkidle');
			await page.locator('.now-card').first().scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${SHOTS}/now-card-${vp.tag}-${scheme}.png` });
		}
	}
});
