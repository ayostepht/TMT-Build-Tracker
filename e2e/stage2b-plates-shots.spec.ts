import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Files tab scrolled to the very bottom on phones: nothing hidden behind the fixed bottom tab bar.
// Off unless STAGE2_SHOTS=1 (files land in a gitignored folder).
const SHOTS = '.playwright-mcp/stage2b-plates';
test.skip(!process.env.STAGE2_SHOTS, 'screenshot run only');

test('Files tab bottom clears the phone tab bar at 360 and 390', async ({ page }) => {
	test.setTimeout(120_000);
	const { buildId } = await ownerWithBuild(page, 'stage2b');
	for (const w of [360, 390]) {
		await page.setViewportSize({ width: w, height: 844 });
		await page.goto(`/builds/${buildId}/files`);
		await page.waitForLoadState('networkidle');
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await page.waitForTimeout(300);
		const m = await page.evaluate(() => {
			const bar = document.querySelector('nav.tabs[data-bottom] .tb-in');
			const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
			const last = [...document.querySelectorAll('.plate-card, .card, .anchor')].pop()!;
			return { barTop, lastBottom: last.getBoundingClientRect().bottom, found: !!bar };
		});
		console.log(`BOTTOM ${w}px`, JSON.stringify(m));
		expect(m.lastBottom).toBeLessThanOrEqual(m.barTop + 1);
		await page.screenshot({ path: `${SHOTS}/files-bottom-${w}.png` });
	}
});
