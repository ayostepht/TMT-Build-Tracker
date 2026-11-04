import { expect, test } from './fixtures';
import { arrangeForCentauri, ownerWithBuild } from './helpers';

// CI has no MakeGood files, so the 3D model is absent: the Design tab must work from the part list alone.
test('design tab: move parts between slots, add a color, share a design and start a build from it', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'design');

	// Overview tile of the first slot before any change.
	await page.goto(`/builds/${buildId}`);
	const tile = page.locator('.tile').first();
	await expect(tile).toBeVisible();
	const beforeTile = await tile.innerText();

	await page.goto(`/builds/${buildId}/design`);
	await expect(page.getByTestId('no-model')).toContainText('No 3D model yet');
	await page.getByRole('tab', { name: 'Parts' }).click();

	const wing = page.locator('button.row[data-slug="wing-left"]');
	const wingBefore = await wing.innerText();
	await wing.click();
	const sheet = page.getByTestId('part-sheet');
	await expect(sheet).toContainText('Wing Left');
	// Wings are PETG parts: flexible slots are listed but disabled, with the reason.
	await expect(sheet.locator('button[data-role="soft"]')).toBeDisabled();
	await expect(sheet).toContainText('needs PETG');

	// "Apply to both sides" is on by default.
	await sheet.locator('button[data-role="primary"]').click();
	await expect(page.locator('button.row[data-slug="wing-left"]')).not.toHaveText(wingBefore);
	const right = page.locator('button.row[data-slug="wing-right"]');
	await expect(right).toContainText(
		await page.locator('li.slot[data-role="primary"] b').innerText()
	);

	// The Overview filament tile changed (the wings moved onto the first slot).
	await page.goto(`/builds/${buildId}`);
	await expect(page.locator('.tile').first()).not.toHaveText(beforeTile);

	// Add a color through the swatch picker (a custom filament here, a catalog swatch below).
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('button', { name: 'Add a color' }).click();
	const picker = page.getByTestId('swatch-picker');
	await picker.getByTestId('add-filament').click();
	await picker.getByLabel('Brand', { exact: true }).fill('E2E');
	await picker.getByLabel('Color name').fill('E2E Red');
	await picker.getByRole('button', { name: 'Save and use' }).click();
	await expect(picker).toHaveCount(0);
	const slot = page.locator('li.slot[data-role="e2e-red"]');
	await expect(slot).toContainText('E2E Red');

	await page.getByRole('tab', { name: 'Parts' }).click();
	// Move a handle to it (one side only).
	await page.locator('button.row[data-slug="handle-left"]').click();
	await page.getByLabel(/Apply to both sides/).uncheck();
	await page.getByTestId('part-sheet').locator('button[data-role="e2e-red"]').click();
	await expect(page.locator('button.row[data-slug="handle-left"]')).toContainText('E2E Red');
	await expect(page.locator('button.row[data-slug="handle-right"]')).not.toContainText('E2E Red');
	await expect(slot).toContainText('1 parts');

	// Save as a public design.
	await page.getByLabel('Design name').fill('E2E Blues');
	await page.getByLabel(/Share publicly/).check();
	await page.getByRole('button', { name: 'Save design' }).click();
	await expect(page.getByTestId('design-saved')).toContainText('Saved "E2E Blues"');

	// It shows up in the gallery, and a new build can start from it.
	await page.goto('/designs');
	const card = page.locator('[data-design]', { hasText: 'E2E Blues' });
	await expect(card).toBeVisible();
	await expect(card).toContainText('Olive Owner');
	await card.getByRole('link', { name: 'E2E Blues' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'E2E Blues' })).toBeVisible();
	await expect(page.locator('li[data-role="e2e-red"]')).toContainText('E2E Red');
	await page.getByLabel('Build name').fill('From design');
	await page.getByRole('button', { name: 'Start a build' }).click();
	await expect(page).toHaveURL(/\/builds\/[^/]+$/);

	await page.getByRole('link', { name: 'Design', exact: true }).click();
	await expect(page.locator('li.slot[data-role="e2e-red"]')).toContainText('E2E Red');
	await page.getByRole('tab', { name: 'Parts' }).click();
	await expect(page.locator('li.slot[data-role="e2e-red"]')).toContainText('E2E Red');
	await expect(page.locator('button.row[data-slug="handle-left"]')).toContainText('E2E Red');
	await expect(page.locator('button.row[data-slug="wing-right"]')).toContainText(
		await page.locator('li.slot[data-role="primary"] b').innerText()
	);
});

test('design tab: Esc, the close button and picking the same part again deselect', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'deselect');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Parts' }).click();
	const wing = page.locator('button.row[data-slug="wing-left"]');
	const sheet = page.getByTestId('part-sheet');
	await wing.click();
	await expect(sheet).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await wing.click();
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'Close part details' }).click();
	await expect(sheet).toHaveCount(0);
	await wing.click();
	await expect(sheet).toBeVisible();
	await wing.click();
	await expect(sheet).toHaveCount(0);
});

test('design tab: pick a catalog swatch for a slot, search, and add a slot from a swatch', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'swatch');
	await page.goto(`/builds/${buildId}/design`);

	// Tap the slot's big swatch: the picker opens with real catalog colors.
	const slot = page.locator('li.slot[data-role="primary"]');
	const before = await slot.locator('b').innerText();
	await slot
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	await picker.getByRole('button', { name: 'Overture', exact: true }).click();
	await picker.getByLabel('Search colors').fill('red');
	const swatch = picker.getByTestId('swatch').first();
	await expect(swatch).toBeVisible();
	const label = (await swatch.getAttribute('aria-label')) ?? '';
	const name = label.split(',')[0];
	expect(name).toMatch(/red/i);
	await swatch.click();
	await expect(slot.locator('b')).toContainText(name);
	expect(await slot.locator('b').innerText()).not.toBe(before);
	await expect(picker.getByTestId('swatch-detail')).toContainText(name);
	await picker.getByRole('button', { name: 'Done' }).click();
	await expect(picker).toHaveCount(0);

	// The pick was saved, not just shown.
	await page.reload();
	await expect(page.locator('li.slot[data-role="primary"] b')).toContainText(name);

	// New slot: choose the material, tap a swatch, the slot appears in one step.
	await page.getByRole('button', { name: 'Add a color' }).click();
	await page.getByRole('button', { name: /^TPU/ }).click();
	await picker.getByLabel('Search colors').fill('black');
	await picker.getByTestId('swatch').first().click();
	await expect(picker).toHaveCount(0);
	await expect(page.locator('li.slot')).toHaveCount(5);
	await expect(page.locator('li.slot').last()).toContainText(/TPU/i);
});

test('design tab: the next step goes to Print, where the export lives', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'design-export');
	await page.goto(`/builds/${buildId}/design`);
	await expect(page.getByTestId('export-open')).toHaveCount(0);

	await page.getByTestId('next-plates').click();
	await expect(page).toHaveURL(/\/print$/);
	// No printer yet: the export card asks for one.
	await expect(page.getByTestId('export-no-printer')).toBeVisible();

	await arrangeForCentauri(page);
	await expect(page.getByTestId('layout-name')).toBeVisible();
	await expect(page.getByTestId('export-card')).toBeVisible();
	await expect(page.getByTestId('export-flavor')).toBeVisible();
});
