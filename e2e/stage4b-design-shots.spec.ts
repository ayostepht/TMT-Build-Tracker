import { test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Visual guard for the Stage 4 wave 2 (design-studio-ui). Runs only with STAGE4_SHOTS=before|after;
// screenshots land in the gitignored .playwright-mcp/stage4b-design-studio-ui/<phase>/.
const PHASE = process.env.STAGE4_SHOTS;
const DIR = `.playwright-mcp/stage4b-design-studio-ui/${PHASE}`;

test.skip(!PHASE, 'set STAGE4_SHOTS=before|after');

const SIZES = [
	{ w: 390, h: 844 },
	{ w: 1440, h: 900 }
];

test('stage 4b design-studio screenshots', async ({ page }) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 's4b');
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of SIZES) {
			await page.setViewportSize({ width: w, height: h });
			const shot = async (name: string) => {
				await page.waitForTimeout(350);
				await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png` });
			};
			await page.goto(`/builds/${buildId}/design`);
			await page.waitForLoadState('networkidle');
			await shot('design');
			await page.getByRole('tab', { name: 'Parts' }).click();
			await shot('parts');
			await page.locator('[data-testid="part-row"][data-slug="wing-left"]').click();
			await shot('parts-sheet');
			await page.keyboard.press('Escape');
			await page.getByRole('tab', { name: 'Colors' }).click();
			await page
				.locator('li.slot[data-role="primary"]')
				.getByRole('button', { name: /^Change filament for/ })
				.first()
				.click();
			await page.getByTestId('swatch-picker').waitFor();
			await shot('picker');
			await page.getByTestId('swatch-picker').getByRole('button', { name: 'Done' }).click();
			await page.getByTestId('open-share').click();
			await page.getByTestId('share-dialog').waitFor();
			await shot('share-dialog');
			await page.keyboard.press('Escape');
			await page.getByTestId('open-apply').click();
			await page.getByTestId('apply-dialog').waitFor();
			await shot('apply-dialog');
			await page.keyboard.press('Escape');
			await page.goto('/account');
			await page.waitForLoadState('networkidle');
			await page.getByTestId('delete-account-open').click();
			await page.getByTestId('delete-account-dialog').waitFor();
			await shot('account-delete-dialog');
		}
	}
});
