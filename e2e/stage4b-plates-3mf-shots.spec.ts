import { expect, test } from './fixtures';
import { arrangeForCentauri, ownerWithBuild } from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';

// Visual guard for the Stage 4 design-system pass on the Files tab. Off unless
// STAGE4_SHOTS=before|after (files land in a gitignored folder).
const MODE = process.env.STAGE4_SHOTS;
const DIR = `.playwright-mcp/stage4b-plates-3mf/${MODE}`;
test.skip(!MODE, 'screenshot run only');
test.use({ actionTimeout: 15_000 });

const sliced = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		printerModel: 'Elegoo Centauri Carbon',
		printerSettingsId: 'Elegoo Centauri Carbon 0.4 nozzle',
		filamentTypes: ['PETG', 'TPU'],
		plates: [
			{
				name: 'HANDLES (PRINT X2)',
				prediction: 7200,
				weight: 150,
				filaments: { 1: 120, 2: 30 },
				objects: [{ name: '3DTMT A1 HANDLE LEFT REV A.STEP' }, { name: 'Mystery gadget' }]
			}
		]
	});

const COMBOS = [
	[390, 844, 'light'],
	[390, 844, 'dark'],
	[1440, 900, 'light'],
	[1440, 900, 'dark']
] as const;

test('Files tab screens', async ({ page }) => {
	test.setTimeout(300_000);
	const { buildId } = await ownerWithBuild(page, 's4b');
	const go = async (w: number, h: number, scheme: 'light' | 'dark') => {
		await page.emulateMedia({ colorScheme: scheme });
		await page.setViewportSize({ width: w, height: h });
		await page.goto(`/builds/${buildId}/files`);
		await page.waitForLoadState('networkidle');
	};
	const shot = (name: string, w: number, scheme: string, full = true) =>
		page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png`, fullPage: full });

	// Phase 1: no bed yet
	for (const [w, h, scheme] of COMBOS) {
		await go(w, h, scheme);
		await shot('default', w, scheme);
		await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
		await page.getByTestId('bed-custom').click();
		await page.getByText('Advanced: keep-out areas').click();
		await page.getByRole('button', { name: 'Add keep-out area' }).click();
		await shot('bed-custom', w, scheme);
		await page.getByTestId('use-own-sliced').click();
		const dlg = page.getByRole('dialog', { name: 'Use my own sliced file' });
		await expect(dlg).toBeVisible();
		await shot('upload-pick', w, scheme, false);
		await dlg.getByTestId('3mf-file').setInputFiles({
			name: 'my chair.3mf',
			mimeType: 'model/3mf',
			buffer: Buffer.from(sliced())
		});
		await expect(dlg.getByTestId('apply-upload')).toBeVisible();
		await shot('upload-review', w, scheme, false);
		await dlg.getByRole('button', { name: 'Cancel' }).first().click();
		await expect(dlg).toBeHidden();
	}

	// Phase 2: arranged for the Centauri Carbon
	await go(1440, 900, 'light');
	await arrangeForCentauri(page);
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Elegoo Centauri Carbon');
	for (const [w, h, scheme] of COMBOS) {
		await go(w, h, scheme);
		await shot('arranged', w, scheme);
		const legend = page.getByTestId('legend-row').first();
		await legend.scrollIntoViewIfNeeded();
		await legend.click();
		await page.getByTestId('plate-diagram').first().scrollIntoViewIfNeeded();
		await shot('arranged-pinned', w, scheme, false);
		await page.getByTestId('change-bed').click();
		await shot('change-bed', w, scheme);
		await page.getByTestId('hide-bed').click();
		await page.getByTestId('plate-layout').selectOption({ label: 'Bambu H2D / H2S (21 plates)' });
		await expect(page.getByTestId('layout-confirm')).toBeVisible();
		await page.getByTestId('layout-confirm').scrollIntoViewIfNeeded();
		await shot('layout-confirm', w, scheme, false);
		await page.getByTestId('layout-confirm-cancel').click();
	}
});
