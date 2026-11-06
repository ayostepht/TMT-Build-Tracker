import { expect, test, type Locator, type Page } from '@playwright/test';
import { arrangeForCentauri, ownerWithBuild } from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';

// Synthetic sliced file (no MakeGood data): the left wing alone on a plate, and both handles together.
const SHOTS = 'data/shots-printtemplate';
const sliced = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		printerModel: 'Elegoo Centauri Carbon',
		printerSettingsId: 'Elegoo Centauri Carbon 0.4 nozzle',
		filamentTypes: ['PETG'],
		plates: [
			{
				name: 'WING LEFT',
				prediction: 45000,
				weight: 359,
				filaments: { 1: 359 },
				objects: [{ name: '3DTMT C1 WING LEFT REV B.step' }]
			},
			{
				name: 'HANDLES',
				prediction: 57000,
				weight: 840,
				filaments: { 1: 840 },
				objects: [
					{ name: '3DTMT A1 HANDLE LEFT REV A.STEP' },
					{ name: '3DTMT A2 HANDLE RIGHT REV A.STEP' }
				]
			}
		]
	});

async function shoot(page: Page, name: string, target?: Locator) {
	for (const [w, h, tag] of [
		[390, 844, '390'],
		[1440, 900, '1440']
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			const path = `${SHOTS}/${name}-${tag}-${scheme}.png`;
			if (target) await target.screenshot({ path });
			else await page.screenshot({ path, fullPage: true });
		}
	}
	await page.emulateMedia({ colorScheme: 'light' });
	await page.setViewportSize({ width: 390, height: 844 });
}

test('use a sliced file as a print template, recolor, re-arrange with its times', async ({
	page
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'ptpl');
	await page.getByRole('link', { name: 'Files', exact: true }).click();
	await expect(page).toHaveURL(/\/files$/);

	// A printer is set and the MakeGood plates are back: "my own plates" that are not arranged.
	await arrangeForCentauri(page);
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Elegoo Centauri Carbon');
	await page.getByTestId('plate-layout').selectOption({ label: 'Bambu X1 / P1 / A1 (24 plates)' });
	await page.getByTestId('layout-confirm-yes').click();
	await expect(page.getByTestId('layout-name')).toHaveText("MakeGood's Bambu X1 / P1 / A1 profile");
	const cards = page.locator('section.plate-card');
	await expect(cards).toHaveCount(24);
	const wingPlate = page.locator('section.plate-card', { hasText: 'Wing Left' }).first();
	await expect(wingPlate).not.toContainText('from your slice');

	// Upload: with a printer set the print template is the default choice.
	await page.getByTestId('use-own-sliced').click();
	const dlg = page.getByRole('dialog', { name: 'Use my own sliced file' });
	await dlg.getByTestId('3mf-file').setInputFiles({
		name: 'my chair.3mf',
		mimeType: 'model/3mf',
		buffer: Buffer.from(sliced())
	});
	await expect(dlg.getByText('What should this file do?')).toBeVisible();
	await expect(dlg.getByTestId('outcome-template')).toBeChecked();
	await expect(
		dlg.getByText("Your file's plates become this build's plates, exactly as sliced.")
	).toBeVisible();
	await expect(dlg.getByText(/Keep your own plates \(or arrange new ones\)/)).toBeVisible();
	await expect(dlg.getByTestId('apply-upload')).toHaveText('Use as print template');
	await shoot(page, 'review-choice', dlg.locator('section.upload'));
	// the other choice renames the button; switch back
	await dlg.getByTestId('outcome-plates').check();
	await expect(dlg.getByTestId('apply-upload')).toHaveText('Use these plates');
	await dlg.getByTestId('outcome-template').check();
	await dlg.getByTestId('apply-upload').click();

	// The plates stay; the wing plate now carries the slicer's time, and the Files tab shows the template.
	await expect(
		page.getByRole('status').filter({ hasText: 'Print template learned from my chair.3mf' })
	).toBeVisible();
	await expect(page.getByTestId('layout-name')).toHaveText("MakeGood's Bambu X1 / P1 / A1 profile");
	await expect(cards).toHaveCount(24);
	await expect(wingPlate).toContainText(/~13 h \(from your slice\)/);
	const line = page.getByTestId('print-template-line');
	await expect(line).toContainText('my chair.3mf');
	await expect(line).toContainText('2 sliced plates');
	await expect(line).toContainText('Elegoo Centauri Carbon');
	await expect(line).toContainText('shared by part volume');
	await expect(line).toContainText('3 parts');
	await shoot(page, 'print-template-line');

	// Recolor the wing in Design (API call, like the Design tab's own save): the plate no longer matches.
	const res = await page.request.patch(`/api/builds/${buildId}/design`, {
		data: { partRoles: { 'wing-left': 'primary' } }
	});
	expect(res.ok()).toBe(true);
	await page.reload();
	await page.waitForLoadState('networkidle');
	const banner = page.getByTestId('stale-banner');
	await expect(banner).toBeVisible();
	await expect(banner).toContainText('using your print template');
	await expect(banner).toContainText('my chair.3mf');
	await shoot(page, 'recolor-prompt');

	// Re-arrange: the plates become arranged and keep the learned time.
	await banner.getByRole('button', { name: 'Re-arrange plates' }).click();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Elegoo Centauri Carbon');
	await expect(page.getByTestId('stale-banner')).toHaveCount(0);
	const wing = page.locator('section.plate-card', { has: page.locator('[data-slug="wing-left"]') });
	await expect(wing).toContainText('(from your slice)');
	await expect(wing).toContainText('Primary');
	await expect(page.getByTestId('print-template-line')).toContainText('1 recolored since');

	// Remove forgets the learned data and leaves the plates.
	page.once('dialog', (d) => d.accept());
	await page.getByTestId('template-remove').click();
	await expect(page.getByTestId('print-template')).toHaveCount(0);
	await expect(wing).not.toContainText('from your slice');
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Elegoo Centauri Carbon');

	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
});

test('"Use these plates" keeps today\'s behaviour and still learns', async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await ownerWithBuild(page, 'ptpl2');
	await page.getByRole('link', { name: 'Files', exact: true }).click();
	await page.getByTestId('use-own-sliced').click();
	const dlg = page.getByRole('dialog', { name: 'Use my own sliced file' });
	await dlg.getByTestId('3mf-file').setInputFiles({
		name: 'as is.3mf',
		mimeType: 'model/3mf',
		buffer: Buffer.from(sliced())
	});
	// No printer and no arranged plates: the file's plates are the default.
	await expect(dlg.getByTestId('outcome-plates')).toBeChecked();
	await dlg.getByTestId('apply-upload').click();
	await expect(
		page.getByRole('status').filter({ hasText: 'Plates organized from as is.3mf' })
	).toBeVisible();
	await expect(page.getByTestId('layout-name')).toHaveText('Your uploaded 3MF');
	await expect(page.locator('section.plate-card')).toHaveCount(2);
	await expect(page.getByTestId('print-template-line')).toContainText('as is.3mf');
	await expect(page.getByTestId('print-template-line')).toContainText('3 parts');
});
