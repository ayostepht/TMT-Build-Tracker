import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

test('Settings shows the build colors, keeps spool counts editable, and sends colors to Design', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect(page).toHaveURL(/\/settings$/);

	// One summary row per role: no second colour editor here.
	const role = page.locator('.fil-role').first();
	await expect(role).toBeVisible();
	await expect(page.getByText('Pick from the filament catalog')).toHaveCount(0);
	await expect(role.getByLabel('Color', { exact: true })).toHaveCount(0);

	// The Spools input stays inside its card on a wide screen.
	await page.setViewportSize({ width: 1440, height: 900 });
	const card = page.getByTestId('settings-filament');
	const cardBox = (await card.boundingBox())!;
	const inputBox = (await role.getByLabel('Spools (kg)').boundingBox())!;
	expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);

	// Spool counts are edited here and survive a reload.
	const spools = role.getByLabel('Spools (kg)');
	await spools.fill('3');
	await spools.blur();
	await expect(spools).toHaveValue('3');
	await page.reload();
	await expect(page.locator('.fil-role').first().getByLabel('Spools (kg)')).toHaveValue('3');

	// Colors are changed in the Design tab.
	await page.getByTestId('change-colors').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}/design`));
});
