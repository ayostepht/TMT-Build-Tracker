import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

// r47 tracking UI: touch sizes on the Print tab (coarse pointer) and landing / Print tab shots with
// and without a printer. Shots land in data/r47-shots-tracking/ (gitignored).
const DIR = 'data/r47-shots-tracking';

test.use({ hasTouch: true, isMobile: true });

test('print tab touch targets are >= 44px and the start pair reads clearly', async ({ page }) => {
	test.setTimeout(240_000);
	const sdcp = new MockSdcp();
	await sdcp.start();
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		const { buildId, chapterUrl } = await ownerWithBuild(page, 'r47');
		const slug = chapterUrl.split('/teams/')[1].split('/')[0];
		void slug;
		const org = (
			(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
				organizationId: string;
			}
		).organizationId;

		const shots = async (tag: string) => {
			for (const scheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: scheme });
				for (const [w, h] of [
					[390, 844],
					[1440, 900]
				] as const) {
					await page.setViewportSize({ width: w, height: h });
					await page.goto(chapterUrl);
					await page.waitForLoadState('networkidle');
					await page.screenshot({
						path: `${DIR}/landing-${tag}-${w}-${scheme}.png`,
						fullPage: true
					});
					await page.goto(`/builds/${buildId}/print`);
					await page.waitForLoadState('networkidle');
					await page.screenshot({ path: `${DIR}/print-${tag}-${w}-${scheme}.png`, fullPage: true });
				}
			}
			await page.setViewportSize({ width: 390, height: 844 });
		};

		await shots('noprinter');

		// Touch sizes (coarse pointer) on the Print tab at 390.
		await page.goto(`/builds/${buildId}/print`);
		await page.waitForLoadState('networkidle');
		const row = page.locator('.row').first();
		const heights = async () => ({
			name: (await row.locator('.pbtn').boundingBox())!.height,
			status: (await row.getByTestId('part-status').boundingBox())!.height,
			more: (await row.locator('.more').boundingBox())!.height,
			details: (await page.getByTestId('header-details').boundingBox())?.height ?? 99
		});
		const h = await heights();
		console.log('TOUCH', JSON.stringify(h));
		for (const [k, v] of Object.entries(h)) expect(v, k).toBeGreaterThanOrEqual(44);

		const created = await page.request.post('/api/printers', {
			data: {
				organizationId: org,
				name: 'Shot CC1',
				kind: 'elegoo-sdcp',
				host: '127.0.0.1',
				port: sdcp.port,
				secrets: { mainboardId: 'ABCDEF' }
			}
		});
		expect(created.ok()).toBe(true);
		sdcp.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
		await page.goto(chapterUrl);
		await page.waitForLoadState('networkidle');
		const next = page.getByTestId('next-up-card').first();
		// r48: one status badge replaces the printer / plain start pair; the r48 spec covers the dialog.
		const badge = next.getByTestId('plate-status');
		await expect(badge).toHaveText(/To print/);
		expect((await badge.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await shots('printer');
	} finally {
		await sdcp.stop();
	}
});
