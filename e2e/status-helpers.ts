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

/**
 * "Where is it printing?" > the first printer: waits until the start and the printer's expectation
 * (`POST /api/printers/:id/expect`) are saved and the page has reloaded the jobs. A job that already
 * runs when the expectation lands is linked at once (no confirm), so a mock printer must not start
 * its job before this returns.
 */
export async function confirmOnPrinter(page: Page) {
	const saved = page.waitForResponse(
		(r) => /\/api\/printers\/[^/]+\/expect$/.test(r.url()) && r.request().method() === 'POST'
	);
	await confirmWhere(page, 'first');
	expect((await saved).ok()).toBe(true);
	await page.waitForLoadState('networkidle');
}
