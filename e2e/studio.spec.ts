import { expect, test } from './fixtures';
import { openNav, signUp, uniqueEmail, TUNED_LAYOUT } from './helpers';

const SHOTS = 'data/shots-studio';

test('studio: draft, recolor, plates, hidden from builds, make it a build', async ({ page }) => {
	await signUp(page, 'Stella Studio', uniqueEmail('studio'));
	await page.waitForLoadState('networkidle');

	// No drafts yet; the Builds menu always offers New build.
	await page.getByTestId('builds-menu').click();
	await expect(page.getByTestId('menu-new-build')).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByTestId('nav-studio').click();
	await expect(page).toHaveURL(/\/studio/);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
	const id = new URL(page.url()).pathname.split('/')[2];

	// Draft chrome: badge, make-a-build action, only three tabs.
	await expect(page.getByTestId('draft-badge')).toHaveText('Draft');
	await expect(page.getByTestId('make-build')).toBeVisible();
	const tabs = page.getByRole('navigation', { name: 'Build sections' });
	await expect(tabs.getByRole('link')).toHaveText(['Design', 'Files', '⚙ Settings']);
	await expect(page.getByText('Draft 1').first()).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/e2e-draft-design.png` });

	// Recolor: move the wings to the first slot.
	await page.getByRole('tab', { name: 'Parts' }).click();
	const wing = page.locator('[data-testid="part-row"][data-slug="wing-left"]');
	const before = await wing.innerText();
	await wing.click();
	await page.getByTestId('part-sheet').locator('button[data-role="primary"]').click();
	await expect(page.locator('[data-testid="part-row"][data-slug="wing-left"]')).not.toHaveText(
		before
	);

	// Tracking pages bounce back to the draft; the API refuses tracking changes.
	await page.goto(`/builds/${id}/print`);
	await expect(page).toHaveURL(new RegExp(`/builds/${id}/design`));
	const res = await page.request.patch(`/api/builds/${id}`, { data: { phase: 'printing' } });
	expect(res.status()).toBe(400);

	// Generate plates.
	await page.goto(`/builds/${id}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: TUNED_LAYOUT });
	await expect(page.getByTestId('layout-name')).toContainText("MakeGood's");
	await expect(page.getByRole('button', { name: /Log a print/ })).toHaveCount(0);
	await page.screenshot({ path: `${SHOTS}/e2e-draft-files.png` });

	// Not in the Builds menu before promotion.
	await page.getByTestId('builds-menu').click();
	await expect(page.getByTestId('builds-menu-panel')).not.toContainText('Draft 1');
	await page.keyboard.press('Escape');

	// Make it a build: lands in the setup wizard at Export, and the menu lists it.
	await page.getByTestId('make-build').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${id}/setup\\?step=5`));
	await page.getByTestId('builds-menu').click();
	await expect(page.getByTestId('builds-menu-panel')).toContainText('Draft 1');
	await page.keyboard.press('Escape');
	await page.goto(`/builds/${id}`);
	await expect(page.getByTestId('draft-badge')).toHaveCount(0);
	await expect(tabs.getByRole('link', { name: 'Print' })).toBeVisible();

	// A second draft can be deleted from the Studio.
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await expect(page.locator('[data-draft]')).toHaveCount(0);
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/design/);
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await expect(page.locator('[data-draft]')).toHaveCount(1);
	const deleteDraft = page.getByTestId('delete-draft');
	await deleteDraft.click();
	await expect(
		page.getByTestId('delete-dialog').getByRole('button', { name: 'Cancel' })
	).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('delete-dialog')).toHaveCount(0);
	await expect(deleteDraft).toBeFocused();
	await expect(page.locator('[data-draft]')).toHaveCount(1);
	await deleteDraft.click();
	await page.getByTestId('confirm-delete').click();
	await expect(page.locator('[data-draft]')).toHaveCount(0);
});

test('studio: screenshots (phone, desktop, wide; light and dark)', async ({ page }) => {
	await signUp(page, 'Shot Studio', uniqueEmail('studio-shots'));
	await page.waitForLoadState('networkidle');
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/design/);
	const id = new URL(page.url()).pathname.split('/')[2];
	await page.goto(`/builds/${id}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: TUNED_LAYOUT });
	await expect(page.getByTestId('layout-name')).toContainText("MakeGood's");

	for (const [w, h] of [
		[390, 844],
		[1440, 900],
		[2560, 1300]
	]) {
		for (const scheme of ['light', 'dark'] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.emulateMedia({ colorScheme: scheme });
			const tag = `${w}-${scheme}`;
			await page.goto('/studio');
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${SHOTS}/studio-${tag}.png` });
			await page.goto(`/builds/${id}/design`);
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${SHOTS}/draft-design-${tag}.png` });
			await page.goto(`/builds/${id}/files`);
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${SHOTS}/draft-files-${tag}.png` });
			await page.goto(`/builds/${id}/settings`);
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${SHOTS}/draft-settings-${tag}.png` });
			await openNav(page);
			await page.getByTestId('builds-menu').click();
			await page.screenshot({ path: `${SHOTS}/builds-menu-empty-${tag}.png` });
			await page.keyboard.press('Escape');
		}
	}
});

test('studio draft: lock a part, apply a palette, remove an added color', async ({ page }) => {
	await signUp(page, 'Dana Draft', uniqueEmail('studio-remove'));
	await page.waitForLoadState('networkidle');
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
	const id = new URL(page.url()).pathname.split('/')[2];
	const res = await page.request.patch(`/api/builds/${id}/design`, {
		data: {
			addRole: { key: 'red', name: 'Cherry Red', material: 'PETG', hex: '#aa0000' },
			partRoles: { 'wing-left': 'red', 'wing-right': 'red', 'seat-center': 'accent' }
		}
	});
	expect(res.ok()).toBe(true);
	await page.reload();
	await page.waitForLoadState('networkidle');
	const partRow = (slug: string) => page.locator(`[data-testid="part-row"][data-slug="${slug}"]`);

	// Lock a part, then apply a palette: the wings reset, the locked part stays.
	await page.getByRole('tab', { name: 'Parts' }).click();
	await partRow('seat-center').click();
	await page.getByTestId('part-lock').click();
	await expect(page.getByTestId('part-lock')).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Close part details' }).click();
	await page.getByRole('tab', { name: 'Palettes' }).click();
	const list = page.getByRole('group', { name: 'Ready-made palettes' });
	if (!(await list.isVisible()))
		await page.getByTestId('readymade-toggle').locator('summary').click();
	await page.locator('[data-palette="fire-truck"]').click();
	await expect(page.getByTestId('palette-reset-note')).toContainText('1 locked kept');
	await page.getByTestId('palette-bar').getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByTestId('palette-bar')).toHaveCount(0);
	await page.getByRole('tab', { name: 'Parts' }).click();
	await expect(partRow('seat-center').getByTestId('part-row-locked')).toBeVisible();
	await expect(partRow('wing-left')).not.toContainText('Cherry Red');

	// Put the wings back on the added colour, then remove it through the dialog.
	const back = await page.request.patch(`/api/builds/${id}/design`, {
		data: { partRoles: { 'wing-left': 'red', 'wing-right': 'red' } }
	});
	expect(back.ok()).toBe(true);
	await page.reload();
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	const red = page.locator('li.slot[data-role="red"]');
	await red.getByTestId('remove-color').click();
	await expect(page.getByTestId('remove-color-lead')).toContainText('assigned to 2 parts');
	await page.getByTestId('remove-replace-primary').check();
	await page.getByTestId('remove-color-confirm').click();
	await expect(red).toHaveCount(0);
	await page.getByRole('tab', { name: 'Parts' }).click();
	await expect(partRow('wing-left')).toContainText('Primary');
});
