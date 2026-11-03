import { expect, test } from './fixtures';
import { ownerWithBuild, row } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

test('a past print log can be edited or deleted and part statuses follow', async ({ page }) => {
	await ownerWithBuild(page, 'runedit');
	await page.getByRole('link', { name: 'Parts', exact: true }).click();
	await expect(page).toHaveURL(/\/parts$/);
	const parts = page.locator('.row');
	const slugA = (await parts.nth(0).getAttribute('data-id')) as string;
	const nameA = (await parts.nth(0).locator('.pbtn').innerText()).trim();
	const slugB = (await parts.nth(1).getAttribute('data-id')) as string;

	const logSheet = page.getByRole('dialog', { name: /Log print/ });
	const editSheet = page.getByRole('dialog', { name: 'Edit print log' });

	async function logOnPart(slug: string, result: string, grams?: string) {
		const r = row(page, slug);
		if (!(await r.getByRole('button', { name: 'Log a print…' }).isVisible())) {
			await r.getByRole('button', { name: /^Details for / }).click();
		}
		await r.getByRole('button', { name: 'Log a print…' }).click();
		await expect(logSheet).toBeVisible();
		await logSheet.getByRole('button', { name: result, exact: true }).click();
		if (grams) await logSheet.getByLabel('Filament used (g)').fill(grams);
		await logSheet.getByRole('button', { name: 'Save' }).click();
		await expect(logSheet).toBeHidden();
	}

	// Mistaken Success on part A -> Printed, then delete the log from the edit sheet.
	await logOnPart(slugA, 'Success');
	await expect(row(page, slugA)).toHaveAttribute('data-s', 'Printed');
	await expect(row(page, slugA).locator('tbody tr')).toHaveCount(1);

	await row(page, slugA).getByRole('button', { name: 'Edit entry' }).click();
	await expect(editSheet).toBeVisible();
	const fits = await page.evaluate(() => {
		const d = document.querySelector('dialog[open]') as HTMLElement;
		return {
			page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
			dialog: d.scrollWidth <= d.clientWidth && d.getBoundingClientRect().width <= 390
		};
	});
	expect(fits).toEqual({ page: true, dialog: true });
	await expect(editSheet.getByRole('button', { name: 'Success', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await editSheet.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(editSheet).toContainText(`Delete this log? ${nameA} goes back to To print.`);
	await editSheet.getByRole('button', { name: 'Delete log' }).click();
	await expect(editSheet).toBeHidden();
	await expect(row(page, slugA)).toHaveAttribute('data-s', 'To print');
	await expect(row(page, slugA).locator('tbody tr')).toHaveCount(0);

	// Editing grams and note on another log changes the values only.
	await logOnPart(slugB, 'Failed', '10');
	await expect(row(page, slugB)).toHaveAttribute('data-s', 'Reprint');
	await row(page, slugB).getByRole('button', { name: 'Edit entry' }).click();
	await expect(editSheet).toBeVisible();
	await editSheet.getByLabel('Filament used (g)').fill('77');
	await editSheet.getByLabel('Notes').fill('Stringy');
	await editSheet.getByRole('button', { name: 'Save' }).click();
	await expect(editSheet).toBeHidden();
	const log = row(page, slugB).locator('tbody tr');
	await expect(log).toHaveCount(1);
	await expect(log).toContainText('77');
	await expect(log).toContainText('Stringy');
	await expect(row(page, slugB)).toHaveAttribute('data-s', 'Reprint');

	// Changing the result to Success prints the part.
	await row(page, slugB).getByRole('button', { name: 'Edit entry' }).click();
	await editSheet.getByRole('button', { name: 'Success', exact: true }).click();
	await editSheet.getByRole('button', { name: 'Save' }).click();
	await expect(editSheet).toBeHidden();
	await expect(row(page, slugB)).toHaveAttribute('data-s', 'Printed');
});
