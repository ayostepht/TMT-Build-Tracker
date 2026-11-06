import { expect, test } from './fixtures';
import { ownerWithBuild, startBuild, toSetupStep } from './helpers';

// Seed footprints make this work without any MakeGood file in CI.
const SHOTS = 'data/shots-bed';

test('pick a printer, arrange plates, recolor a part, then try a small custom bed', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'arrange');
	await page.getByRole('link', { name: 'Files', exact: true }).click();
	await expect(page).toHaveURL(/\/files$/);

	// The picker offers standard bed sizes first, with example printers computed from the catalog.
	const layoutSel = page.getByTestId('plate-layout');
	await layoutSel.selectOption({ label: 'Arrange for my bed' });
	const presets = page.getByTestId('bed-picker');
	await expect(presets.getByTestId('bed-preset-256x256')).toContainText(
		'Centauri Carbon, Bambu X1/P1/A1'
	);
	for (const s of [
		'180x180',
		'220x220',
		'235x235',
		'250x210',
		'256x256',
		'300x300',
		'350x350',
		'360x360'
	])
		await expect(presets.getByTestId(`bed-preset-${s}`)).toBeVisible();
	await expect(presets.getByTestId('bed-custom')).toBeVisible();
	await expect(presets.getByTestId('bed-pick-printer')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/plates-picker-390.png`, fullPage: true });

	// Choose the Elegoo Centauri Carbon with CANVAS from the catalog.
	await page.getByTestId('bed-pick-printer').click();
	await page.getByTestId('printer-brand').selectOption('Elegoo');
	await page.getByTestId('printer-model').selectOption({ label: 'Centauri Carbon' });
	await expect(page.getByTestId('printer-bedx')).toHaveValue('256');
	await expect(page.getByTestId('printer-bedy')).toHaveValue('256');
	await page.getByTestId('printer-mm').selectOption({ index: 1 });
	await expect(page.getByTestId('printer-summary')).toContainText('4 filaments per plate');
	await page.getByTestId('arrange-bed').click();

	// Arranging saves the printer as the build's bed and arranges the plates for it.
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
	// The header counts exactly what the list shows (a flat rotation is not a warning).
	const listed = await warnings.locator('li').count();
	await expect(warnings.locator('summary')).toContainText(`${listed} thing`);
	await expect(warnings).not.toContainText(/tilt|turned \d+°/i);

	// The Centauri Carbon filament cutter (front right) is drawn as a keep-out area on every plate.
	const zone = page.getByTestId('keep-out').first();
	await expect(zone).toBeAttached();
	await expect(zone).toHaveAttribute('aria-label', 'Keep-out area: Filament cutter');
	await expect(page.getByTestId('keep-out')).toHaveCount(n);

	// The layout picker offers the arrangement and the kit author's profiles.
	const picker = page.getByTestId('plate-layout');
	await expect(picker.locator('option')).toContainText([
		/Arrange for my bed/,
		/Bambu X1 \/ P1 \/ A1 \(24 plates\)/,
		/Bambu H2D \/ H2S \(21 plates\)/,
		/Use my own sliced file/
	]);
	await expect(page.locator('.plate-layout-picker')).toContainText(
		'Hand-tuned by MakeGood for Bambu X1 / P1 / A1 (24 plates) and Bambu H2D / H2S (21 plates)'
	);

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

	// A small custom bed on the Files tab: the oversize warnings name the bed.
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	const panel = page.getByTestId('arrange-bed-panel');
	await page.getByTestId('change-bed').click();
	await panel.getByTestId('bed-custom').click();
	await panel.getByLabel('Name (optional)').fill('Tiny Test Printer');
	await panel.getByTestId('bed-x').fill('180');
	await panel.getByTestId('bed-y').fill('180');
	await panel.getByTestId('bed-y').blur();
	await panel.getByTestId('arrange-bed').click();
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

test('the setup wizard arranges the plates for the printer you choose', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'arrange2'); // a plain build first to get a chapter
	await page.goto(chapterUrl);
	await startBuild(page, 'Arranged chair');
	await toSetupStep(page, 4);
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.screenshot({ path: `${SHOTS}/setup-print-390.png`, fullPage: true });
	await page.getByTestId('bed-pick-printer').click();
	await page.getByTestId('printer-brand').selectOption('Bambu Lab');
	await page.getByTestId('printer-model').selectOption({ label: 'H2D' });
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Bambu Lab H2D');
	await expect(page.getByTestId('plate-diagram').first()).toBeVisible();
});

test('a standard bed preset with height and filament slots is stored as the build printer', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'arrange3');
	await page.goto(chapterUrl);
	const id = await startBuild(page, 'Preset chair');
	await toSetupStep(page, 4);
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-preset-300x300').click();
	await page.getByTestId('bed-z').fill('280');
	await page.getByTestId('bed-slots').selectOption('4');
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for 300 × 300 bed');
	const view = await (await page.request.get(`/api/builds/${id}/view`)).json();
	expect((view.view ?? view).printer).toMatchObject({
		catalogId: null,
		name: '300 × 300 bed',
		bedX: 300,
		bedY: 300,
		bedZ: 280,
		mmSlots: 4
	});
});
