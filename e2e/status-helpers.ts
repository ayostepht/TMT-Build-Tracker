import { expect, type Locator, type Page } from '@playwright/test';

/** Open a status badge (`plate-status` / `part-status`) and pick one of its menu items. */
export async function chooseStatus(badge: Locator, status: string) {
	await badge.click();
	await badge.page().getByTestId(`status-option-${status}`).click();
}

/**
 * Open a status badge and click one of the actions below its statuses ("Print some parts…",
 * "Print some pieces…": `plate-print-some`, `plate-print-some-pieces`, `part-print-some`).
 */
export async function chooseExtra(badge: Locator, testid: string) {
	await badge.click();
	await badge.page().getByTestId('status-menu').getByTestId(testid).click();
}

/**
 * Is the action offered in the badge's menu? Opens the menu, looks, closes it again (Escape). A viewer's
 * badge is a plain label with no menu: nothing is offered. Poll it: `expect.poll(() => offers(...))`.
 */
export async function offers(badge: Locator, testid: string): Promise<boolean> {
	if ((await badge.getAttribute('aria-haspopup')) !== 'menu') return false;
	const page = badge.page();
	await badge.click();
	const menu = page.getByTestId('status-menu');
	await expect(menu).toBeVisible();
	const found = (await menu.getByTestId(testid).count()) > 0;
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	return found;
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
