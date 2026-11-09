import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import { resolvePalette } from '../src/lib/domain/palettes.ts';
import { swatches as serverSwatches } from '../src/lib/server/filaments/index.ts';

test('apply a pre-made palette: matched filaments show on Overview, Undo restores', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'palette');
	await page.goto(`/builds/${buildId}/design`);
	const original = await page.locator('li.slot[data-role="primary"] b').innerText();

	await page.getByRole('tab', { name: 'Palettes' }).click();
	const card = page.locator('[data-palette="fire-truck"]');
	await expect(card).toBeVisible();
	const names = await card.locator('.nm').allInnerTexts();
	expect(names).toHaveLength(4);
	expect(names.every((n) => n !== 'No match')).toBe(true);

	// Preview recolors without saving.
	await card.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByTestId('preview-banner')).toContainText('Fire Truck');
	// Leaving the tab drops the preview.
	await page.getByRole('tab', { name: 'Slots' }).click();
	await expect(page.getByTestId('preview-banner')).toHaveCount(0);
	await page.reload();
	await expect(page.locator('li.slot[data-role="primary"] b')).toContainText(original);

	// Apply saves all four slots.
	await page.getByRole('tab', { name: 'Palettes' }).click();
	await page.locator('[data-palette="fire-truck"]').getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByText('Applied Fire Truck')).toBeVisible();
	await page.goto(`/builds/${buildId}`);
	const filament = page.getByRole('region', { name: 'Filament' });
	for (const n of names) await expect(filament).toContainText(n);

	// Undo puts the old filaments back.
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	await page.locator('[data-palette="camo"]').getByRole('button', { name: 'Apply' }).click();
	await page.getByRole('button', { name: 'Undo' }).click();
	await page.getByRole('tab', { name: 'Slots' }).click();
	await expect(page.locator('li.slot[data-role="primary"] b')).toContainText(names[0]);
});

const PINK = '#ec407a';
const PURPLE = '#8e24aa';
const real = { petg: serverSwatches('petg'), tpu: serverSwatches('tpu') };

test('lock pink and purple, pick from auto-filled variations, preview, apply and undo', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'generate');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	const gen = page.getByTestId('generator');
	await expect(gen).toBeVisible();

	// Primary starts locked to the build's current primary; clear it, then quick swatches fill Primary, Accent.
	const tile = (slot: string) => gen.locator(`.tile[data-slot="${slot}"]`);
	await expect(tile('primary')).toHaveClass(/locked/);
	await expect(tile('accent')).not.toHaveClass(/locked/);
	await gen.getByRole('button', { name: 'Clear Primary (back to Auto)' }).click();
	await expect(tile('primary')).not.toHaveClass(/locked/);
	await gen.getByRole('button', { name: `Color ${PINK}` }).click();
	await gen.getByRole('button', { name: `Color ${PURPLE}` }).click();
	await expect(tile('primary')).toContainText(PINK);
	await expect(tile('accent')).toContainText(PURPLE);
	await expect(tile('soft')).toContainText('Auto');

	const cards = page.getByTestId('variations').locator('[data-variation]');
	await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(4);
	// Every card keeps the filaments nearest to the two chosen colors, and marks them as yours.
	const want = resolvePalette(
		{ primary: PINK, accent: PURPLE, soft: '#888888', tire: '#222222' },
		real
	);
	const n = await cards.count();
	for (let i = 0; i < n; i++) {
		const names = await cards.nth(i).locator('.nm').allInnerTexts();
		expect(names[0]).toBe(want.primary!.name);
		expect(names[1]).toBe(want.accent!.name);
		await expect(cards.nth(i).getByTestId('yours-primary')).toHaveCount(1);
		await expect(cards.nth(i).getByTestId('yours-accent')).toHaveCount(1);
		await expect(cards.nth(i).getByTestId('yours-soft')).toHaveCount(0);
	}
	// The auto-filled soft/tire differ between variations.
	const softs = new Set<string>();
	for (let i = 0; i < n; i++) softs.add((await cards.nth(i).locator('.nm').allInnerTexts())[2]);
	expect(softs.size).toBeGreaterThan(1);

	// More variations appends the next set.
	await page.getByRole('button', { name: 'More variations' }).click();
	await expect.poll(() => cards.count()).toBeGreaterThan(n);

	// Preview one: the 3D preview label shows, and it follows the locked colors.
	// The first card: it survives locking another slot (a later card can become a duplicate and vanish).
	const second = cards.nth(0);
	await second.getByRole('button', { name: 'Preview' }).click();
	const banner = page.getByTestId('preview-banner');
	await expect(banner).toContainText(PINK);
	const hexes = () => banner.getAttribute('data-hexes');
	const before = await hexes();
	await gen.getByRole('button', { name: `Color #e53935` }).click(); // fills the next Auto slot, Primary (TPU)
	await expect(tile('soft')).toContainText('#e53935');
	await expect.poll(hexes).not.toBe(before);
	await gen.getByRole('button', { name: /^Clear Primary \(TPU\)/ }).click();
	await expect(tile('soft')).toContainText('Auto');
	await second.getByRole('button', { name: 'Stop preview' }).click();
	await expect(banner).toHaveCount(0);

	// A theme filter shows that theme only; "All themes" brings the mix back.
	await gen.getByRole('button', { name: 'Triadic' }).click();
	await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(3);
	for (const t of await cards.locator('.pname b').allInnerTexts()) expect(t).toMatch(/^Triadic/);
	await gen.getByRole('button', { name: 'All themes' }).click();

	// Apply the third variation: the build's primary and accent filaments change.
	const third = cards.nth(2);
	const applied = await third.locator('.nm').allInnerTexts();
	await third.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByText(/^Applied /)).toBeVisible();
	await page.getByRole('tab', { name: 'Slots' }).click();
	await expect(page.locator('li.slot[data-role="primary"] b')).toContainText(applied[0]);
	await expect(page.locator('li.slot[data-role="accent"] b')).toContainText(applied[1]);
	await page.goto(`/builds/${buildId}`);
	const filament = page.getByRole('region', { name: 'Filament' });
	for (const nm of applied) await expect(filament).toContainText(nm);

	// Undo restores the original primary.
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	await page
		.getByTestId('variations')
		.locator('[data-variation]')
		.first()
		.getByRole('button', { name: 'Apply' })
		.click();
	await page.getByRole('button', { name: 'Undo' }).click();
	await page.getByRole('tab', { name: 'Slots' }).click();
	await expect(page.locator('li.slot[data-role="primary"] b')).toContainText(applied[0]);
});

test('slot tiles: select a slot for the next color, use current, clear back to Auto', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'tiles');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	const gen = page.getByTestId('generator');
	const tile = (slot: string) => gen.locator(`.tile[data-slot="${slot}"]`);
	await expect(tile('primary')).toHaveClass(/locked/);

	// Selecting Accent (TPU) sends the next quick color there instead of the first Auto slot.
	const tires = tile('tire').getByRole('button', { pressed: false }).first();
	await tires.click();
	await expect(tile('tire').locator('.tsel')).toHaveAttribute('aria-pressed', 'true');
	await gen.getByRole('button', { name: 'Color #212121' }).click();
	await expect(tile('tire')).toContainText('#212121');
	await expect(tile('accent')).toContainText('Auto');

	// Use current locks the accent to the build's current accent filament color.
	await tile('accent')
		.getByRole('button', { name: /^Use current/ })
		.click();
	await expect(tile('accent')).toHaveClass(/locked/);
	await expect(tile('accent').locator('.hexin')).toHaveValue(/^#[0-9a-f]{6}$/);

	// Clearing returns the slot to Auto and variations stay available.
	await tile('accent')
		.getByRole('button', { name: /^Clear Accent/ })
		.click();
	await expect(tile('accent')).not.toHaveClass(/locked/);
	await expect(tile('accent')).toContainText('Auto');
	await expect(tile('accent').locator('.hexin')).toHaveValue('');
	await expect(page.getByTestId('variations').locator('[data-variation]')).toHaveCount(6);
	await expect(page.getByTestId('yours-accent')).toHaveCount(0);
});

/** Tick brands in the compact "Prefer brand" multi-select (closes it again). */
async function preferBrands(page: import('@playwright/test').Page, brands: string[]) {
	const box = page.getByTestId('brand-pref');
	await box.locator('summary').click();
	for (const b of brands) await box.getByRole('checkbox', { name: b, exact: true }).check();
	await box.locator('summary').click();
}

test('several preferred brands can be chosen and are remembered', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'multibrand');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	const box = page.getByTestId('brand-pref');
	await expect(box.locator('summary')).toContainText('Any brand');
	await preferBrands(page, ['Overture', 'Sunlu']);
	await expect(box.locator('summary')).toContainText('Overture +1');
	await page.reload();
	await page.getByRole('tab', { name: 'Palettes' }).click();
	await expect(box.locator('summary')).toContainText('Overture +1');
	await box.locator('summary').click();
	await expect(box.getByRole('checkbox', { name: 'Sunlu', exact: true })).toBeChecked();
	await box.getByRole('button', { name: 'Any brand' }).click();
	await expect(box.locator('summary')).toContainText('Any brand');
});

test('the old single preferred brand is migrated', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'migrate');
	await page.addInitScript(() => {
		if (!localStorage.getItem('tmt.preferredBrands.v2'))
			localStorage.setItem('tmt.preferredBrand.v1', 'Polymaker');
	});
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	await expect(page.getByTestId('brand-pref').locator('summary')).toContainText('Polymaker');
});

test('a previewed ready-made palette follows the preferred brand', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'brandfollow');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	const card = page.locator('[data-palette="columbus-blues"]');
	await card.getByRole('button', { name: 'Preview' }).click();
	const banner = page.getByTestId('preview-banner');
	await expect(banner).toContainText('Columbus Blues');
	const before = await banner.getAttribute('data-hexes');
	await preferBrands(page, ['Overture']);
	await expect.poll(() => banner.getAttribute('data-hexes')).not.toBe(before);
});

test('a relaxed match explains itself under the swatch', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'relaxed');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	// With Overture preferred, Columbus Blues has no close Overture soft TPU and falls back to another brand.
	await preferBrands(page, ['Overture']);
	const card = page.locator('[data-palette="columbus-blues"]');
	const note = card.getByTestId('relaxed-note');
	await expect(note).toHaveCount(1);
	await expect(note).toContainText(/No close (standard filament|Overture match)/);
	await expect(note).toContainText('Overture');
	// The note sits outside the filament name so the name stays clean.
	await expect(card.locator('.nm', { hasText: 'No close standard' })).toHaveCount(0);
	// Exact matches carry no note: not every ready-made card has one.
	const all = page.locator('[data-palette]');
	const withNote = page.locator('[data-palette]:has([data-testid="relaxed-note"])');
	expect(await withNote.count()).toBeLessThan(await all.count());
});
