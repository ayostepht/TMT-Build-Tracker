import { expect, type Page } from '@playwright/test';

/**
 * From the Integrations page: Add a printer, then the "Elegoo on your network" option. Leaves the
 * form open (name, address, port and the rest are the caller's to fill).
 */
export async function openElegooForm(page: Page) {
	await page.getByTestId('add-printer').click();
	await expect(page.getByTestId('printer-chooser')).toBeVisible();
	await page.getByTestId('option-elegoo-lan').click();
	await expect(page.getByTestId('printer-form')).toBeVisible();
}

/** Open the Integrations page of a workspace (by its Builds URL) and wait for the printers section. */
export async function gotoIntegrations(page: Page, chapterUrl: string) {
	await page.goto(`${chapterUrl}/integrations`);
	await expect(page.getByTestId('integrations-printers')).toBeVisible();
	await page.waitForLoadState('networkidle');
}
