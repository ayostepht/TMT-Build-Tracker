import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { startMockSpoolman, type MockSpoolman } from '../src/lib/server/spoolman/mock-spoolman';
import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';

/**
 * #59 part 3: "Create in Spoolman" in the link picker. No Spoolman filament matches, so the maker
 * creates the vendor and filament from the prefilled form and the colour is linked to it.
 * With SPOOLMAN_SHOTS=<dir> it also writes screenshots of the form (phone light/dark, desktop).
 */
test.use({ deviceScaleFactor: process.env.SPOOLMAN_SHOTS ? 2 : 1 });
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

/**
 * #59 part 2: on a linked colour the + is "Add spool in Spoolman". The spool is created in Spoolman
 * (initial weight = kg x 1000, the note as comment), shows in the history, and removing it asks
 * whether to archive it there too. Viewers get neither the + nor Remove.
 */
test('add a spool in Spoolman, remove it with archive or keep, viewers see neither', async ({
	page,
	browser
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	mock.reset();
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'smadd');
	const view = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const role = view.parts.find((p: { slug: string }) => p.slug === 'handle-left').role as string;
	const hex = view.filaments.find((f: { key: string }) => f.key === role).hex.replace('#', '');
	mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
	await page.goto(`${chapterUrl}/integrations`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('spoolman-url').fill(mock.url.replace(/^https?:\/\//, ''));
	await page.getByTestId('spoolman-save').click();
	await expect(page.getByTestId('spoolman-deduct')).toBeEnabled();

	const tile = page.locator(`[data-testid="filament-tile"][data-role="${role}"]`);
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	// Not linked yet: the app-only add, no Spoolman add.
	await expect(tile.getByTestId('spool-add')).toBeVisible();
	await expect(tile.getByTestId('spoolman-add')).toHaveCount(0);
	await tile.getByTestId('spoolman-link').click();
	await page
		.getByTestId('spoolman-filament-option')
		.filter({ hasText: 'Cobalt Blue' })
		.first()
		.click();
	await expect(tile.getByTestId('spoolman-add')).toBeVisible();
	await expect(tile.getByTestId('spool-add')).toHaveCount(0);

	const dir = process.env.SPOOLMAN_SHOTS;
	const shot = async (name: string) => {
		if (!dir) return;
		mkdirSync(dir, { recursive: true });
		await tile.screenshot({ path: `${dir}/addspool-${name}.png` });
	};

	const add = async (kg: string, note: string) => {
		const form = tile.getByTestId('spoolman-add-form');
		if (!(await form.isVisible())) await tile.getByTestId('spoolman-add').click();
		await tile.getByTestId('spool-kg').fill(kg);
		await tile.getByTestId('spool-note').fill(note);
		return form;
	};
	await add('0.75', 'bought at the fair');
	await shot('form-1440-light');
	await tile.getByTestId('spool-save').click();
	await expect(tile.getByTestId('spoolman-add-form')).toHaveCount(0);
	await expect(tile.getByTestId('spool-add-row')).toHaveCount(1);
	await expect(tile.getByTestId('spool-spoolman-tag')).toContainText('Spoolman spool #');
	expect(mock.spools.size).toBe(1);
	const first = [...mock.spools.values()][0];
	expect(first.filament_id).toBe(1);
	expect(first.initial_weight).toBe(750);
	expect(first.comment).toBe('bought at the fair');
	await expect(tile.getByTestId('spool-total')).toContainText('750 g');

	await add('1', '');
	await tile.getByTestId('spool-save').click();
	await expect(tile.getByTestId('spool-add-row')).toHaveCount(2);
	expect(mock.spools.size).toBe(2);

	// Remove the first and archive it in Spoolman.
	const rows = tile.getByTestId('spool-add-row');
	await rows.filter({ hasText: '0.75' }).getByTestId('spool-remove').click();
	await expect(tile.getByTestId('spool-archive-question')).toContainText(
		'Also archive it in Spoolman?'
	);
	await shot('archive-1440-light');
	await tile.getByTestId('spool-archive-yes').click();
	await expect(rows).toHaveCount(1);
	expect(mock.spools.get(first.id)!.archived).toBe(true);

	// Remove the second and keep it in Spoolman.
	const second = [...mock.spools.values()].find((x) => x.id !== first.id)!;
	await rows.first().getByTestId('spool-remove').click();
	await tile.getByTestId('spool-archive-no').click();
	await expect(rows).toHaveCount(0);
	expect(mock.spools.get(second.id)!.archived).toBe(false);

	if (dir) {
		for (const [w, scheme] of [
			[390, 'light'],
			[390, 'dark']
		] as const) {
			await page.setViewportSize({ width: w, height: 900 });
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			await tile.locator('button[aria-expanded]').first().click();
			await tile.getByTestId('spoolman-add').click();
			await tile.getByTestId('spool-kg').fill('0.75');
			await tile.getByTestId('spool-note').fill('bought at the fair');
			await shot(`form-${w}-${scheme}`);
			await tile.getByTestId('spool-save').click();
			await expect(tile.getByTestId('spool-add-row')).toHaveCount(1);
			await tile.getByTestId('spool-remove').click();
			await shot(`archive-${w}-${scheme}`);
			await tile.getByTestId('spool-archive-no').click();
			await expect(tile.getByTestId('spool-add-row')).toHaveCount(0);
		}
		await page.setViewportSize({ width: 1440, height: 900 });
	}

	// A viewer sees the history but no +, no Remove.
	const email = uniqueEmail('smviewer');
	await page.goto(chapterUrl);
	const link = await invite(page, email, 'viewer');
	const viewer = await joinViaInvite(browser, link, 'Vera Viewer', email);
	const vp = viewer.page;
	await vp.setViewportSize({ width: 1440, height: 900 });
	await vp.goto(`/builds/${buildId}`);
	await vp.waitForLoadState('networkidle');
	const vtile = vp.locator(`[data-testid="filament-tile"][data-role="${role}"]`);
	await vtile.getByTestId('spool-total').click();
	await expect(vtile.getByTestId('spool-history')).toBeVisible();
	await expect(vtile.getByTestId('spoolman-add')).toHaveCount(0);
	await expect(vtile.getByTestId('spool-add')).toHaveCount(0);
	await expect(vtile.getByTestId('spool-remove')).toHaveCount(0);
	await viewer.context.close();
});
