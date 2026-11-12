import { test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Visual regression guard for the Stage 4 design-system wave. Runs only with STAGE4_SHOTS=before|after
// (screenshots land in the gitignored .playwright-mcp/stage4-design/<phase>/).
const PHASE = process.env.STAGE4_SHOTS;
const DIR = `.playwright-mcp/stage4-design/${PHASE}`;

test.skip(!PHASE, 'set STAGE4_SHOTS=before|after');

const SIZES = [
	{ w: 390, h: 844 },
	{ w: 1440, h: 900 }
];

test('stage 4 design-system screenshots', async ({ page }) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId, chapterUrl } = await ownerWithBuild(page, 's4');
	// a draft for /studio
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await page.waitForURL(/\/builds\/[^/]+\/design/);

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of SIZES) {
			await page.setViewportSize({ width: w, height: h });
			const shot = async (name: string, full = false) => {
				await page.waitForTimeout(350);
				await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png`, fullPage: full });
			};
			await page.goto(`/builds/${buildId}/design`);
			await page.waitForLoadState('networkidle');
			await page.getByRole('tab', { name: 'Colors' }).click();
			await shot('design', true);
			// swatch picker
			await page
				.locator('li.slot[data-role="primary"]')
				.getByRole('button', { name: /^Change filament for/ })
				.first()
				.click();
			await page.getByTestId('swatch-picker').waitFor();
			await shot('picker', true);
			await page.getByTestId('swatch-picker').getByRole('button', { name: 'Done' }).click();
			// parts tab
			await page.getByRole('tab', { name: 'Parts' }).click();
			await shot('parts', true);
			// palettes
			await page.getByRole('tab', { name: 'Palettes' }).click();
			await page.getByTestId('readymade-toggle').locator('summary').click();
			await shot('palettes', true);
			await page.locator('[data-palette="fire-truck"]').click();
			await page.getByTestId('palette-bar').waitFor();
			await shot('palettes-preview', true);
			await page.goto('/designs');
			await page.waitForLoadState('networkidle');
			await shot('designs', true);
			await page.goto('/studio');
			await page.waitForLoadState('networkidle');
			await shot('studio', true);
			// screens I do not own that use app.css globals
			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			await shot('x-overview', true);
			await page.goto(`/builds/${buildId}/print`);
			await page.waitForLoadState('networkidle');
			await shot('x-print', true);
			await page.goto(`/builds/${buildId}/files`);
			await page.waitForLoadState('networkidle');
			await shot('x-files', true);
			await page.goto(`${chapterUrl}/printers`);
			await page.waitForLoadState('networkidle');
			await shot('x-printers', true);
			await page.goto(chapterUrl);
			await page.waitForLoadState('networkidle');
			await shot('x-landing', true);
		}
	}
	// login (signed out)
	await page.context().clearCookies();
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of SIZES) {
			await page.setViewportSize({ width: w, height: h });
			await page.goto('/login');
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${DIR}/x-login-${w}-${scheme}.png` });
		}
	}
});
