import { startMockSpoolman, type MockSpoolman } from '../src/lib/server/spoolman/mock-spoolman';
import { test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Screenshots of Overview filaments, the wizard Spoolman step and Settings with Spoolman (#59).
// Runs only with OV_SHOTS=1.
test.skip(!process.env.OV_SHOTS, 'set OV_SHOTS=1');
const OUT =
	'/tmp/claude-0/-home-user-TMT-Build-Tracker/0e9eb5cc-24bd-5946-8841-8e112b3af45b/scratchpad/shots-spoolman';

test('overview and wizard shots', async ({ browser }) => {
	test.setTimeout(240_000);
	const mock: MockSpoolman = await startMockSpoolman();
	mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: '2B3F9E' });
	mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2
	});
	const page = await ctx.newPage();
	try {
		const { chapterUrl, buildId } = await ownerWithBuild(page, 'ovsm');
		const v0 = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
		const ROLE: string = v0.parts.find((p: { slug: string }) => p.slug === 'handle-left').role;
		const view = async (w: number, h: number, scheme: 'light' | 'dark') => {
			await page.setViewportSize({ width: w, height: h });
			await page.emulateMedia({ colorScheme: scheme });
		};
		const overview = async (tag: string, open = true) => {
			for (const [w, h, scheme] of [
				[390, 844, 'light'],
				[390, 844, 'dark'],
				[1440, 900, 'light']
			] as const) {
				await view(w, h, scheme);
				await page.goto(`/builds/${buildId}`);
				await page.waitForLoadState('networkidle');
				const row = page.locator(`[data-testid="filament-tile"][data-role="${ROLE}"]`);
				if (w < 900 && open) await row.locator('button.ft-head').click();
				await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
				await page.waitForTimeout(400);
				await page.screenshot({ path: `${OUT}/overview-${tag}-${w}-${scheme}.png` });
			}
		};
		await overview('unconfigured');
		await page.goto(`${chapterUrl}/integrations`);
		await page.waitForLoadState('networkidle');
		await page.getByTestId('spoolman-url').fill(mock.url.replace(/^https?:\/\//, ''));
		await page.getByTestId('spoolman-save').click();
		await page.getByTestId('spoolman-deduct').waitFor();
		await page.waitForTimeout(500);
		for (const [w, h, scheme] of [
			[390, 844, 'light'],
			[390, 844, 'dark'],
			[1440, 900, 'light']
		] as const) {
			await view(w, h, scheme);
			await page.goto(`${chapterUrl}/integrations`);
			await page.waitForLoadState('networkidle');
			await page.getByTestId('spoolman-kept-by').scrollIntoViewIfNeeded();
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${OUT}/settings-${w}-${scheme}.png` });
		}
		await overview('configured');

		// The wizard step, unlinked.
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await view(w, h, 'light');
			await page.goto(`/builds/${buildId}/setup?step=spoolman`);
			await page.waitForLoadState('networkidle');
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${OUT}/wizard-spoolman-${w}.png` });
		}

		// Pre-link prompt: log a print first so there are grams logged before linking.
		await view(390, 844, 'light');
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		const logged = await page.request.post(`/api/builds/${buildId}/runs`, {
			data: { plateNumber: 1, date: '2026-11-03', result: 'Success', grams: 120, hours: 2 }
		});
		console.log('log', logged.status());
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		const row = page.locator(`[data-testid="filament-tile"][data-role="${ROLE}"]`);
		await row.locator('button.ft-head').click();
		await row.getByTestId('spoolman-link').click();
		await page.getByTestId('spoolman-picker').waitFor();
		await page.waitForTimeout(500);
		await page
			.getByTestId('spoolman-picker')
			.locator('button', { hasText: /Cobalt/ })
			.first()
			.click();
		await page
			.getByTestId('spoolman-prelink')
			.waitFor()
			.catch(() => console.log('no prelink'));
		await row.evaluate((el) => el.scrollIntoView({ block: 'start' }));
		await page.waitForTimeout(400);
		await page.screenshot({ path: `${OUT}/prelink-390-light.png` });
		await page
			.getByTestId('prelink-done')
			.click()
			.catch(() => {});
		await page.waitForTimeout(500);
		await overview('linked');
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await view(w, h, 'light');
			await page.goto(`/builds/${buildId}/setup?step=spoolman`);
			await page.waitForLoadState('networkidle');
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${OUT}/wizard-spoolman-linked-${w}.png` });
		}
	} finally {
		await mock.close();
	}
});
