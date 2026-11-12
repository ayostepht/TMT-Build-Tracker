import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import { chooseStatus } from './status-helpers';

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
	await chooseStatus(
		page.locator('[data-testid="plate-status"][data-status="To print"]').first(),
		'Printing'
	);
	await expect(
		page.locator('[data-testid="plate-status"][data-status="Printing"]').first()
	).toBeVisible();

	// Plate just marked Printed stays visible (dimmed, marked) at both phone widths; toolbar must not wrap.
	for (const w of [360, 390]) {
		await page.setViewportSize({ width: w, height: 844 });
		await page.goto(`/builds/${buildId}/print`);
		await page.waitForLoadState('networkidle');
		const f = page.getByTestId('print-filter-open');
		const h = await f.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height);
		console.log(`FILTER BUTTON ${w}px height ${Math.round(h)}`);
		await page.screenshot({ path: `${SHOTS}/print-toolbar-${w}.png` });
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page
		.getByRole('button', { name: /^Log a print on plate \d+$/ })
		.first()
		.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByTestId('printed-just-now').first()).toBeVisible();
	await page.getByTestId('printed-just-now').first().scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/print-just-printed-390.png` });

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
			await expect(page.getByTestId('now-card').first()).toBeVisible();
			await page.waitForLoadState('networkidle');
			await page.getByTestId('now-card').first().scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${SHOTS}/now-card-${vp.tag}-${scheme}.png` });
		}
	}
});

test('compact Now card on the landing and overflow of the full card at 360', async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId, chapterUrl } = await ownerWithBuild(page, 'stage2c');
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await chooseStatus(
		page.locator('[data-testid="plate-status"][data-status="To print"]').first(),
		'Printing'
	);
	await expect(
		page.locator('[data-testid="plate-status"][data-status="Printing"]').first()
	).toBeVisible();

	for (const w of [360, 390]) {
		await page.setViewportSize({ width: w, height: 844 });
		await page.goto(chapterUrl);
		await page.waitForLoadState('networkidle');
		const card = page.getByTestId('landing-now-card').first();
		await expect(card.getByTestId('plate-status')).toBeVisible();
		await expect(card.getByText('Slicer grams')).toHaveCount(0);
		await expect(card.getByTestId('now-details')).toBeVisible();
		const box = await card.boundingBox();
		console.log(`COMPACT ${w}px card height ${Math.round(box!.height)}`);
		await page.screenshot({ path: `${SHOTS}/now-compact-${w}.png` });

		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		const over = await page.evaluate(() => {
			const bad: string[] = [];
			const vw = document.documentElement.clientWidth;
			for (const el of document.querySelectorAll(
				'[data-testid="now-card"], [data-testid="now-card"] *'
			)) {
				const r = el.getBoundingClientRect();
				if (r.width && (r.right > vw + 0.5 || r.left < -0.5))
					bad.push(`${el.tagName}.${(el as HTMLElement).className} ${Math.round(r.right)}`);
			}
			return { bad, scroll: document.documentElement.scrollWidth - vw };
		});
		console.log(`FULL ${w}px overflow ${JSON.stringify(over)}`);
		expect(over.bad).toEqual([]);
		expect(over.scroll).toBeLessThanOrEqual(0);
	}
});
