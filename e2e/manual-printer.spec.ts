import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';
import { chooseStatus } from './status-helpers';
import type { Page } from '@playwright/test';

// r49 tracking: a "Not connected" printer in "Where is it printing?", the Printer select in the log
// sheet (prefilled from where the plate was started) and the quiet "Connect a printer" hint.
// Shots (invented names only) in data/r49-shots-tracking/ (gitignored).
const DIR = 'data/r49-shots-tracking';

async function orgOf(page: Page, buildId: string) {
	return (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
}
async function addManual(page: Page, org: string, name: string) {
	const r = await page.request.post('/api/printers', {
		data: { organizationId: org, name, kind: 'manual' },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(r.ok()).toBe(true);
}
// The first plate still to print, and the first plate that is printing (its status menu opens
// the log sheet through "Printed").
const plateBadge = (page: Page) =>
	page
		.locator('.group-head')
		.locator('[data-testid="plate-status"][data-status="To print"]')
		.first();
const printingBadge = (page: Page) =>
	page
		.locator('.group-head')
		.locator('[data-testid="plate-status"][data-status="Printing"]')
		.first();
async function openLog(page: Page) {
	await chooseStatus(printingBadge(page), 'Printed');
}

test('with no printer there is no dialog, and the hint links to Integrations and can be dismissed', async ({
	page,
	browser
}) => {
	test.setTimeout(150_000);
	const { buildId, chapterUrl } = await ownerWithBuild(page, 'hint');
	await page.goto(`/builds/${buildId}/print`);
	await page.getByLabel('Group by').selectOption('plate');
	const hint = page.getByTestId('printer-hint');
	await expect(hint).toBeVisible();
	await expect(hint).toContainText('Connect a printer to follow prints automatically');
	await expect(page.getByTestId('printer-hint-link')).toHaveAttribute(
		'href',
		/\/teams\/[^/]+\/integrations$/
	);

	// No printer at all: Printing starts the plate directly.
	await chooseStatus(plateBadge(page), 'Printing');
	await expect(page.getByTestId('where-printing')).toHaveCount(0);
	await expect(page.locator('.row[data-s="Printing"]').first()).toBeVisible();

	await page.goto(`/builds/${buildId}/files`);
	await expect(hint).toBeVisible();
	await page.getByTestId('printer-hint-link').click();
	await expect(page).toHaveURL(/\/teams\/[^/]+\/integrations$/);

	await page.goto(`/builds/${buildId}/print`);
	await expect(hint).toBeVisible();
	await hint.getByRole('button', { name: 'Dismiss' }).click();
	await expect(hint).toBeHidden();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(hint).toHaveCount(0);
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
	await expect(hint).toHaveCount(0);

	// A viewer never sees it.
	await page.goto(chapterUrl);
	const viewerEmail = uniqueEmail('hintviewer');
	const link = await invite(page, viewerEmail, 'viewer');
	const v = await joinViaInvite(browser, link, 'Vera Viewer', viewerEmail);
	try {
		await v.page.goto(`/builds/${buildId}/print`);
		await v.page.waitForLoadState('networkidle');
		await expect(v.page.getByTestId('printer-hint')).toHaveCount(0);
		await v.page.goto(`/builds/${buildId}/files`);
		await v.page.waitForLoadState('networkidle');
		await expect(v.page.getByTestId('printer-hint')).toHaveCount(0);
	} finally {
		await v.context.close();
	}
});

test('a not-connected printer: dialog, no confirm prompt, prefilled log, saved name; Not set saves null', async ({
	page
}) => {
	test.setTimeout(180_000);
	const { buildId } = await ownerWithBuild(page, 'manual');
	const org = await orgOf(page, buildId);
	await addManual(page, org, 'Garage printer');

	await page.goto(`/builds/${buildId}/print`);
	await page.getByLabel('Group by').selectOption('plate');
	// The hint is for workspaces with no printer at all.
	await expect(page.getByTestId('printer-hint')).toHaveCount(0);

	await chooseStatus(plateBadge(page), 'Printing');
	const dlg = page.getByTestId('where-printing');
	await expect(dlg).toBeVisible();
	await expect(dlg).toContainText('Garage printer');
	await expect(dlg).toContainText('not connected');
	await expect(dlg.getByTestId('where-none')).toBeVisible();
	await expect(dlg).toContainText('Somewhere else');
	await dlg.getByTestId('where-confirm').click();
	await expect(dlg).toBeHidden();
	await expect(page.locator('.row[data-s="Printing"]').first()).toBeVisible();
	// A manual printer never reports a job: no follow-up question and no live block.
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);
	await expect(page.getByTestId('printer-hint')).toHaveCount(0);

	// The log sheet prefills the printer the plate was started on; the run keeps its name.
	await openLog(page);
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByTestId('log-printer')).toHaveValue('Garage printer');
	await sheet.getByRole('button', { name: 'Success', exact: true }).click();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	await page.getByTestId('plate-history-toggle').first().click();
	const table = page.locator('table.log').first();
	await expect(table).toContainText('Garage printer');

	// The activity sentences name the printer too.
	await page.getByRole('link', { name: 'Overview' }).click();
	await expect(page.locator('body')).toContainText('on Garage printer');

	// "Somewhere else" starts plainly; the log sheet offers the printer but is not prefilled.
	await page.goto(`/builds/${buildId}/print`);
	await page.getByLabel('Group by').selectOption('plate');
	await chooseStatus(plateBadge(page), 'Printing');
	await expect(dlg).toBeVisible();
	await dlg.getByTestId('where-none').check();
	await dlg.getByTestId('where-confirm').click();
	await expect(dlg).toBeHidden();
	await openLog(page);
	await expect(sheet.getByTestId('log-printer')).toHaveValue('');
	await sheet.getByRole('button', { name: 'Success', exact: true }).click();
	// Choosing the printer by hand works too, and Not set clears it again.
	await sheet.getByTestId('log-printer').selectOption('Garage printer');
	await sheet.getByTestId('log-printer').selectOption('');
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	const runs = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		runs: { printer: string | null }[];
	};
	const saved = runs.runs.map((r) => r.printer);
	expect(saved).toHaveLength(2);
	expect(saved).toContain('Garage printer');
	expect(saved).toContain(null);
});

test('shots: dialog with a connected and a not-connected printer, log sheet, hint', async ({
	page
}) => {
	test.setTimeout(300_000);
	const sdcp = new MockSdcp();
	await sdcp.start();
	try {
		const { buildId } = await ownerWithBuild(page, 'r49shots');
		const org = await orgOf(page, buildId);
		// Hint first: a workspace without printers.
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.goto(`/builds/${buildId}/print`);
			await expect(page.getByTestId('printer-hint')).toBeVisible();
			await page.screenshot({ path: `${DIR}/hint-${w}-light.png` });
		}
		const r = await page.request.post('/api/printers', {
			data: {
				organizationId: org,
				name: 'Shop CC1',
				kind: 'elegoo-sdcp',
				host: '127.0.0.1',
				port: sdcp.port,
				secrets: { mainboardId: 'ABCDEF' }
			}
		});
		expect(r.ok()).toBe(true);
		await addManual(page, org, 'Garage printer');
		sdcp.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });

		await page.emulateMedia({ colorScheme: 'light' });
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			// The printer list must be loaded, or Printing starts without asking.
			const loaded = page.waitForResponse((r) => r.url().includes('/printer-jobs'));
			await page.goto(`/builds/${buildId}/print`);
			await loaded;
			await chooseStatus(plateBadge(page), 'Printing');
			const dlg = page.getByTestId('where-printing');
			await expect(dlg).toBeVisible();
			// Connected printers first, not-connected after.
			const labels = await dlg.locator('.wp-opt').allInnerTexts();
			expect(labels[0]).toContain('Shop CC1');
			expect(labels[1]).toContain('Garage printer');
			expect(labels[1]).toContain('not connected');
			await page.screenshot({ path: `${DIR}/dialog-${w}-light.png` });
			await dlg.locator('input[type="radio"]').nth(1).check();
			await dlg.getByTestId('where-confirm').click();
			await expect(dlg).toBeHidden();
			await openLog(page);
			const sheet = page.getByRole('dialog');
			await expect(sheet.getByTestId('log-printer')).toHaveValue('Garage printer');
			await page.screenshot({ path: `${DIR}/log-sheet-${w}-light.png` });
			await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click();
			await expect(sheet).toBeHidden();
			// Back to To print for the next viewport.
			await chooseStatus(printingBadge(page), 'To print');
		}
	} finally {
		await sdcp.stop();
	}
});
