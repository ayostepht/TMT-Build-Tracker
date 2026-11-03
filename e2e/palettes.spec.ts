import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

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

test('generate a palette from a base color, preview it and apply it', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'generate');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	const gen = page.getByTestId('generator');
	await expect(gen).toBeVisible();

	await gen.getByRole('button', { name: 'Base #e53935' }).click();
	await gen.getByRole('button', { name: 'Triadic' }).click();
	const chosen = gen.locator('.nm');
	await expect(chosen).toHaveCount(4);
	const first = await chosen.allInnerTexts();

	await gen.getByRole('button', { name: 'Shuffle' }).click();
	await expect.poll(async () => (await chosen.allInnerTexts()).join('|')).not.toBe(first.join('|'));

	await gen.getByRole('button', { name: 'Preview' }).click();
	const banner = page.getByTestId('preview-banner');
	await expect(banner).toContainText('Triadic');
	const hexes = () => banner.getAttribute('data-hexes');
	const triadic = await hexes();
	expect(triadic).toMatch(/primary:#/);

	// A previewed palette follows its inputs: theme, base color, shuffle.
	await gen.getByRole('button', { name: 'Monochrome' }).click();
	await expect(banner).toContainText('Monochrome');
	await expect.poll(hexes).not.toBe(triadic);
	const mono = await hexes();
	await gen.getByRole('button', { name: 'Shuffle' }).click();
	await expect.poll(hexes).not.toBe(mono);
	const shuffled = await hexes();
	await gen.getByRole('button', { name: 'Base #1e88e5' }).click();
	await expect(banner).toContainText('#1e88e5');
	await expect.poll(hexes).not.toBe(shuffled);
	// The preview matches the swatches shown for the current inputs.
	await expect(banner).toHaveAttribute('data-hexes', /primary:#/);
	const names = await chosen.allInnerTexts();

	await gen.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByText(/^Applied Monochrome/)).toBeVisible();

	await page.goto(`/builds/${buildId}`);
	const filament = page.getByRole('region', { name: 'Filament' });
	for (const n of names) await expect(filament).toContainText(n);
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
	await page.getByLabel('Preferred brand').selectOption('Overture');
	await expect.poll(() => banner.getAttribute('data-hexes')).not.toBe(before);
});

test('a relaxed match explains itself under the swatch', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'relaxed');
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Palettes' }).click();
	// With Overture preferred, Columbus Blues has no close Overture soft TPU and falls back to another brand.
	await page.getByLabel('Preferred brand').selectOption('Overture');
	const card = page.locator('[data-palette="columbus-blues"]');
	const note = card.getByTestId('relaxed-note');
	await expect(note).toHaveCount(1);
	await expect(note).toContainText('No close standard filament');
	await expect(note).toContainText('not Overture');
	// The note sits outside the filament name so the name stays clean.
	await expect(card.locator('.nm', { hasText: 'No close standard' })).toHaveCount(0);
	// Exact matches carry no note.
	await expect(
		page.locator('[data-palette="mono-graphite"]').getByTestId('relaxed-note')
	).toHaveCount(0);
});
