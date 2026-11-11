import { test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Visual guard for the Stage 4 third design-system wave (build state). Runs only with
// STAGE4C_SHOTS=1; files land in the gitignored .playwright-mcp/stage4c-build-state/.
const ON = !!process.env.STAGE4C_SHOTS;
const DIR = '.playwright-mcp/stage4c-build-state';
test.skip(!ON, 'set STAGE4C_SHOTS=1');

const SIZES = [
	{ w: 390, h: 844 },
	{ w: 1440, h: 900 }
];

test('stage 4c build-state screenshots', async ({ page }) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 's4cbs');
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page
		.getByLabel('Group by')
		.selectOption('plate')
		.catch(() => {});

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of SIZES) {
			await page.setViewportSize({ width: w, height: h });
			const shot = async (name: string) => {
				await page.waitForTimeout(350);
				await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png` });
			};
			await page.goto(`/builds/${buildId}/print`);
			await page.waitForLoadState('networkidle');
			await shot('print-tab');
			await page
				.locator('.row')
				.first()
				.screenshot({
					path: `${DIR}/partrow-status-${w}-${scheme}.png`
				});

			// Filter sheet (phone) as ds-modal
			const filter = page.getByTestId('print-filter-open');
			if (await filter.isVisible()) {
				await filter.click();
				await page.getByRole('dialog').waitFor();
				await shot('filter-sheet');
				await page.keyboard.press('Escape');
			}

			// log sheet; then a toast raised while it is open
			const log = page.getByRole('button', { name: /^Log a print on plate \d+$/ }).first();
			if (await log.isVisible()) {
				await log.click();
				const sheet = page.getByRole('dialog');
				await sheet.waitFor();
				await shot('log-sheet');
				await sheet.getByRole('button', { name: 'Failed' }).click();
				await shot('log-sheet-results');
				await sheet.getByRole('button', { name: 'Success' }).click();
				await sheet.getByRole('button', { name: 'Save', exact: true }).click();
				await page
					.locator('.toasts')
					.getByText(/Logged plate/)
					.waitFor();
				// raise a second sheet while the toast is up
				const next = page.getByRole('button', { name: /^Log a print on plate \d+$/ }).first();
				if (await next.isVisible()) {
					await next.click();
					await page.getByRole('dialog').waitFor();
					await shot('toast-over-sheet');
					await page.keyboard.press('Escape');
				}
				await page
					.locator('.toasts')
					.getByRole('button', { name: 'Undo' })
					.click()
					.catch(() => {});
			}

			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			await shot('overview-nowcard');
		}
	}
});
