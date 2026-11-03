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
	const names = await chosen.allInnerTexts();

	await gen.getByRole('button', { name: 'Preview' }).click();
	await expect(page.getByTestId('preview-banner')).toContainText('Triadic');
	await gen.getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByText(/^Applied Triadic/)).toBeVisible();

	await page.goto(`/builds/${buildId}`);
	const filament = page.getByRole('region', { name: 'Filament' });
	for (const n of names) await expect(filament).toContainText(n);
});
