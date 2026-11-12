import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild } from './helpers';
import { chooseStatus } from './status-helpers';

// Visual guard for the Stage 4 second wave (build-state components). Runs only with
// STAGE4_SHOTS=before|after; files land in the gitignored .playwright-mcp/stage4b-build-state/.
const PHASE = process.env.STAGE4_SHOTS;
const DIR = `.playwright-mcp/stage4b-build-state/${PHASE}`;
test.skip(!PHASE, 'set STAGE4_SHOTS=before|after');

test('stage 4b build-state screenshots', async ({ page }) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId, chapterUrl } = await ownerWithBuild(page, 's4b');
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');

	// one plate logged (Success) and one failed part run, another plate started
	await page
		.getByRole('button', { name: /^Log a print on plate \d+$/ })
		.first()
		.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await chooseStatus(
		page.locator('[data-testid="plate-status"][data-status="To print"]').first(),
		'Printing'
	);
	await expect(
		page.locator('[data-testid="plate-status"][data-status="Printing"]').first()
	).toBeVisible();
	await page.getByTestId('plate-history-toggle').first().click();

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of [
			{ w: 390, h: 844 },
			{ w: 1440, h: 900 }
		]) {
			await page.setViewportSize({ width: w, height: h });
			const shot = async (name: string, full = false) => {
				await page.waitForTimeout(350);
				await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png`, fullPage: full });
			};
			await page.goto(`/builds/${buildId}/print`);
			await page.waitForLoadState('networkidle');
			await page.getByTestId('plate-history-toggle').first().click();
			await page
				.locator('.row')
				.first()
				.getByRole('button', { name: /^Details for / })
				.click();
			await shot('print', true);
			if (w === 390) {
				await page.getByTestId('print-filter-open').click();
				await shot('filter-sheet');
				await page.getByRole('button', { name: 'Done' }).click();
			}
			// log sheet (quick, from the Finish button)
			await chooseStatus(
				page.locator('[data-testid="plate-status"][data-status="Printing"]').first(),
				'Printed'
			);
			await shot('log-sheet');
			await page.keyboard.press('Escape');
			// edit sheet and delete confirmation
			await page.getByRole('button', { name: 'Edit entry' }).first().click();
			await shot('edit-sheet');
			await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
			await shot('delete-confirm');
			await page.getByRole('button', { name: 'Keep it' }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).last().click();
			// overview + landing
			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			await shot('overview', true);
			await page.goto(chapterUrl);
			await page.waitForLoadState('networkidle');
			await shot('landing', true);
		}
	}
});
