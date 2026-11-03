import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Seed footprints make this work without any MakeGood file in CI.
const SHOTS = 'data/shots-arrange';

test('pick a printer, arrange plates, recolor a part, then try a small custom bed', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'arrange');
	await page.getByRole('link', { name: 'Plates', exact: true }).click();
	await expect(page).toHaveURL(/\/plates$/);

	// Choose the Elegoo Centauri Carbon with CANVAS from the catalog.
	await page.getByTestId('choose-printer').click();
	await page.getByTestId('printer-brand').selectOption('Elegoo');
	await page.getByTestId('printer-model').selectOption({ label: 'Centauri Carbon' });
	await expect(page.getByTestId('printer-bedx')).toHaveValue('256');
	await expect(page.getByTestId('printer-bedy')).toHaveValue('256');
	await page.getByTestId('printer-mm').selectOption({ index: 1 });
	await expect(page.getByTestId('printer-summary')).toContainText('4 filaments per plate');
	await page.getByTestId('save-printer').click();

	// Saving the first printer arranges the plates for it.
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Elegoo Centauri Carbon');
	const cards = page.locator('section.plate-card');
	await expect(cards.first()).toBeVisible();
	const n = await cards.count();
	expect(n).toBeGreaterThan(10);
	await expect(page.getByTestId('plate-diagram')).toHaveCount(n);

	// Parts that do not fit a 256 mm bed are called out.
	const warnings = page.getByTestId('arrange-warnings');
	await expect(warnings).toBeVisible();
	await expect(warnings).toContainText('Wing Left');
	await expect(warnings).toContainText("doesn't fit a 256×256 mm bed");

	// The layout picker offers the arrangement and the kit author's profiles.
	const picker = page.getByTestId('plate-layout');
	await expect(picker.locator('option')).toContainText([
		/Arrange for my printer \(Elegoo Centauri Carbon, 256×256 mm\)/,
		/MakeGood tuned profile: Bambu X1 \/ P1 \/ A1/,
		/MakeGood tuned profile: Bambu H2D \/ H2S/,
		/Upload my sliced 3MF/
	]);

	const wing = page.locator('section.plate-card [data-slug="wing-left"]').first();
	const before = await wing.getAttribute('fill');
	await page.screenshot({ path: `${SHOTS}/plates-390.png`, fullPage: true });

	// Move Wing Left to the Primary color through the design API: plates re-arrange on their own.
	const res = await page.request.patch(`/api/builds/${buildId}/design`, {
		data: { partRoles: { 'wing-left': 'primary' } }
	});
	expect(res.ok()).toBe(true);
	await expect
		.poll(async () =>
			page.locator('section.plate-card [data-slug="wing-left"]').first().getAttribute('fill')
		)
		.not.toBe(before);
	await expect(page.getByTestId('stale-banner')).toHaveCount(0);
	// The wing now sits on a plate with Primary parts, not with the Accent wing.
	const wingCard = page.locator('section.plate-card', {
		has: page.locator('[data-slug="wing-left"]')
	});
	await expect(wingCard).toContainText('Primary');

	// Desktop widths.
	for (const [w, h, name] of [
		[1440, 900, 'plates-1440'],
		[1920, 1080, 'plates-1920']
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		await expect(page.getByTestId('plate-diagram').first()).toBeVisible();
		await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
	}
	await page.setViewportSize({ width: 390, height: 844 });

	// A small custom printer from Settings: the oversize warnings name the bed.
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	const settings = page.getByTestId('printer-settings');
	await settings.getByTestId('printer-brand').selectOption('__custom__');
	await settings.getByLabel('Printer name').fill('Tiny Test Printer');
	await settings.getByTestId('printer-bedx').fill('180');
	await settings.getByTestId('printer-bedy').fill('180');
	await settings.getByTestId('printer-bedx').blur();
	await settings.getByTestId('save-printer-settings').click();
	await expect(settings.getByRole('status')).toHaveText('Saved');
	await page.getByRole('link', { name: 'Plates', exact: true }).click();
	await expect(page.getByTestId('printer-name')).toHaveText('Tiny Test Printer');
	const w2 = page.getByTestId('arrange-warnings');
	await expect(w2).toContainText("doesn't fit a 180×180 mm bed");
	await expect(w2).toContainText('Wheel Mount Left');
	await page.screenshot({ path: `${SHOTS}/plates-small-bed-390.png`, fullPage: true });

	// No horizontal scroll on the phone.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
});

test('a build created with a printer is arranged right away', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'arrange2'); // a plain build first to get a chapter
	await page.goto(chapterUrl);
	await page.waitForLoadState('networkidle');
	const form = page.locator('form[action="?/newBuild"]');
	await form.getByLabel('Name', { exact: true }).fill('Arranged chair');
	await form.getByTestId('printer-brand').selectOption('Bambu Lab');
	await form.getByTestId('printer-model').selectOption({ label: 'H2D' });
	await form.getByRole('button', { name: 'Create build' }).click();
	await expect(page).toHaveURL(/\/builds\/[^/]+$/);
	await page.getByRole('link', { name: 'Plates', exact: true }).click();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Bambu Lab H2D');
	await expect(page.getByTestId('plate-diagram').first()).toBeVisible();
});
