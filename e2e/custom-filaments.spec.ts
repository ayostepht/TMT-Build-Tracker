import { expect, test } from './fixtures';
import { createBuild, ownerWithBuild } from './helpers';

test('custom filaments: add from the swatch picker, reuse on another build, edit, delete', async ({
	page
}) => {
	const { buildId, chapterUrl } = await ownerWithBuild(page, 'customfil');
	await page.goto(chapterUrl);
	const other = await createBuild(page, 'Second chair');

	// Open the picker on the primary slot and add a filament.
	await page.goto(`/builds/${buildId}/design`);
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	await expect(picker.getByText('Add custom color')).toHaveCount(0);
	await picker.getByTestId('add-filament').click();
	const form = picker.getByTestId('custom-filament-form');
	await form.getByLabel('Brand', { exact: true }).fill('TestBrand');
	await form.getByLabel('Type', { exact: true }).selectOption('PETG HF');
	await form.getByLabel('Color name').fill('Lime Zest');
	await form.getByLabel('Color hex').fill('#7acc2e');
	await form.getByLabel('Finish', { exact: true }).selectOption('glossy');
	await form.getByRole('button', { name: 'Save and use' }).click();

	// Applied to the slot and listed under My filaments.
	const slot = page.locator('li.slot[data-role="primary"]');
	await expect(slot).toContainText('TestBrand Lime Zest');
	const mine = picker.getByTestId('my-filaments');
	await expect(mine).toContainText('TestBrand Lime Zest');
	await expect(mine).toContainText('PETG HF');
	await picker.getByRole('button', { name: 'Done' }).click();
	await page.goto(`/builds/${buildId}`);
	await expect(page.getByRole('region', { name: 'Filament' })).toContainText('TestBrand Lime Zest');

	// Another build in the same workspace sees it.
	await page.goto(`/builds/${other}/design`);
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker2 = page.getByTestId('swatch-picker');
	await expect(picker2.getByTestId('my-filaments')).toContainText('TestBrand Lime Zest');

	// The same brand, type and name again is not added twice: the existing one is used.
	await picker2.getByTestId('add-filament').click();
	const form2 = picker2.getByTestId('custom-filament-form');
	await form2.getByLabel('Brand', { exact: true }).fill('testbrand');
	await form2.getByLabel('Type', { exact: true }).selectOption('Other…');
	await form2.getByLabel('Other type').fill('PETG HF');
	await form2.getByLabel('Color name').fill('lime zest');
	await form2.getByRole('button', { name: 'Save and use' }).click();
	await expect(picker2.getByTestId('my-filament')).toHaveCount(1);

	// Edit the name.
	await picker2.getByRole('button', { name: 'Edit TestBrand Lime Zest' }).click();
	const edit = picker2.getByTestId('custom-filament-form');
	await edit.getByLabel('Color name').fill('Lime Burst');
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(picker2.getByTestId('my-filaments')).toContainText('TestBrand Lime Burst');

	// Delete with a confirmation.
	await picker2.getByRole('button', { name: 'Delete TestBrand Lime Burst' }).click();
	await picker2.getByRole('button', { name: 'Keep', exact: true }).click();
	await expect(picker2.getByTestId('my-filament')).toHaveCount(1);
	await picker2.getByRole('button', { name: 'Delete TestBrand Lime Burst' }).click();
	await picker2.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(picker2.getByTestId('my-filament')).toHaveCount(0);

	// The first build keeps its own copy of the color.
	await page.goto(`/builds/${buildId}`);
	await expect(page.getByRole('region', { name: 'Filament' })).toContainText('TestBrand Lime Zest');
});
