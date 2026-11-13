import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';

const RED = { key: 'red', name: 'Cherry Red', material: 'PETG', hex: '#aa0000' };

/** Adds the colour "Cherry Red" and puts both wings on it (builds and drafts share the endpoint). */
async function addRedWithWings(page: import('@playwright/test').Page, buildId: string) {
	const r = await page.request.patch(`/api/builds/${buildId}/design`, {
		data: { addRole: RED, partRoles: { 'wing-left': 'red', 'wing-right': 'red' } }
	});
	expect(r.ok()).toBe(true);
}

const redSlot = (page: import('@playwright/test').Page) => page.locator('li.slot[data-role="red"]');

test('removing a used color: dialog lists the parts, Cancel changes nothing, Confirm reassigns', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'rmcolor');
	await addRedWithWings(page, buildId);
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();

	// Kit slots cannot be removed; only the added colour has a Remove button.
	await expect(page.locator('li.slot[data-role="primary"]')).toBeVisible();
	await expect(
		page.locator('li.slot[data-role="primary"]').getByTestId('remove-color')
	).toHaveCount(0);
	await expect(page.getByTestId('remove-color')).toHaveCount(1);

	await redSlot(page).getByTestId('remove-color').click();
	const dlg = page.getByTestId('remove-color-dialog');
	await expect(dlg).toBeVisible();
	await expect(page.getByTestId('remove-color-lead')).toContainText(
		'This filament is assigned to 2 parts. Choose the filament that replaces it.'
	);
	const parts = page.getByTestId('remove-color-parts');
	await expect(parts.locator('li')).toHaveCount(2);
	await expect(parts).toContainText('Wing Left');
	await expect(parts).toContainText('Wing Right');

	// Focus starts on the harmless button; nothing is chosen yet.
	await expect(page.getByTestId('remove-color-cancel')).toBeFocused();
	await expect(page.getByTestId('remove-color-confirm')).toBeDisabled();

	// PETG parts cannot take a flexible (TPU) filament: listed, disabled, with the reason.
	const soft = page.getByTestId('remove-replace-soft');
	await expect(soft).toBeDisabled();
	await expect(dlg.locator('label', { has: soft })).toContainText(/needs PETG/);
	await expect(page.getByTestId('remove-replace-primary')).toBeEnabled();

	// Cancel leaves everything as it was.
	await page.getByTestId('remove-color-cancel').click();
	await expect(dlg).toHaveCount(0);
	await expect(redSlot(page)).toBeVisible();
	await page.getByRole('tab', { name: 'Parts' }).click();
	await expect(page.locator('[data-testid="part-row"][data-slug="wing-left"]')).toContainText(
		'Cherry Red'
	);

	// Confirm moves both parts and drops the slot.
	await page.getByRole('tab', { name: 'Colors' }).click();
	await redSlot(page).getByTestId('remove-color').click();
	await page.getByTestId('remove-replace-primary').check();
	await page.getByTestId('remove-color-confirm').click();
	await expect(dlg).toHaveCount(0);
	await expect(redSlot(page)).toHaveCount(0);
	await expect(page.locator('li.slot')).toHaveCount(4);
	await page.getByRole('tab', { name: 'Parts' }).click();
	for (const slug of ['wing-left', 'wing-right']) {
		const r = page.locator(`[data-testid="part-row"][data-slug="${slug}"]`);
		await expect(r).toContainText('Primary');
		await expect(r).not.toContainText('Cherry Red');
	}

	// The removal is in the activity log (stable fragments only).
	await page.goto(`/builds/${buildId}`);
	const activity = page.locator('.activity');
	await expect(activity).toContainText(/removed/i);
	await expect(activity).toContainText('Cherry Red');
});

test('remove dialog fits a phone (390 and 360 px) without sideways scroll', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'rmphone');
	await addRedWithWings(page, buildId);
	for (const w of [390, 360]) {
		await page.setViewportSize({ width: w, height: 800 });
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('tab', { name: 'Colors' }).click();
		await redSlot(page).getByTestId('remove-color').click();
		const dlg = page.getByTestId('remove-color-dialog');
		await expect(dlg).toBeVisible();
		const m = await dlg.evaluate((el) => ({
			dlg: el.scrollWidth - el.clientWidth,
			page: document.documentElement.scrollWidth - document.documentElement.clientWidth
		}));
		expect(m.dlg, `dialog overflows at ${w}px`).toBeLessThanOrEqual(0);
		expect(m.page, `page overflows at ${w}px`).toBeLessThanOrEqual(0);
		const box = (await page.getByTestId('remove-color-cancel').boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(w);
		await page.getByTestId('remove-color-cancel').click();
		await expect(dlg).toHaveCount(0);
	}
});

test('design API: viewer is refused, used slot needs a replacement, kit slots stay', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'rmapi');
	await addRedWithWings(page, buildId);
	const url = `/api/builds/${buildId}/design`;
	const patch = (data: unknown) => page.request.patch(url, { data });

	// Used slot without a replacement: 409; a TPU replacement for PETG parts: 400; a kit slot: 400.
	expect((await patch({ removeRole: 'red' })).status()).toBe(409);
	expect((await patch({ removeRole: 'red', replaceWith: 'soft' })).status()).toBe(400);
	expect((await patch({ removeRole: 'primary', replaceWith: 'accent' })).status()).toBe(400);
	// Nothing above changed the design.
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Colors' }).click();
	await expect(redSlot(page)).toBeVisible();

	// A viewer may read but not change: lock and remove both get 403.
	await page.goto(chapterUrl);
	const email = uniqueEmail('rmviewer');
	const link = await invite(page, email, 'viewer');
	const viewer = await joinViaInvite(browser, link, 'Vera Viewer', email);
	const lock = await viewer.page.request.patch(url, {
		data: { lock: { slugs: ['wing-left'], locked: true } }
	});
	expect(lock.status()).toBe(403);
	const remove = await viewer.page.request.patch(url, {
		data: { removeRole: 'red', replaceWith: 'primary' }
	});
	expect(remove.status()).toBe(403);
	await viewer.context.close();

	// The owner's design is untouched, and a valid removal then works.
	await page.goto(`/builds/${buildId}/design`);
	await page.getByRole('tab', { name: 'Colors' }).click();
	await expect(redSlot(page)).toBeVisible();
	expect((await patch({ removeRole: 'red', replaceWith: 'primary' })).ok()).toBe(true);
	await page.reload();
	await page.getByRole('tab', { name: 'Colors' }).click();
	await expect(redSlot(page)).toHaveCount(0);
});
