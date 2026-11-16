import { startMockSpoolman, type MockSpoolman } from '../src/lib/server/spoolman/mock-spoolman';
import { test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Screenshots of the Design tab slot panel with Spoolman (#59). Runs only with SLOT_SHOTS=1.
test.skip(!process.env.SLOT_SHOTS, 'set SLOT_SHOTS=1');
const OUT =
	'/tmp/claude-0/-home-user-TMT-Build-Tracker/0e9eb5cc-24bd-5946-8841-8e112b3af45b/scratchpad/shots-spoolman';

test('slot panel shots', async ({ browser }) => {
	test.setTimeout(180_000);
	const mock: MockSpoolman = await startMockSpoolman();
	mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: '2B3F9E' });
	mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2
	});
	const page = await ctx.newPage();
	try {
		const { chapterUrl, buildId } = await ownerWithBuild(page, 'slotsm');
		const shoot = async (tag: string) => {
			for (const [w, h, scheme] of [
				[390, 844, 'light'],
				[390, 844, 'dark'],
				[1440, 900, 'light']
			] as const) {
				await page.setViewportSize({ width: w, height: h });
				await page.emulateMedia({ colorScheme: scheme });
				await page.goto(`/builds/${buildId}/design`);
				await page.waitForLoadState('networkidle');
				await page
					.getByRole('tab', { name: 'Colors' })
					.click()
					.catch(() => {});
				await page.waitForTimeout(500);
				await page
					.locator('li.slot[data-role="primary"]')
					.evaluate((el) => el.scrollIntoView({ block: 'center' }));
				await page.waitForTimeout(300);
				await page.screenshot({ path: `${OUT}/slotpanel-${tag}-${w}-${scheme}.png` });
			}
		};
		await shoot('unconfigured');
		await page.goto(`${chapterUrl}/integrations`);
		await page.waitForLoadState('networkidle');
		await page.getByTestId('spoolman-url').fill(mock.url.replace(/^https?:\/\//, ''));
		await page.getByTestId('spoolman-save').click();
		await page.getByTestId('spoolman-deduct').waitFor();
		await page.waitForTimeout(500);
		await shoot('configured');
		const res = await page.request.put(`/api/builds/${buildId}/filaments/primary/spoolman`, {
			data: { filamentId: 1 }
		});
		console.log('link', res.status());
		await shoot('linked');
	} finally {
		await mock.close();
	}
});
