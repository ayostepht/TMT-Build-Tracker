import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';

test.use({ viewport: { width: 390, height: 844 } });

test('switch to the H2D layout, then organize plates from an uploaded 3MF', async ({ page }) => {
	await ownerWithBuild(page, 'plates');
	await page.getByRole('link', { name: 'Files', exact: true }).click();
	await expect(page).toHaveURL(/\/files$/);

	const cards = page.locator('section.plate-card');
	const layout = page.getByTestId('plate-layout');
	await expect(page.getByTestId('layout-name')).toHaveText("MakeGood's Bambu X1 / P1 / A1 profile");
	await expect(cards).toHaveCount(24);

	// Built-in layout: 21 H plates plus the one-piece push handle plate (22); with the default variants the McMaster caster (8) and
	// smaller rim (20) plates have no active parts and are left out.
	await layout.selectOption({ label: 'Bambu H2D / H2S (22 plates)' });
	await expect(page.getByTestId('layout-name')).toHaveText("MakeGood's Bambu H2D / H2S profile");
	await expect(cards).toHaveCount(19);
	await expect(page.getByRole('region', { name: 'Plate 12' })).toContainText(
		'Print 4 times: 2 in the Accent color'
	);
	await expect(page.getByRole('region', { name: 'Plate 8' })).toHaveCount(0);

	// Upload a small synthetic sliced 3MF (generated here, no MakeGood data).
	const file = makeProjectThreeMf({
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
				objects: [
					{ name: '3DTMT A1 HANDLE LEFT REV A.STEP' },
					{ name: 'Mystery gadget', extruder: 2 }
				]
			}
		]
	});
	await layout.selectOption({ label: 'Use my own sliced file…' });
	const panel = page.getByRole('region', { name: 'Upload a 3MF' });
	await expect(panel).toBeVisible();
	await panel.getByTestId('3mf-file').setInputFiles({
		name: 'my chair.3mf',
		mimeType: 'model/3mf',
		buffer: Buffer.from(file)
	});

	// Review: the handle matches, the unknown object is highlighted until mapped by hand.
	await expect(panel.getByText('Elegoo Centauri Carbon')).toBeVisible();
	await expect(panel.getByText('Print 2 times')).toBeVisible();
	const handle = panel.locator('li', { hasText: '3DTMT A1 HANDLE LEFT' });
	await expect(handle.locator('select')).toHaveValue('handle-left');
	const mystery = panel.locator('li.unmatched', { hasText: 'Mystery gadget' });
	await expect(mystery).toBeVisible();
	await expect(panel.locator('img[alt="Plate 1 preview"]')).toBeVisible();
	await mystery.locator('select').selectOption('storage-left');
	await expect(panel.locator('li.unmatched')).toHaveCount(0);

	// The page stays within the phone viewport.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);

	await panel.getByTestId('apply-upload').click();
	await expect(
		page.getByRole('status').filter({ hasText: 'Plates organized from my chair.3mf' })
	).toBeVisible();
	await expect(page.getByTestId('layout-name')).toHaveText('Your uploaded 3MF');
	await expect(cards).toHaveCount(1);
	const plate = page.getByRole('region', { name: 'Plate 1' });
	await expect(plate).toContainText('HANDLES (PRINT X2)');
	await expect(plate).toContainText('Print 2 times');
	await expect(plate).toContainText('~2.0 h per run');
	await expect(plate).toContainText('Primary PETG 120 g per run');
	await expect(plate).toContainText('Primary TPU 30 g per run');
	const img = plate.locator('img.plate-thumb');
	await expect(img).toBeVisible();
	await expect
		.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
		.toBe(true);
});

test('a rim object stands for both rim pairs, with an override to a single part', async ({
	page
}) => {
	await ownerWithBuild(page, 'twins');
	await page.getByRole('link', { name: 'Files', exact: true }).click();
	await page.getByTestId('plate-layout').selectOption({ label: 'Use my own sliced file…' });
	const panel = page.getByRole('region', { name: 'Upload a 3MF' });
	const file = makeProjectThreeMf({
		sliced: true,
		filamentTypes: ['PETG'],
		plates: [
			{
				name: 'WHEEL RIM (PRINT X4)',
				prediction: 35000,
				weight: 66,
				filaments: { 1: 66 },
				objects: [{ name: '3DTMT O WHEEL RIM REV B.STEP' }]
			}
		]
	});
	await panel.getByTestId('3mf-file').setInputFiles({
		name: 'rims.3mf',
		mimeType: 'model/3mf',
		buffer: Buffer.from(file)
	});
	await panel.getByTestId('outcome-plates').check();
	const twin = panel.getByTestId('twin-plan');
	await expect(twin).toContainText('Wheel Rim');
	await expect(twin).toContainText(
		'Wheel Rims 1 and 4 (Accent) ×2 and Wheel Rims 2 and 3 (Primary) ×2'
	);
	await twin.getByTestId('twin-single').check();
	await expect(twin).toContainText('only');
	await twin.getByTestId('twin-single').uncheck();
	await expect(twin).toContainText('Wheel Rims 2 and 3 (Primary) ×2');
	await panel.getByTestId('apply-upload').click();
	const plate = page.getByRole('region', { name: 'Plate 1', exact: true });
	await expect(plate).toContainText('Wheel Rims 1 and 4');
	await expect(plate).toContainText('Wheel Rims 2 and 3');
});
