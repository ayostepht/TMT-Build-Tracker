import { expect, test } from './fixtures';
import { arrangeForCentauri, ownerWithBuild } from './helpers';

// CI has no MakeGood files, so the 3D model is absent: the Design tab must work from the part list alone.
test('design tab: move parts between slots, add a color, share a design and start a build from it', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'design');

	// Overview tile of the first slot before any change.
	await page.goto(`/builds/${buildId}`);
	const tile = page.getByTestId('filament-tile').first();
	await expect(tile).toBeVisible();
	const beforeTile = await tile.innerText();

	await page.goto(`/builds/${buildId}/design`);
	await expect(page.getByTestId('no-model')).toContainText('No 3D model yet');
	await page.getByRole('tab', { name: 'Parts' }).click();

	const wing = page.locator('[data-testid="part-row"][data-slug="wing-left"]');
	const wingBefore = await wing.innerText();
	await wing.click();
	const sheet = page.getByTestId('part-sheet');
	await expect(sheet).toContainText('Wing Left');
	// Wings are PETG parts: flexible slots are listed but disabled, with the reason.
	await expect(sheet.locator('button[data-role="soft"]')).toBeDisabled();
	await expect(sheet).toContainText('PETG only');

	// "Apply to both sides" is on by default.
	await sheet.locator('button[data-role="primary"]').click();
	await expect(page.locator('[data-testid="part-row"][data-slug="wing-left"]')).not.toHaveText(
		wingBefore
	);
	const right = page.locator('[data-testid="part-row"][data-slug="wing-right"]');
	await expect(right).toContainText('Primary PETG');

	// The Overview filament tile changed (the wings moved onto the first slot).
	await page.goto(`/builds/${buildId}`);
	await expect(page.getByTestId('filament-tile').first()).not.toHaveText(beforeTile);

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
	await page.locator('[data-testid="part-row"][data-slug="handle-left"]').click();
	await page.getByLabel(/Apply to both sides/).uncheck();
	await page.getByTestId('part-sheet').locator('button[data-role="e2e-red"]').click();
	await expect(page.locator('[data-testid="part-row"][data-slug="handle-left"]')).toContainText(
		'E2E Red'
	);
	await expect(
		page.locator('[data-testid="part-row"][data-slug="handle-right"]')
	).not.toContainText('E2E Red');
	await expect(slot).toContainText('1 parts');

	// Save as a public design.
	await expect(page.getByTestId('autosave-status')).toContainText('Saved automatically');
	await page.getByTestId('open-share').click();
	const dlg = page.getByTestId('share-dialog');
	await dlg.getByLabel('Design name').fill('E2E Blues');
	await dlg.getByLabel(/Share publicly/).check();
	await dlg.getByRole('button', { name: 'Save design' }).click();
	await expect(page.getByTestId('design-saved')).toContainText('Saved "E2E Blues"');
	await page.keyboard.press('Escape');
	await expect(dlg).toHaveCount(0);

	// Apply a saved design to this build: asks first, keeps print progress.
	await page.getByTestId('open-apply').click();
	await page.getByTestId('apply-design-select').selectOption({ label: 'E2E Blues (mine)' });
	await page.getByRole('button', { name: 'Apply this design…' }).click();
	await expect(page.getByTestId('apply-design')).toContainText('Your print progress');
	await page.getByRole('button', { name: 'Replace colors' }).click();
	await expect(page.getByTestId('apply-dialog')).toHaveCount(0);
	await expect(page.locator('li.slot[data-role="e2e-red"]')).toContainText('E2E Red');

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
	// A build started from a saved design lands in the setup wizard; leaving it reaches the build.
	await expect(page).toHaveURL(/\/builds\/[^/]+\/setup$/);
	await expect(page.getByTestId('setup-wizard')).toBeVisible();
	await page.getByTestId('skip-setup').click();
	await expect(page).toHaveURL(/\/builds\/[^/]+$/);

	await page.getByRole('link', { name: 'Design', exact: true }).click();
	await expect(page.locator('li.slot[data-role="e2e-red"]')).toContainText('E2E Red');
	await page.getByRole('tab', { name: 'Parts' }).click();
	await expect(page.locator('li.slot[data-role="e2e-red"]')).toContainText('E2E Red');
	await expect(page.locator('[data-testid="part-row"][data-slug="handle-left"]')).toContainText(
		'E2E Red'
	);
	await expect(page.locator('[data-testid="part-row"][data-slug="wing-right"]')).toContainText(
		'Primary PETG'
	);
});

test('design tab: Esc, the close button and picking the same part again deselect', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'deselect');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Parts' }).click();
	const wing = page.locator('[data-testid="part-row"][data-slug="wing-left"]');
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

test('design tab: role filter chips narrow the parts list; Esc returns focus to the row', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'partfilter');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Parts' }).click();
	const rows = page.locator('[data-testid="part-row"]');
	const all = await rows.count();
	await page.locator('[data-filter="accent"]').click();
	const some = await rows.count();
	expect(some).toBeGreaterThan(0);
	expect(some).toBeLessThan(all);
	await page.locator('[data-filter="all"]').click();
	await expect(rows).toHaveCount(all);

	const wing = page.locator('[data-testid="part-row"][data-slug="wing-left"]');
	await wing.click();
	await expect(page.getByTestId('part-sheet')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('part-sheet')).toHaveCount(0);
	await expect(wing).toBeFocused();
});

test('design tab: pick a catalog swatch for a slot, search, and add a slot from a swatch', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'swatch');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();

	// Tap the slot's big swatch: the picker opens with real catalog colors.
	const slot = page.locator('li.slot[data-role="primary"]');
	const before = await slot.innerText();
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
	await expect(slot).toContainText(name);
	// The heading stays the fixed role name; the picked filament is its subtitle.
	await expect(slot.locator('b')).toHaveText('Primary PETG');
	expect(await slot.innerText()).not.toBe(before);
	await expect(picker.getByTestId('swatch-detail')).toContainText(name);
	await picker.getByRole('button', { name: 'Done' }).click();
	await expect(picker).toHaveCount(0);

	// The pick was saved, not just shown.
	await page.reload();
	await expect(page.locator('li.slot[data-role="primary"]')).toContainText(name);

	// New slot: choose the material, tap a swatch, the slot appears in one step.
	await page.getByRole('button', { name: 'Add a color' }).click();
	await page.getByRole('button', { name: /^TPU/ }).click();
	await picker.getByLabel('Search colors').fill('black');
	await picker.getByTestId('swatch').first().click();
	await expect(picker).toHaveCount(0);
	await expect(page.locator('li.slot')).toHaveCount(5);
	await expect(page.locator('li.slot').last()).toContainText(/TPU/i);
});

test('design tab: the next step goes to Files, where the export lives', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'design-export');
	await page.goto(`/builds/${buildId}/design`);
	await expect(page.getByTestId('export-open')).toHaveCount(0);

	await page.getByTestId('next-plates').click();
	await expect(page).toHaveURL(/\/files$/);
	// No printer yet: the export card asks for one.
	await expect(page.getByTestId('export-no-printer')).toBeVisible();

	await arrangeForCentauri(page);
	await expect(page.getByTestId('layout-name')).toBeVisible();
	await expect(page.getByTestId('export-card')).toBeVisible();
	await expect(page.getByTestId('export-flavor')).toBeVisible();
});

test('the swatch picker hides types palettes never use until asked', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pickertypes');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	await page.getByRole('button', { name: 'Add a color' }).click();
	await page.getByRole('button', { name: /^TPU/ }).click();
	const picker = page.getByTestId('swatch-picker');
	const labels = () =>
		picker
			.getByTestId('swatch')
			.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
	await expect(picker.getByTestId('swatch').first()).toBeVisible();
	const clean = await labels();
	expect(clean.length).toBeGreaterThan(10);
	expect(
		clean.filter((l) => /93A|silk|carbon|, TPU-?(85|90|93|98)A|\b(64|75)D\b/i.test(l))
	).toEqual([]);
	await picker.getByTestId('show-all-types').check();
	await expect.poll(async () => (await labels()).length).toBeGreaterThan(clean.length);
	await expect(picker.locator('.sw.excl').first()).toBeVisible();
	expect((await labels()).some((l) => /not used by palettes/.test(l))).toBe(true);
	// Brand chips are a multi-select.
	await picker.getByRole('button', { name: 'Overture', exact: true }).click();
	await picker.getByRole('button', { name: 'Sunlu', exact: true }).click();
	await expect(picker.getByRole('button', { name: 'Overture', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(picker.getByRole('button', { name: 'Sunlu', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(picker.getByRole('button', { name: 'All brands' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
});

test('the swatch picker merges same-looking colors of other brands and lists them', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'pickermerge');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	await page.getByRole('button', { name: 'Add a color' }).click();
	await page.getByRole('button', { name: /^TPU/ }).click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker.getByTestId('swatch').first()).toBeVisible();
	// All brands: the many near-identical blacks and whites are one swatch each.
	const merged = picker.locator('[data-testid="swatch"][aria-label*="other brands"]');
	await expect(merged.first()).toBeVisible();
	expect(await merged.count()).toBeGreaterThan(0);
	expect(await picker.getByTestId('swatch').count()).toBeLessThan(110);
	await expect(picker.getByTestId('other-brands')).toHaveCount(0);
	await merged.first().hover();
	await expect(picker.getByTestId('swatch-also')).toContainText(/also \d+ other brand/);
	const disclosure = picker.getByTestId('other-brands');
	await disclosure.locator('summary').click();
	await expect(disclosure.locator('summary')).toContainText(/^Other brands \(\d+\)$/);
	expect(await disclosure.getByTestId('other-brand').count()).toBeGreaterThan(0);
	// One brand selected: no merging.
	await picker.getByRole('button', { name: 'Overture', exact: true }).click();
	await expect(picker.locator('[data-testid="swatch"][aria-label*="other brand"]')).toHaveCount(0);
	// Picking an alternate from the list chooses that brand's filament.
	await picker.getByRole('button', { name: 'Overture', exact: true }).click();
	await merged.first().hover();
	await picker.getByTestId('other-brands').locator('summary').click();
	const alt = picker.getByTestId('other-brand').first();
	const altLabel = (await alt.getAttribute('aria-label')) ?? '';
	await alt.click();
	await expect(picker).toHaveCount(0);
	await expect(page.locator('li.slot').last()).toContainText(
		altLabel.replace(/^Use /, '').split(',')[0].split(' ')[0]
	);
});
