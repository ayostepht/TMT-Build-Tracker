import { expect, type Locator, type Page } from '@playwright/test';

/** Open a status badge (`plate-status` / `part-status`) and pick one of its menu items. */
export async function chooseStatus(badge: Locator, status: string) {
	await badge.click();
	await badge.page().getByTestId(`status-option-${status}`).click();
}

/** "Where is it printing?": the dialog behind choosing Printing when a printer is connected. */
export async function confirmWhere(page: Page, printer: 'none' | 'first' = 'none') {
	const dlg = page.getByTestId('where-printing');
	await expect(dlg).toBeVisible();
	if (printer === 'none') await dlg.getByTestId('where-none').check();
	await dlg.getByTestId('where-confirm').click();
	await expect(dlg).toBeHidden();
}
