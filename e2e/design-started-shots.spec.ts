import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arrangeForCentauri, createBuild, ownerWithBuild } from './helpers';

// Issue #56, design side: applying a design to a build that has started printing asks first.
// Runs only with SHOTS_56=<dir> (screenshots go there); the functional checks run either way.
const DIR = process.env.SHOTS_56;

async function api(page: Page, method: string, url: string, data?: unknown) {
	const res = await page.request.fetch(url, { method, data });
	return { status: res.status(), body: await res.json().catch(() => ({})) };
}

/** A build with plates arranged for a Centauri; `status` puts one part on it. */
async function startedBuild(
	page: Page,
	chapterUrl: string,
	name: string,
	status: 'Printing' | 'Reprint'
) {
	await page.goto(chapterUrl);
	const id = await createBuild(page, name);
	await page.goto(`/builds/${id}/files`);
	await arrangeForCentauri(page);
	await expect(page.getByTestId('layout-name')).toBeVisible();
	const { body } = await api(page, 'GET', `/api/builds/${id}/view`);
	const view = body as {
		allParts: { slug: string; role: string }[];
		plates: { parts: string[] }[];
	};
	const onPlate = view.plates[0].parts[0];
	expect(
		(await api(page, 'POST', `/api/builds/${id}/parts/${onPlate}/status`, { status })).status
	).toBe(200);
	// Stock on the soft slot (so the dialog calls it out) and a locked part on the tire slot.
	await api(page, 'PATCH', `/api/builds/${id}/filaments/soft`, { spools: 2 });
	const tire = view.allParts.find((p) => p.role === 'tire')!;
	await api(page, 'PATCH', `/api/builds/${id}/design`, {
		lock: { slugs: [tire.slug], locked: true }
	});
	return id;
}

async function shots(page: Page, name: string) {
	if (!DIR) return;
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		]) {
			await page.setViewportSize({ width: w, height: h });
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png` });
		}
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.emulateMedia({ colorScheme: 'light' });
}

async function openDialog(page: Page, id: string) {
	await page.goto(`/builds/${id}/design`);
	await page.getByTestId('open-apply').click();
	await page.getByTestId('apply-design-select').selectOption({ label: 'Shots design (mine)' });
	await page.getByRole('button', { name: 'Apply this design…' }).click();
	await page.getByTestId('started-apply-dialog').waitFor();
	await page.getByTestId('started-apply-summary').waitFor();
}

test('applying a design to a started build asks first', async ({ page }) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { chapterUrl } = await ownerWithBuild(page, 'started-apply');
	await page.goto(chapterUrl);

	// A design that recolors four slots: accent to TPU (another material), tire (the build locks a tire part).
	const src = await createBuild(page, 'Source');
	await api(page, 'PATCH', `/api/builds/${src}/design`, {
		palette: {
			label: 'Shots',
			slots: {
				primary: { name: 'Ocean', material: 'PETG', hex: '#0044cc' },
				accent: { name: 'Soft Lime', material: 'TPU 95A', hex: '#66dd00' },
				soft: { name: 'Lime TPU', material: 'TPU 95A', hex: '#88ee22' },
				tire: { name: 'Charcoal', material: 'TPU 95A', hex: '#333333' }
			}
		}
	});
	const made = await api(page, 'POST', '/api/designs', {
		buildId: src,
		name: 'Shots design',
		isPublic: false
	});
	expect(made.status).toBe(200);

	// 1. A plate is printing: colors only is on offer, replacing print files is not.
	const printing = await startedBuild(page, chapterUrl, 'Printing build', 'Printing');
	await openDialog(page, printing);
	const dlg = page.getByTestId('started-apply-dialog');
	await expect(dlg.getByTestId('started-apply-summary')).toContainText('is printing');
	await expect(dlg.getByTestId('started-apply-skipped')).toContainText('another material');
	await expect(dlg.getByTestId('started-apply-skipped')).toContainText('locked parts');
	await expect(dlg.getByTestId('started-apply-kept')).toContainText('2 kg on hand');
	await expect(dlg.getByTestId('started-apply-blocked')).toBeVisible();
	await expect(dlg.getByTestId('started-apply-full')).toBeDisabled();
	await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await shots(page, 'dialog-printing');
	// Escape closes it without changing anything.
	await page.keyboard.press('Escape');
	await expect(dlg).toHaveCount(0);

	// 2. Started but nothing printing: both are on offer.
	const reprint = await startedBuild(page, chapterUrl, 'Reprint build', 'Reprint');
	await openDialog(page, reprint);
	await expect(dlg.getByTestId('started-apply-full')).toBeEnabled();
	await expect(dlg.getByTestId('started-apply-blocked')).toHaveCount(0);
	await shots(page, 'dialog-not-printing');

	// Colors only: slots recolor, plates stay, an Undo toast is offered.
	const before = await api(page, 'GET', `/api/builds/${reprint}/view`);
	await dlg.getByTestId('started-apply-colors').click();
	await expect(dlg).toHaveCount(0);
	await expect(page.getByText(/Applied the colors of "Shots design"/)).toBeVisible();
	await expect(page.locator('li.slot[data-role="primary"]')).toContainText('Ocean');
	const after = await api(page, 'GET', `/api/builds/${reprint}/view`);
	expect(JSON.stringify(after.body.plates)).toBe(JSON.stringify(before.body.plates));
	expect(after.body.filaments.find((f: { key: string }) => f.key === 'soft')).toMatchObject({
		spools: 2,
		name: 'Lime TPU'
	});
	// Undo puts the colors back.
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('li.slot[data-role="primary"]')).not.toContainText('Ocean');

	// Full: needs the dialog's choice; a bare API call without a mode is refused.
	const bare = await api(page, 'POST', `/api/designs/${made.body.id}/apply`, { buildId: reprint });
	expect(bare.status).toBe(409);
	expect(bare.body).toMatchObject({ code: 'build-started' });
	await openDialog(page, reprint);
	await dlg.getByTestId('started-apply-full').click();
	await expect(dlg).toHaveCount(0);
	await expect(page.getByText(/colors and print files/)).toBeVisible();
	await expect(page.locator('li.slot[data-role="primary"]')).toContainText('Ocean');
	// The plates did not move under the build: they are stale until re-arranged.
	const full = await api(page, 'GET', `/api/builds/${reprint}/view`);
	expect(JSON.stringify(full.body.plates)).toBe(JSON.stringify(before.body.plates));
});
