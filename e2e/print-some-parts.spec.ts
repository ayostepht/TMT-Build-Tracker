import { expect, test } from './fixtures';
import {
	invite,
	joinViaInvite,
	keepPrintedVisible,
	ownerWithBuild,
	row,
	uniqueEmail
} from './helpers';
import { chooseExtra, chooseStatus, offers } from './status-helpers';
import type { Locator, Page } from '@playwright/test';

/**
 * "Print some parts…" on a plate: a maker who split a plate in the slicer marks or logs only some of
 * its parts; the rest stays to print. The team has no printer, so Printing is a direct mark.
 */

interface ViewJson {
	plates: { number: number; parts: string[]; perPartRuns: boolean; runs: number }[];
	runs: { id: string; plateNumber: number | null; result: string }[];
	state: Record<string, { status: string }>;
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

/** The plate with the most parts among the single-run, whole-plate ones. */
function splittable(v: ViewJson) {
	const ok = v.plates.filter((p) => !p.perPartRuns && p.runs <= 1 && p.parts.length >= 3);
	expect(ok.length, 'the tuned layout has a multi-part single-run plate').toBeGreaterThan(0);
	return ok.sort((a, b) => b.parts.length - a.parts.length)[0];
}

const head = (page: Page, plate: number) =>
	page.locator('.group-head').filter({
		has: page.locator(`[data-testid="plate-status"][aria-label^="Plate ${plate} status"]`)
	});

/** On a phone the grouping control is behind the Filter button; the page already groups by plate. */
async function groupByPlate(page: Page) {
	const select = page.getByLabel('Group by');
	if (await select.first().isVisible()) await select.first().selectOption('plate');
	else await expect(page.getByText('by Plate', { exact: true })).toBeVisible();
}

/** Print tab grouped by plate (Printed parts stay visible); returns the plate's heading. */
async function openPrint(page: Page, buildId: string, plate: number) {
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await groupByPlate(page);
	const h = head(page, plate);
	await expect(h).toBeVisible();
	return h;
}

async function openPicker(h: Locator) {
	await chooseExtra(h.getByTestId('plate-status'), 'plate-print-some');
	const dlg = h.getByTestId('part-pick');
	await expect(dlg).toBeVisible();
	return dlg;
}

const statusOf = async (page: Page, buildId: string, slug: string) =>
	(await view(page, buildId)).state[slug].status;

async function expectStatuses(page: Page, slugs: string[], status: string) {
	for (const s of slugs) await expect(row(page, s)).toHaveAttribute('data-s', status);
}

/** Unticks the first `n` parts in the picker's list. */
async function untick(dlg: Locator, n: number) {
	const items = dlg.getByTestId('part-pick-item');
	for (let i = 0; i < n; i++) await items.nth(i).getByRole('checkbox').uncheck();
}

const grams = (t: string | null) =>
	Number(/(\d[\d,]*(?:\.\d+)?) g/.exec(t ?? '')?.[1]?.replace(',', ''));

test('The picker: label, count, All and None follow the ticks', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pickui');
	const plate = splittable(await view(page, buildId));
	const n = plate.parts.length;
	const h = await openPrint(page, buildId, plate.number);
	const dlg = await openPicker(h);

	const items = dlg.getByTestId('part-pick-item');
	await expect(items).toHaveCount(n);
	for (let i = 0; i < n; i++) await expect(items.nth(i).getByRole('checkbox')).toBeChecked();
	const confirm = dlg.getByTestId('part-pick-confirm');
	const log = dlg.getByTestId('part-pick-log');
	await expect(confirm).toHaveText(`Mark all ${n} parts printing`);
	await expect(log).toHaveText(`Log ${n} parts instead…`);
	await expect(dlg).toContainText(`${n} of ${n} ticked`);

	await items.first().getByRole('checkbox').uncheck();
	await expect(confirm).toHaveText(`Mark ${n - 1} of ${n} parts printing`);
	await expect(log).toHaveText(`Log ${n - 1} parts instead…`);
	await expect(dlg).toContainText(`${n - 1} of ${n} ticked`);

	await dlg.getByTestId('part-pick-none').click();
	await expect(dlg).toContainText(`0 of ${n} ticked`);
	await expect(confirm).toBeDisabled();
	await expect(log).toBeDisabled();

	await items.first().getByRole('checkbox').check();
	await expect(confirm).toHaveText(`Mark 1 of ${n} parts printing`);
	await expect(log).toHaveText('Log 1 part instead…');
	await expect(confirm).toBeEnabled();

	await dlg.getByTestId('part-pick-all').click();
	await expect(confirm).toHaveText(`Mark all ${n} parts printing`);

	// Nothing was changed by looking.
	await dlg.getByRole('button', { name: 'Cancel', exact: true }).last().click();
	await expect(dlg).toBeHidden();
	expect((await view(page, buildId)).runs).toHaveLength(0);
});

test('Marking some parts printing: only they print, one activity row, Overview card shows the share', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'picksome');
	const plate = splittable(await view(page, buildId));
	// A slicer weight gives the plate a total to take the share of.
	const patched = await page.request.patch(`/api/builds/${buildId}/plates/${plate.number}`, {
		data: { slicerGrams: 120 },
		headers: { origin: new URL(page.url()).origin }
	});
	expect(patched.ok()).toBe(true);

	const h = await openPrint(page, buildId, plate.number);
	const dlg = await openPicker(h);
	await untick(dlg, 1);
	const picked = plate.parts.slice(1);
	// The list order is the plate's: the first item is the first part.
	await expect(dlg.getByTestId('part-pick-confirm')).toHaveText(
		`Mark ${picked.length} of ${plate.parts.length} parts printing`
	);
	await dlg.getByTestId('part-pick-confirm').click();
	await expect(dlg).toBeHidden();

	await expect(page.locator('.toasts')).toContainText('Started');
	await expectStatuses(page, picked, 'Printing');
	await expectStatuses(page, [plate.parts[0]], 'To print');
	const s = (await view(page, buildId)).state;
	for (const slug of picked) expect(s[slug].status).toBe('Printing');
	expect(s[plate.parts[0]].status).toBe('To print');

	// Overview: the card is the subset, with their share of the grams.
	await page.getByRole('link', { name: 'Overview', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
	const card = page.getByTestId('now-card');
	await expect(card).toHaveCount(1);
	const sub = card.getByTestId('now-subset');
	await expect(sub).toContainText(`${picked.length} of ${plate.parts.length} parts`);
	const g = grams(await sub.textContent());
	expect(g, 'a grams figure is shown').toBeGreaterThan(0);
	expect(g).toBeLessThan(120);

	// One activity row for the whole start.
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page).toHaveURL(/\/activity$/);
	await expect(page.locator('.activity li').filter({ hasText: 'on the printer' })).toHaveCount(1);
});

test('Undo of a partial start puts the picked parts back in one step', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pickundo');
	const plate = splittable(await view(page, buildId));
	const h = await openPrint(page, buildId, plate.number);
	const dlg = await openPicker(h);
	await untick(dlg, 1);
	await dlg.getByTestId('part-pick-confirm').click();
	await expectStatuses(page, plate.parts.slice(1), 'Printing');

	await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('.toasts')).toContainText('Undone');
	await expectStatuses(page, plate.parts, 'To print');
	await expect
		.poll(async () => (await view(page, buildId)).state[plate.parts[1]].status)
		.toBe('To print');
});

test('All ticked is the whole-plate Printing action', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pickall');
	const plate = splittable(await view(page, buildId));
	const h = await openPrint(page, buildId, plate.number);
	const dlg = await openPicker(h);
	await expect(dlg.getByTestId('part-pick-confirm')).toHaveText(
		`Mark all ${plate.parts.length} parts printing`
	);
	await dlg.getByTestId('part-pick-confirm').click();
	await expect(dlg).toBeHidden();
	await expect(page.locator('.toasts')).toContainText(`Started plate ${plate.number}`);
	await expectStatuses(page, plate.parts, 'Printing');
	// Everything is on the printer, so there is nothing left to pick.
	await expect.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some')).toBe(false);

	await page.getByRole('link', { name: 'Overview', exact: true }).click();
	await expect(page.getByTestId('now-card')).toHaveCount(1);
	await expect(page.getByTestId('now-subset')).toHaveCount(0);
});

for (const result of ['Success', 'Failed'] as const) {
	test(`"Log N parts instead…" with ${result}: only the picked parts are logged`, async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, `picklog${result.toLowerCase()}`);
		const plate = splittable(await view(page, buildId));
		const h = await openPrint(page, buildId, plate.number);
		const dlg = await openPicker(h);
		await untick(dlg, 1);
		const picked = plate.parts.slice(1);
		const rest = plate.parts[0];
		await dlg.getByTestId('part-pick-log').click();

		const sheet = page.getByRole('dialog');
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText(`${picked.length} of ${plate.parts.length} parts`);
		await sheet.getByRole('button', { name: result, exact: true }).click();
		await sheet.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(sheet).toBeHidden();

		await expectStatuses(page, picked, result === 'Success' ? 'Printed' : 'Reprint');
		// The unpicked part is untouched: To print, never Reprint.
		await expect(row(page, rest)).toHaveAttribute('data-s', 'To print');
		const v = await view(page, buildId);
		expect(v.state[rest].status).toBe('To print');
		expect(v.runs.filter((r) => r.plateNumber === plate.number).map((r) => r.result)).toEqual([
			result
		]);
	});
}

test('Sequential: log the picked parts, then start and log the rest of the plate', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'pickseq');
	const plate = splittable(await view(page, buildId));
	const last = plate.parts[plate.parts.length - 1];
	const first = plate.parts.slice(0, -1);
	// `last` is the final part; `first` is everything before it.
	expect(first.length).toBe(plate.parts.length - 1);
	const h = await openPrint(page, buildId, plate.number);
	const dlg = await openPicker(h);
	// Untick the last item only.
	await dlg.getByTestId('part-pick-item').last().getByRole('checkbox').uncheck();
	await dlg.getByTestId('part-pick-log').click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	await expectStatuses(page, first, 'Printed');
	await expect(row(page, last)).toHaveAttribute('data-s', 'To print');

	// One part left: nothing to pick any more (the plate's own Printing action covers it).
	await expect.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some')).toBe(false);
	await chooseStatus(h.getByTestId('plate-status'), 'Printing');
	await expect(row(page, last)).toHaveAttribute('data-s', 'Printing');
	for (const s of first) expect(await statusOf(page, buildId, s)).toBe('Printed');

	// The card lists only the rest, and finishing it marks only that part.
	await page.getByRole('link', { name: 'Overview', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
	const card = page.getByTestId('now-card');
	await expect(card).toHaveCount(1);
	await expect(card.locator('.now-part')).toHaveCount(1);
	await expect(card.getByTestId('now-subset')).toContainText(`1 of ${plate.parts.length} parts`);
	await chooseStatus(card.getByTestId('plate-status'), 'Printed');
	const fin = page.getByRole('dialog');
	await expect(fin).toBeVisible();
	await fin.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(fin).toBeHidden();

	await expect
		.poll(async () => {
			const v = await view(page, buildId);
			return plate.parts.map((s) => v.state[s].status);
		})
		.toEqual(plate.parts.map(() => 'Printed'));
	expect(
		(await view(page, buildId)).runs.filter((r) => r.plateNumber === plate.number)
	).toHaveLength(2);
});

test('Sequential with two parts left: the rest card lists exactly the rest', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pickseq2');
	const plate = splittable(await view(page, buildId));
	expect(plate.parts.length).toBeGreaterThanOrEqual(3);
	const h = await openPrint(page, buildId, plate.number);
	// Pick only the first part and log it; the others stay to print.
	const dlg = await openPicker(h);
	await dlg.getByTestId('part-pick-none').click();
	await dlg.getByTestId('part-pick-item').first().getByRole('checkbox').check();
	await dlg.getByTestId('part-pick-log').click();
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	const rest = plate.parts.slice(1);
	await expectStatuses(page, [plate.parts[0]], 'Printed');
	await expectStatuses(page, rest, 'To print');

	// Start what is left from the plate control: only the rest.
	await chooseStatus(h.getByTestId('plate-status'), 'Printing');
	await expectStatuses(page, rest, 'Printing');
	await expectStatuses(page, [plate.parts[0]], 'Printed');
	await page.getByRole('link', { name: 'Overview', exact: true }).click();
	const card = page.getByTestId('now-card');
	await expect(card.locator('.now-part')).toHaveCount(rest.length);
	await expect(card.getByTestId('now-subset')).toContainText(
		`${rest.length} of ${plate.parts.length} parts`
	);
	await chooseStatus(card.getByTestId('plate-status'), 'Printed');
	const fin = page.getByRole('dialog');
	await fin.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(fin).toBeHidden();
	await expect
		.poll(async () => {
			const v = await view(page, buildId);
			return plate.parts.map((s) => v.state[s].status);
		})
		.toEqual(plate.parts.map(() => 'Printed'));
});

test('The button is absent on a one-part-per-run plate, on a multi-run plate and for a viewer', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'pickabsent');
	const v = await view(page, buildId);
	const perPart = v.plates.find((p) => p.perPartRuns && p.parts.length >= 2);
	expect(perPart, 'the tuned layout has a one-part-per-run plate').toBeTruthy();
	const plate = splittable(v);

	await openPrint(page, buildId, plate.number);
	// The control shows on a normal plate (guards against a vacuous "absent" below).
	await expect
		.poll(() => offers(head(page, plate.number).getByTestId('plate-status'), 'plate-print-some'))
		.toBe(true);
	await expect(head(page, perPart!.number)).toBeVisible();
	await expect
		.poll(() => offers(head(page, perPart!.number).getByTestId('plate-status'), 'plate-print-some'))
		.toBe(false);

	// A plate that prints more than once (when the layout has one).
	const multi = v.plates.find((p) => !p.perPartRuns && p.runs > 1 && p.parts.length >= 2);
	if (multi) {
		await expect(head(page, multi.number)).toBeVisible();
		await expect
			.poll(() => offers(head(page, multi.number).getByTestId('plate-status'), 'plate-print-some'))
			.toBe(false);
	}

	// A viewer sees the plates but not the button.
	await page.goto(chapterUrl);
	const email = uniqueEmail('pickviewer');
	const link = await invite(page, email, 'viewer');
	const joiner = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		await joiner.page.goto(`/builds/${buildId}/print`);
		await joiner.page.waitForLoadState('networkidle');
		await groupByPlate(joiner.page);
		// A viewer's badge is a plain label: find the heading by its text.
		await expect(
			joiner.page.locator('.group-head').filter({ hasText: `Plate ${plate.number} ·` })
		).toBeVisible();
		await expect(
			joiner.page.locator('[data-testid="plate-status"][aria-haspopup="menu"]')
		).toHaveCount(0);
		expect(await joiner.page.getByTestId('status-menu').count()).toBe(0);
	} finally {
		await joiner.context.close();
	}
});

for (const width of [390, 360]) {
	test(`Phone ${width}px: the open picker does not overflow and Confirm is visible`, async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, `pickphone${width}`);
		const plate = splittable(await view(page, buildId));
		await page.setViewportSize({ width, height: 800 });
		const h = await openPrint(page, buildId, plate.number);
		const dlg = await openPicker(h);
		const confirm = dlg.getByTestId('part-pick-confirm');
		await expect(confirm).toBeVisible();
		await confirm.scrollIntoViewIfNeeded();
		const box = await confirm.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width);

		const overflow = await dlg.evaluate((el) => {
			const body = el.querySelector('.ds-modal__body') as HTMLElement;
			return {
				dlg: el.scrollWidth - el.clientWidth,
				body: body.scrollWidth - body.clientWidth,
				page: document.documentElement.scrollWidth - document.documentElement.clientWidth
			};
		});
		expect(overflow.dlg).toBeLessThanOrEqual(0);
		expect(overflow.body).toBeLessThanOrEqual(0);
		expect(overflow.page).toBeLessThanOrEqual(0);
	});
}
