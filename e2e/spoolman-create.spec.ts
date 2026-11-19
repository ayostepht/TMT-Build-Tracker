import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { startMockSpoolman, type MockSpoolman } from '../src/lib/server/spoolman/mock-spoolman';
import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

/**
 * #59 part 3: "Create in Spoolman" in the link picker. No Spoolman filament matches, so the maker
 * creates the vendor and filament from the prefilled form and the colour is linked to it.
 * With SPOOLMAN_SHOTS=<dir> it also writes screenshots of the form (phone light/dark, desktop).
 */
let mock: MockSpoolman;
test.beforeAll(async () => {
	mock = await startMockSpoolman();
});
test.afterAll(async () => {
	await mock.close();
});

async function openPicker(page: Page, buildId: string, role: string) {
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	const tile = page.locator(`[data-testid="filament-tile"][data-role="${role}"]`);
	// Phones open a row to see its details.
	if (!(await tile.getByTestId('spoolman-link').isVisible()))
		await tile.locator('button[aria-expanded]').first().click();
	await tile.getByTestId('spoolman-link').click();
	await expect(page.getByTestId('spoolman-picker')).toBeVisible();
}

test('create a vendor and filament from the picker and link the colour', async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	mock.reset();
	mock.addVendor('Existing Co');
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'smcreate');
	const view = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const role = view.parts.find((p: { slug: string }) => p.slug === 'handle-left').role as string;
	await page.goto(`${chapterUrl}/integrations`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('spoolman-url').fill(mock.url.replace(/^https?:\/\//, ''));
	await page.getByTestId('spoolman-save').click();
	await expect(page.getByTestId('spoolman-deduct')).toBeEnabled();

	await openPicker(page, buildId, role);
	await page.getByTestId('spoolman-create-open').click();
	const form = page.getByTestId('spoolman-create-form');
	await expect(form).toBeVisible();
	await expect(page.getByTestId('create-density')).not.toHaveValue('');
	await expect(page.getByTestId('create-diameter')).toHaveValue('1.75');

	const dir = process.env.SPOOLMAN_SHOTS;
	if (dir) {
		mkdirSync(dir, { recursive: true });
		for (const [w, h, scheme] of [
			[390, 900, 'light'],
			[390, 900, 'dark'],
			[1440, 900, 'light']
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.emulateMedia({ colorScheme: scheme });
			await openPicker(page, buildId, role);
			await page.getByTestId('spoolman-create-open').click();
			await page.getByTestId('create-vendor').fill('Brand New Vendor');
			await expect(page.getByTestId('create-vendor-new')).toBeVisible();
			await page.getByTestId('spoolman-create-form').scrollIntoViewIfNeeded();
			await page
				.getByTestId('spoolman-picker')
				.screenshot({ path: `${dir}/create-form-${w}-${scheme}.png` });
		}
		await page.setViewportSize({ width: 1440, height: 900 });
		await openPicker(page, buildId, role);
		await page.getByTestId('spoolman-create-open').click();
	}

	await page.getByTestId('create-vendor').fill('Existing Co');
	await expect(page.getByTestId('create-vendor-new')).toHaveCount(0);
	await page.getByTestId('create-name').fill('Existing Co Teal');
	await page.getByTestId('create-submit').click();
	await expect(page.getByTestId('spoolman-picker')).toHaveCount(0);

	expect(mock.filaments.size).toBe(1);
	const f = [...mock.filaments.values()][0];
	expect(f.name).toBe('Existing Co Teal');
	expect(f.vendor.name).toBe('Existing Co');
	expect(mock.vendors.size).toBe(1); // the existing vendor was used, none created
	const after = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const slot = after.filaments.find((x: { key: string }) => x.key === role);
	expect(slot.spoolman.filamentId).toBe(f.id);
});
