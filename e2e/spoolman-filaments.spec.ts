import type { BrowserContext, Page } from '@playwright/test';
import { startMockSpoolman, type MockSpoolman } from '../src/lib/server/spoolman/mock-spoolman';
import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';

/**
 * #59: Spoolman filaments. A colour slot links to a Spoolman filament; Spare then follows
 * Spoolman's grams, logged prints take grams off the linked spool ("This app" only), the next
 * spool takes over when one runs out, and prints logged before the link can be subtracted once.
 * All against the shared fake Spoolman (`startMockSpoolman`). Every test makes its own workspace,
 * so nothing template-level changes and there is nothing to restore.
 */

let mock: MockSpoolman;
test.beforeAll(async () => {
	mock = await startMockSpoolman();
});
test.afterAll(async () => {
	await mock.close();
});
test.beforeEach(() => {
	mock.reset();
});

const origin = (page: Page) => ({ origin: new URL(page.url()).origin });
const address = () => mock.url.replace(/^https?:\/\//, '');

interface ViewJson {
	filaments: { key: string; hex: string; spoolman?: Record<string, unknown> }[];
	parts: { slug: string; role: string }[];
	runs: { id: string }[];
}
const viewOf = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

/** An owner with a build; the role of the handle-left part (on plate 1) is the slot under test. */
async function workspace(page: Page, label: string) {
	const { chapterUrl, buildId } = await ownerWithBuild(page, label);
	const v = await viewOf(page, buildId);
	const role = v.parts.find((p) => p.slug === 'handle-left')!.role;
	const hex = v.filaments.find((f) => f.key === role)!.hex.replace('#', '');
	return { chapterUrl, buildId, role, hex };
}

/** Team page: enter the Spoolman address and save it (the first save defaults to "This app"). */
async function connect(page: Page, chapterUrl: string) {
	await page.goto(`${chapterUrl}/integrations`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('spoolman-url').fill(address());
	await page.getByTestId('spoolman-save').click();
	await expect(page.getByTestId('spoolman-deduct')).toBeEnabled();
}

const tileOf = (page: Page, role: string) =>
	page.locator(`[data-testid="filament-tile"][data-role="${role}"]`);

/** Overview (desktop width, so the rows are open): link the slot to a mock filament by the picker. */
async function linkOnOverview(page: Page, buildId: string, role: string, name: string) {
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	const tile = tileOf(page, role);
	await tile.getByTestId('spoolman-link').click();
	await expect(page.getByTestId('spoolman-picker')).toBeVisible();
	await page.getByTestId('spoolman-filament-option').filter({ hasText: name }).first().click();
	return tile;
}

/** Today: a print dated before the link is never taken from Spoolman. */
const today = () => new Date().toISOString().slice(0, 10);
const gramsIn = (t: string) => Number(/([\d,.]+) g/.exec(t)![1].replace(/,/g, ''));

test.describe('Spoolman filaments (#59)', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
	});

	test('settings: "This app" is the default once an address is saved; switching to "Something else" sticks', async ({
		page
	}) => {
		const { chapterUrl } = await workspace(page, 'smkept');
		await page.goto(`${chapterUrl}/integrations`);
		await page.waitForLoadState('networkidle');
		// Disabled until there is an address.
		await expect(page.getByTestId('spoolman-deduct')).toBeDisabled();
		await expect(page.getByTestId('spoolman-kept-other')).toBeDisabled();
		await page.getByTestId('spoolman-url').fill(address());
		await page.getByTestId('spoolman-save').click();
		await expect(page.getByTestId('spoolman-deduct')).toBeChecked();
		await expect(page.getByTestId('spoolman-kept-other')).not.toBeChecked();

		await page.getByTestId('spoolman-kept-other').check();
		await expect(page.getByTestId('spoolman-kept-other')).toBeChecked();
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('spoolman-kept-other')).toBeChecked();
		await expect(page.getByTestId('spoolman-deduct')).not.toBeChecked();
		await page.getByTestId('spoolman-deduct').check();
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('spoolman-deduct')).toBeChecked();
	});

	test('link a colour from the Overview: Spare follows Spoolman and the app spools hide; unlink brings them back', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smlink');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addFilament({ id: 2, name: 'Unrelated Grey', color_hex: '888888', material: 'PLA' });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });

		// Before Spoolman is set up the slot only offers to connect it.
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('spoolman-line-off')).toBeVisible();
		await expect(page.getByTestId('spoolman-link')).toHaveCount(0);

		await connect(page, chapterUrl);
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		const tile = tileOf(page, role);
		await expect(tile.getByTestId('spoolman-line')).toContainText('Not linked to Spoolman');
		const appSpare = gramsIn(await tile.getByTestId('filament-spare').innerText());
		await expect(tile.getByTestId('spool-add')).toBeVisible();

		// Suggestions are shown; the matching colour is among the best matches.
		await tile.getByTestId('spoolman-link').click();
		const options = page.getByTestId('spoolman-filament-option');
		await expect(options.filter({ hasText: 'Cobalt Blue' })).toBeVisible();
		await expect(options.filter({ hasText: 'Cobalt Blue' })).toContainText('900 g left');
		await options.filter({ hasText: 'Cobalt Blue' }).click();

		// Linked: the line names the filament and its grams; Spare is Spoolman's figure.
		await expect(tile.getByTestId('spoolman-label')).toHaveText('Acme Cobalt Blue');
		await expect(tile.getByTestId('spoolman-stock')).toHaveText('900 g left');
		await expect(tile.getByTestId('spool-total')).toContainText('900 g');
		await expect(tile.getByTestId('spool-add')).toHaveCount(0);
		await expect(tile.getByTestId('spoolman-unlink')).toBeVisible();
		const linkedSpare = gramsIn(await tile.getByTestId('filament-spare').innerText());
		expect(linkedSpare).not.toBe(appSpare);
		// It survives a reload (it is on the server, not in the page).
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(tile.getByTestId('spoolman-stock')).toHaveText('900 g left');
		await expect(tile.getByTestId('spool-add')).toHaveCount(0);
		const v = await viewOf(page, buildId);
		expect(v.filaments.find((f) => f.key === role)!.spoolman).toMatchObject({ filamentId: 1 });

		// The starting-spools history says why it is not counted.
		await tile.getByTestId('spool-total').click();
		await expect(tile.getByTestId('spool-hidden-note')).toContainText('Linked to Spoolman');

		// Unlink: the app's own spools count again.
		await tile.getByTestId('spoolman-unlink').click();
		await expect(tile.getByTestId('spoolman-line')).toContainText('Not linked to Spoolman');
		await expect(tile.getByTestId('spool-add')).toBeVisible();
		await expect(tile.getByTestId('spool-total')).toContainText('kg');
		expect(gramsIn(await tile.getByTestId('filament-spare').innerText())).toBe(appSpare);
	});

	// APP BUG (reported, not patched): nothing refreshes a filament-linked slot's cached stock on
	// page load (SpoolRemaining, the only caller of GET /spoolman, is hidden for those slots), so a
	// weight changed in Spoolman by another tool never shows until a print or a re-link. This is
	// the whole point of "Something else". Expected to fail until fixed; then drop `test.fail`.
	test('Spoolman weights changed elsewhere show up on the Overview', async ({ page }) => {
		test.fail(true, 'stock cache is not refreshed for filament-linked slots on page load');
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smstale');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });
		await connect(page, chapterUrl);
		await page.getByTestId('spoolman-kept-other').check();
		const tile = await linkOnOverview(page, buildId, role, 'Cobalt Blue');
		await expect(tile.getByTestId('spoolman-stock')).toHaveText('900 g left');
		mock.spools.get(1)!.used_weight = 300;
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(tile.getByTestId('spoolman-stock')).toHaveText('700 g left', { timeout: 5_000 });
	});

	test('prints logged before the link: prompt, "Also subtract", Give back, relink does not subtract twice', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smpre');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });
		await connect(page, chapterUrl);

		// Log a print BEFORE linking (nothing is deducted: nothing is linked).
		const logged = await page.request.post(`/api/builds/${buildId}/runs`, {
			data: { plateNumber: 1, date: '2026-11-03', result: 'Success', grams: 120, hours: 2 }
		});
		expect(logged.ok()).toBe(true);
		expect(mock.remaining(1)).toBe(900);

		const tile = await linkOnOverview(page, buildId, role, 'Cobalt Blue');
		const prompt = page.getByTestId('spoolman-prelink');
		await expect(prompt).toContainText('already logged on this build before linking');
		const n = gramsIn(await prompt.locator('b').innerText());
		expect(n).toBeGreaterThan(0);
		// Default choice: Spoolman's weight is current, so nothing is taken.
		await expect(page.getByTestId('prelink-subtract')).not.toBeChecked();
		await page.getByTestId('prelink-subtract').check();
		await page.getByTestId('prelink-done').click();
		await expect(page.getByTestId('spoolman-picker')).toHaveCount(0);
		await expect(tile.getByTestId('spoolman-prelink-done')).toContainText(
			'from earlier prints were subtracted'
		);
		expect(mock.remaining(1)).toBeCloseTo(900 - n, 0);
		await expect(tile.getByTestId('spoolman-stock')).toHaveText(`${900 - n} g left`);

		// Give back restores the grams.
		await tile.getByTestId('prelink-undo').click();
		await expect(tile.getByTestId('spoolman-prelink-done')).toHaveCount(0);
		await expect.poll(() => mock.remaining(1)).toBeCloseTo(900, 0);
		await expect(tile.getByTestId('spoolman-prelink-note')).toContainText('before linking');

		// Subtract from the note instead, then unlink and relink: it is not subtracted twice.
		await tile.getByTestId('prelink-apply').click();
		await expect(tile.getByTestId('spoolman-prelink-done')).toBeVisible();
		const after = mock.remaining(1);
		expect(after).toBeCloseTo(900 - n, 0);
		await tile.getByTestId('spoolman-unlink').click();
		await expect(tile.getByTestId('spoolman-line')).toContainText('Not linked to Spoolman');
		await tile.getByTestId('spoolman-link').click();
		await page
			.getByTestId('spoolman-filament-option')
			.filter({ hasText: 'Cobalt Blue' })
			.first()
			.click();
		// Whatever the prompt offers, leaving it on the default takes nothing more.
		if (await page.getByTestId('prelink-done').isVisible()) {
			await page.getByTestId('prelink-done').click();
		}
		await expect(tile.getByTestId('spoolman-label')).toHaveText('Acme Cobalt Blue');
		expect(mock.remaining(1)).toBeCloseTo(after, 0);
		expect(mock.calls.filter((c) => c.startsWith('PUT') && c.includes('/use'))).toHaveLength(2);
	});

	test('"This app": a logged print takes grams off the spool, moves on when it runs out, and undo gives them back', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smded');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 0 });
		mock.addSpool({ id: 2, filament_id: 1, initial_weight: 1000, used_weight: 0 });
		await connect(page, chapterUrl);
		const tile = await linkOnOverview(page, buildId, role, 'Cobalt Blue');
		await expect(tile.getByTestId('spoolman-label')).toHaveText('Acme Cobalt Blue');

		// Plain deduction: a small print comes off the first spool only.
		const first = await page.request.post(`/api/builds/${buildId}/runs`, {
			data: { plateNumber: 1, date: today(), result: 'Success', grams: 60, hours: 1 }
		});
		expect(first.ok()).toBe(true);
		expect((await first.json()).spoolmanWarning).toBeUndefined();
		const took = 1000 - mock.remaining(1);
		expect(took).toBeGreaterThan(0);
		expect(mock.remaining(2)).toBe(1000);
		const firstRunId = (await first.json()).id as string;

		// Leave 5 g on spool #1: the next print overflows to spool #2 and the move is logged.
		mock.spools.get(1)!.used_weight = 995;
		const second = await page.request.post(`/api/builds/${buildId}/runs`, {
			data: { plateNumber: 1, date: today(), result: 'Success', grams: 60, hours: 1 }
		});
		expect(second.ok()).toBe(true);
		const secondRunId = (await second.json()).id as string;
		expect(mock.remaining(1)).toBe(0);
		expect(1000 - mock.remaining(2)).toBeCloseTo(took - 5, 0);

		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		await expect(tile.getByTestId('spoolman-line')).toContainText('Spool #2 in use');
		await page.goto(`/builds/${buildId}/activity`);
		await expect(
			page.locator('.activity li').filter({ hasText: 'moved on to Spoolman spool #2' })
		).toContainText('because spool #1 ran out');

		// Undo of the second print gives the grams back (newest first).
		const undo = await page.request.post(`/api/builds/${buildId}/runs/${secondRunId}/undo`, {
			data: { parts: [] },
			headers: origin(page)
		});
		expect(undo.ok(), await undo.text()).toBe(true);
		expect(mock.remaining(2)).toBe(1000);
		expect(mock.remaining(1)).toBeCloseTo(5, 0);
		// Deleting the first one returns the rest.
		const del = await page.request.delete(`/api/builds/${buildId}/runs/${firstRunId}`, {
			headers: origin(page)
		});
		expect(del.ok()).toBe(true);
		expect(mock.remaining(1)).toBeCloseTo(1000 - 995 + took, 0);
	});

	test('"Something else": a logged print changes nothing in Spoolman', async ({ page }) => {
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smother');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 250 });
		await connect(page, chapterUrl);
		await page.getByTestId('spoolman-kept-other').check();
		await expect(page.getByTestId('spoolman-kept-other')).toBeChecked();

		const tile = await linkOnOverview(page, buildId, role, 'Cobalt Blue');
		await expect(tile.getByTestId('spoolman-stock')).toHaveText('750 g left');
		await expect(tile.getByText('Weights kept up to date elsewhere')).toBeVisible();

		const run = await page.request.post(`/api/builds/${buildId}/runs`, {
			data: { plateNumber: 1, date: '2026-11-04', result: 'Success', grams: 80, hours: 1 }
		});
		expect(run.ok()).toBe(true);
		expect(mock.remaining(1)).toBe(750);
		expect(mock.calls.filter((c) => /^(PUT|PATCH|POST)/.test(c) && !c.includes('/info'))).toEqual(
			[]
		);
		// Spare uses what Spoolman says, which the print did not touch.
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(tile.getByTestId('spoolman-stock')).toHaveText('750 g left');
		// No pre-link subtraction is offered either.
		await expect(tile.getByTestId('spoolman-prelink-note')).toHaveCount(0);
	});

	test('a viewer sees the Spoolman line but no link, unlink or subtract controls', async ({
		page,
		browser
	}) => {
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smview');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });
		const logged = await page.request.post(`/api/builds/${buildId}/runs`, {
			data: { plateNumber: 1, date: '2026-11-03', result: 'Success', grams: 90, hours: 1 }
		});
		expect(logged.ok()).toBe(true);
		await connect(page, chapterUrl);
		const tile = await linkOnOverview(page, buildId, role, 'Cobalt Blue');
		// A pre-link note is on offer for the editor, so the viewer can be shown without it.
		if (await page.getByTestId('prelink-done').isVisible())
			await page.getByTestId('prelink-done').click();
		await expect(tile.getByTestId('spoolman-prelink-note')).toBeVisible();

		const contexts: BrowserContext[] = [];
		try {
			await page.goto(chapterUrl);
			const email = uniqueEmail('viewer');
			const link = await invite(page, email, 'viewer');
			const joined = await joinViaInvite(browser, link, 'Vera Viewer', email);
			contexts.push(joined.context);
			const v = joined.page;
			await v.setViewportSize({ width: 1440, height: 900 });
			await v.goto(`/builds/${buildId}`);
			await v.waitForLoadState('networkidle');
			const vt = tileOf(v, role);
			await expect(vt.getByTestId('spoolman-label')).toHaveText('Acme Cobalt Blue');
			await expect(vt.getByTestId('spoolman-stock')).toHaveText('900 g left');
			await expect(vt.getByTestId('spoolman-link')).toHaveCount(0);
			await expect(vt.getByTestId('spoolman-unlink')).toHaveCount(0);
			await expect(vt.getByTestId('prelink-apply')).toHaveCount(0);
			await expect(vt.getByTestId('prelink-undo')).toHaveCount(0);
			await expect(vt.getByRole('button', { name: /Other filament|Spool…/ })).toHaveCount(0);
			await expect(vt.getByTestId('spool-add')).toHaveCount(0);
			// The server refuses what the UI hides.
			const put = await v.request.put(`/api/builds/${buildId}/filaments/${role}/spoolman`, {
				data: { filamentId: null },
				headers: origin(v)
			});
			expect(put.status()).toBe(403);
		} finally {
			for (const c of contexts) await c.close();
		}
	});

	test('the setup wizard has a Spoolman step between Colors and Files only when Spoolman is set up', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smwiz');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });

		// Without Spoolman: Colors goes straight to Files.
		await page.goto(`/builds/${buildId}/setup?step=3`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('design-workspace')).toBeVisible();
		await page.getByTestId('wizard-next').click();
		await expect(page).toHaveURL(/step=4/);
		await expect(page.getByTestId('setup-spoolman')).toHaveCount(0);
		await page.goto(`/builds/${buildId}/setup?step=spoolman`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('setup-spoolman')).toHaveCount(0);

		await connect(page, chapterUrl);
		await page.goto(`/builds/${buildId}/setup?step=3`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('design-workspace')).toBeVisible();
		await page.getByTestId('wizard-next').click();
		await expect(page).toHaveURL(/step=spoolman/);
		const step = page.getByTestId('setup-spoolman');
		await expect(step).toBeVisible();
		const slot = step.locator(`[data-testid="setup-spoolman-slot"][data-role="${role}"]`);
		await slot.getByTestId('spoolman-link').click();
		await page
			.getByTestId('spoolman-filament-option')
			.filter({ hasText: 'Cobalt Blue' })
			.first()
			.click();
		await expect(slot.getByTestId('spoolman-stock')).toHaveText('900 g left');
		// Back goes to Colors, Continue to Files.
		await page.getByTestId('wizard-back').click();
		await expect(page).toHaveURL(/step=3/);
		await page.getByTestId('wizard-next').click();
		await expect(page).toHaveURL(/step=spoolman/);
		await page.getByTestId('wizard-next').click();
		await expect(page).toHaveURL(/step=4/);
		await page.getByTestId('wizard-back').click();
		await expect(page).toHaveURL(/step=spoolman/);
	});

	test('the Design tab slot panel shows the Spoolman line and links from there', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const { chapterUrl, buildId, role, hex } = await workspace(page, 'smslot');
		mock.addFilament({ id: 1, name: 'Cobalt Blue', color_hex: hex });
		mock.addSpool({ id: 1, filament_id: 1, initial_weight: 1000, used_weight: 100 });
		await connect(page, chapterUrl);

		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('tab', { name: 'Colors' }).click();
		const slot = page.locator(`li.slot[data-role="${role}"]`);
		await expect(slot.getByTestId('spoolman-line')).toContainText('Not linked to Spoolman');
		await slot.getByTestId('spoolman-link').click();
		await page
			.getByTestId('spoolman-filament-option')
			.filter({ hasText: 'Cobalt Blue' })
			.first()
			.click();
		await expect(slot.getByTestId('spoolman-label')).toHaveText('Acme Cobalt Blue');
		await expect(slot.getByTestId('spoolman-stock')).toHaveText('900 g left');
		await expect(slot).toContainText('in Spoolman');
		// The same link shows on the Overview.
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		await expect(tileOf(page, role).getByTestId('spoolman-label')).toHaveText('Acme Cobalt Blue');
	});
});
