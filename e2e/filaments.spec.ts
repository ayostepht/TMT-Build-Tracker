import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

test('pick a filament from the catalog, override the name, and see it on Overview', async ({
	page
}) => {
	await ownerWithBuild(page);
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect(page).toHaveURL(/\/settings$/);

	const role = page.locator('.fil-role').first();
	await role.getByText('Pick from the filament catalog').click();

	// Brand -> material -> color fills name, material and hex.
	const brand = role.getByLabel('Catalog brand');
	await expect(brand.locator('option[value="Overture"]')).toBeAttached();
	await brand.selectOption('Overture');
	const mat = role.getByLabel('Catalog material');
	await expect(mat).toBeEnabled();
	await mat.selectOption('PLA');
	const colors = role.getByRole('list', { name: 'Colors' });
	await role.getByLabel('Search colors').fill('blue');
	await colors.getByRole('button').first().click();

	const name = role.getByLabel('Name', { exact: true });
	await expect(name).toHaveValue(/^Overture .*blue/i);
	await expect(role.getByLabel('Material', { exact: true })).toHaveValue('PLA');
	await expect(role.getByLabel('Color', { exact: true })).toHaveValue(/^#[0-9a-f]{6}$/);

	// Quick search jumps straight to a color.
	await role.getByLabel('Quick search').fill('overture red');
	await role.getByRole('list', { name: 'Search results' }).getByRole('button').first().click();
	await expect(name).toHaveValue(/^Overture .*red/i);

	// Override the name and save (on change).
	await name.fill('Team Blue Special');
	await name.blur();
	await expect(name).toHaveValue('Team Blue Special');

	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.getByRole('region', { name: 'Filament' })).toContainText('Team Blue Special');
});
