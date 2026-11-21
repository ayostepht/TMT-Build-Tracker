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
 * "Print some pieces…": the piece-level twin of "Print some parts…". Harness and Straps (slug
 * `harness`, 9 pieces) is alone on plate 18 of the tuned layout, so its action sits on the plate
 * heading; Connectors (5 pieces) shares plate 12 with other parts, so its action sits on the part row.
 * The team has no printer here, so Printing is a direct mark (the printer path is in
 * print-some-pieces-printer.spec.ts).
 */

const HARNESS = 'harness';
const N = 9;
const PLATE = 18;

interface ViewJson {
	plates: { number: number; parts: string[]; perPartRuns: boolean; runs: number }[];
	parts: { slug: string; name: string; components: { name: string }[] }[];
	runs: {
		id: string;
		plateNumber: number | null;
		partSlug: string | null;
		result: string;
		comps?: number[] | null;
	}[];
	state: Record<
		string,
		{ status: string; comps: Record<string, boolean>; printingComps?: number[] | null }
	>;
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

const ticks = (v: ViewJson, slug = HARNESS) =>
	Object.entries(v.state[slug].comps)
		.filter(([, on]) => on)
		.map(([i]) => Number(i))
		.sort((a, b) => a - b);

const names = (v: ViewJson, idx: number[]) =>
	idx.map((i) => v.parts.find((p) => p.slug === HARNESS)!.components[i].name);

const write = (page: Page, method: 'post' | 'patch', url: string, data: unknown) =>
	page.request[method](url, { data, headers: { origin: new URL(page.url()).origin } });

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
async function openPrint(page: Page, buildId: string, plate = PLATE) {
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await groupByPlate(page);
	const h = head(page, plate);
	await expect(h).toBeVisible();
	return h;
}

/** Harness build: a fresh owner with a build; the Print tab open on plate 18. */
async function start(page: Page, label: string) {
	const { buildId, chapterUrl } = await ownerWithBuild(page, label);
	const h = await openPrint(page, buildId);
	return { buildId, chapterUrl, h };
}

async function openPicker(h: Locator) {
	await chooseExtra(h.getByTestId('plate-status'), 'plate-print-some-pieces');
	const dlg = h.getByTestId('piece-pick');
	await expect(dlg).toBeVisible();
	return dlg;
}

/** Leaves only the first `keep` pieces ticked. */
async function keepFirst(dlg: Locator, keep: number) {
	const items = dlg.getByTestId('piece-pick-item');
	const total = await items.count();
	for (let i = keep; i < total; i++) await items.nth(i).getByRole('checkbox').uncheck();
}

/** The log sheet opened by "Log N pieces instead…": pick a result and save. */
async function saveLog(page: Page, result: 'Success' | 'Failed') {
	const sheet = page.getByRole('dialog', { name: /Log a print/ });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByTestId('log-pieces')).toBeVisible();
	// Only Success and Failed make sense for some pieces.
	await expect(sheet.getByRole('button', { name: 'Partial', exact: true })).toHaveCount(0);
	await sheet.getByRole('button', { name: result, exact: true }).click();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
}

/** Picks the first `k` pieces and logs them. */
async function logFirst(page: Page, h: Locator, k: number, result: 'Success' | 'Failed') {
	const dlg = await openPicker(h);
	await keepFirst(dlg, k);
	await dlg.getByTestId('piece-pick-log').click();
	await saveLog(page, result);
}

/** Picks the first `k` pieces (of what is left) and marks them printing. */
async function markFirst(page: Page, h: Locator, k: number) {
	const dlg = await openPicker(h);
	await keepFirst(dlg, k);
	await dlg.getByTestId('piece-pick-confirm').click();
	await expect(dlg).toBeHidden();
}

/** The part row's detail (pieces, run history) is collapsed until opened. */
async function openDetails(page: Page) {
	const btn = row(page, HARNESS).getByRole('button', { name: /^Details for / });
	if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
	await expect(btn).toHaveAttribute('aria-expanded', 'true');
}

/** Presses Undo on the toast whose text contains `text` (older toasts may still be showing). */
const undo = (page: Page, text: string) =>
	page
		.locator('.toast')
		.filter({ hasText: text })
		.getByRole('button', { name: 'Undo', exact: true })
		.click();

const tag = (page: Page) => row(page, HARNESS).getByTestId('part-pieces');

const grams = (t: string | null) =>
	Number(/(\d[\d,]*(?:\.\d+)?) g/.exec(t ?? '')?.[1]?.replace(',', ''));

test('Placement: one action, on the plate heading when the part is alone on its plate', async ({
	page
}) => {
	const { buildId, h } = await start(page, 'pcplace');
	const v = await view(page, buildId);
	expect(v.plates.find((p) => p.number === PLATE)?.parts).toEqual([HARNESS]);
	expect(v.parts.find((p) => p.slug === HARNESS)?.components).toHaveLength(N);

	await expect
		.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(true);
	await h.getByTestId('plate-status').click();
	const entry = h.getByTestId('plate-print-some-pieces');
	await expect(entry).toHaveText('Print some pieces…');
	await expect(entry).toHaveRole('menuitem');
	await page.keyboard.press('Escape');
	// Never both: the part row leaves its own button out.
	await expect(row(page, HARNESS)).toBeVisible();
	await expect
		.poll(() => offers(row(page, HARNESS).getByTestId('part-status'), 'part-print-some'))
		.toBe(false);
	// All ticked: the part is the plate's only startable part, so it is not a "parts" pick either.
	await expect.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some')).toBe(false);

	// Connectors (5 pieces) shares plate 12 with other parts: the button sits on its row, not the heading.
	const plate12 = v.plates.find((p) => p.parts.includes('connectors'))!;
	expect(plate12.parts.length).toBeGreaterThan(1);
	const h12 = head(page, plate12.number);
	await expect(h12).toBeVisible();
	await expect
		.poll(() => offers(h12.getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(false);
	await expect
		.poll(() => offers(row(page, 'connectors').getByTestId('part-status'), 'part-print-some'))
		.toBe(true);
	await row(page, 'connectors').getByTestId('part-status').click();
	await expect(row(page, 'connectors').getByTestId('part-print-some')).toHaveText(
		'Print some pieces…'
	);
	await page.keyboard.press('Escape');
	await expect(row(page, 'connectors').getByTestId('plate-print-some-pieces')).toHaveCount(0);
	// The plate's own "Print some parts…" is still there for the parts of plate 12.
	await expect.poll(() => offers(h12.getByTestId('plate-status'), 'plate-print-some')).toBe(true);
});

test('The picker: label, count, All and None follow the ticks', async ({ page }) => {
	const { buildId, h } = await start(page, 'pcui');
	const dlg = await openPicker(h);
	const v = await view(page, buildId);
	const items = dlg.getByTestId('piece-pick-item');
	await expect(items).toHaveCount(N);
	// The pieces are listed by name, in order.
	for (let i = 0; i < N; i++) {
		await expect(items.nth(i)).toContainText(names(v, [i])[0]);
		await expect(items.nth(i).getByRole('checkbox')).toBeChecked();
	}
	const confirm = dlg.getByTestId('piece-pick-confirm');
	const log = dlg.getByTestId('piece-pick-log');
	await expect(confirm).toHaveText(`Mark all ${N} pieces printing`);
	await expect(log).toHaveText(`Log ${N} pieces instead…`);
	await expect(dlg).toContainText(`${N} of ${N} ticked`);

	await items.first().getByRole('checkbox').uncheck();
	await expect(confirm).toHaveText(`Mark ${N - 1} of ${N} pieces printing`);
	await expect(log).toHaveText(`Log ${N - 1} pieces instead…`);

	await dlg.getByTestId('piece-pick-none').click();
	await expect(dlg).toContainText(`0 of ${N} ticked`);
	await expect(confirm).toBeDisabled();
	await expect(log).toBeDisabled();

	await items.nth(2).getByRole('checkbox').check();
	await expect(confirm).toHaveText(`Mark 1 of ${N} pieces printing`);
	await expect(log).toHaveText('Log 1 piece instead…');
	await expect(confirm).toBeEnabled();
	await items.nth(3).getByRole('checkbox').check();
	await items.nth(4).getByRole('checkbox').check();
	await expect(confirm).toHaveText(`Mark 3 of ${N} pieces printing`);
	await expect(log).toHaveText('Log 3 pieces instead…');

	await dlg.getByTestId('piece-pick-all').click();
	await expect(confirm).toHaveText(`Mark all ${N} pieces printing`);

	// Nothing was changed by looking.
	await dlg.getByRole('button', { name: 'Cancel', exact: true }).last().click();
	await expect(dlg).toBeHidden();
	const after = await view(page, buildId);
	expect(after.runs).toHaveLength(0);
	expect(after.state[HARNESS].status).toBe('To print');
});

test('Marking 3 of 9 pieces printing: row tag, Overview card, one activity row', async ({
	page
}) => {
	const { buildId, h } = await start(page, 'pcmark');
	// A slicer weight gives the plate a total to take the share of (3 of 9 pieces of 270 g = 90 g).
	const patched = await write(page, 'patch', `/api/builds/${buildId}/plates/${PLATE}`, {
		slicerGrams: 270
	});
	expect(patched.ok()).toBe(true);
	await page.reload();
	await page.waitForLoadState('networkidle');

	const dlg = await openPicker(h);
	await keepFirst(dlg, 3);
	await expect(dlg.getByTestId('piece-pick-confirm')).toHaveText(`Mark 3 of ${N} pieces printing`);
	await dlg.getByTestId('piece-pick-confirm').click();
	await expect(dlg).toBeHidden();
	await expect(page.locator('.toasts')).toContainText('Started');

	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	await expect(tag(page)).toHaveText(`0/${N} pieces · 3 printing`);
	const v = await view(page, buildId);
	expect(v.state[HARNESS].status).toBe('Printing');
	expect(v.state[HARNESS].printingComps).toEqual([0, 1, 2]);
	expect(ticks(v)).toEqual([]);
	// Printing: nothing more to pick, on the heading or the row.
	await expect
		.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(false);
	await expect
		.poll(() => offers(row(page, HARNESS).getByTestId('part-status'), 'part-print-some'))
		.toBe(false);

	// Overview: the card names the pieces and shows their share of the grams.
	await page.getByRole('link', { name: 'Overview', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
	const card = page.getByTestId('now-card');
	await expect(card).toHaveCount(1);
	const pieces = card.getByTestId('now-pieces');
	await expect(pieces).toContainText(`3 of ${N} pieces:`);
	for (const n of names(v, [0, 1, 2])) await expect(pieces).toContainText(n);
	const sub = card.getByTestId('now-subset');
	await expect(sub).toContainText(`3 of ${N} pieces`);
	expect(grams(await sub.textContent())).toBe(90);

	// One activity row for the start, naming the pieces.
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page).toHaveURL(/\/activity$/);
	const started = page.locator('.activity li').filter({ hasText: 'on the printer' });
	await expect(started).toHaveCount(1);
	await expect(started).toContainText(`3 pieces of Harness and Straps`);
});

test('Undo restores Printing with its piece list', async ({ page }) => {
	const { buildId, h } = await start(page, 'pcundo');
	await markFirst(page, h, 3);
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	// Undo of the start: back to To print, no list, all nine on offer again.
	await undo(page, 'Started');
	await expect(page.locator('.toasts')).toContainText('Undone');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'To print');
	await expect(tag(page)).toHaveText(`0/${N} pieces`);
	await expect
		.poll(async () => (await view(page, buildId)).state[HARNESS].printingComps ?? [])
		.toEqual([]);
	await expect
		.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(true);

	// Mark again, take it off the printer, then undo that: the list comes back.
	await markFirst(page, h, 3);
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	await chooseStatus(h.getByTestId('plate-status'), 'To print');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'To print');
	await expect(tag(page)).toHaveText(`0/${N} pieces`);
	await undo(page, 'off the printer');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	await expect(tag(page)).toHaveText(`0/${N} pieces · 3 printing`);
	await expect
		.poll(async () => (await view(page, buildId)).state[HARNESS].printingComps)
		.toEqual([0, 1, 2]);
});

test('Logging 3 pieces: the part goes to To print with 3 of 9 ticked; the rest finishes it', async ({
	page
}) => {
	const { buildId, h } = await start(page, 'pclog');
	await logFirst(page, h, 3, 'Success');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'To print');
	await expect(tag(page)).toHaveText(`3/${N} pieces`);
	let v = await view(page, buildId);
	expect(ticks(v)).toEqual([0, 1, 2]);
	expect(v.state[HARNESS].status).toBe('To print');
	expect(v.runs).toHaveLength(1);
	expect(v.runs[0]).toMatchObject({ result: 'Success', partSlug: HARNESS, comps: [0, 1, 2] });

	// The run is on the part's history with its scope.
	await openDetails(page);
	await expect(row(page, HARNESS).locator('tbody tr')).toHaveCount(1);
	await expect(row(page, HARNESS)).toContainText(`3 of ${N} pieces`);

	// A second pass: only the six unticked pieces are offered; logging them prints the part.
	const dlg = await openPicker(h);
	await expect(dlg.getByTestId('piece-pick-item')).toHaveCount(N - 3);
	for (const n of names(v, [0, 1, 2]))
		await expect(dlg.getByTestId('piece-pick-item').filter({ hasText: n })).toHaveCount(0);
	await expect(dlg.getByTestId('piece-pick-confirm')).toHaveText(
		`Mark all ${N - 3} pieces printing`
	);
	await dlg.getByTestId('piece-pick-log').click();
	await saveLog(page, 'Success');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printed');
	v = await view(page, buildId);
	expect(ticks(v)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	expect(v.state[HARNESS].status).toBe('Printed');
	expect(v.runs).toHaveLength(2);
	expect(v.runs.map((r) => r.comps)).toEqual(
		expect.arrayContaining([
			[0, 1, 2],
			[3, 4, 5, 6, 7, 8]
		])
	);
	// Printed: nothing left to pick, and the plate's badge is a plain label without a menu (so the
	// heading is found by its text; `h` matches the interactive badge only).
	const printed = page.locator('.group-head').filter({ hasText: `Plate ${PLATE} ·` });
	await expect(printed.getByTestId('plate-status')).toHaveText('Printed');
	await expect(printed.getByTestId('plate-status')).not.toHaveAttribute('aria-haspopup', 'menu');
	await expect(printed.getByTestId('plate-print-some-pieces')).toHaveCount(0);
});

test('Mark 3 pieces printing, then log them: Success ticks exactly those pieces', async ({
	page
}) => {
	const { buildId, h } = await start(page, 'pcmarklog');
	await markFirst(page, h, 3);
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	// Printed from the plate control: the log sheet opens for the printing pieces.
	await chooseStatus(h.getByTestId('plate-status'), 'Printed');
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByTestId('log-pieces')).toContainText(`3 of ${N} pieces`);
	await expect(sheet.getByRole('button', { name: 'Partial', exact: true })).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Success', exact: true }).click();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();

	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'To print');
	await expect(tag(page)).toHaveText(`3/${N} pieces`);
	const v = await view(page, buildId);
	expect(ticks(v)).toEqual([0, 1, 2]);
	expect(v.state[HARNESS].printingComps ?? []).toEqual([]);
	expect(v.runs.map((r) => r.comps)).toEqual([[0, 1, 2]]);
});

test('"Log N pieces instead…" with Failed: nothing is ticked and the part is Reprint', async ({
	page
}) => {
	const { buildId, h } = await start(page, 'pcfailed');
	await logFirst(page, h, 3, 'Failed');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Reprint');
	const v = await view(page, buildId);
	expect(ticks(v)).toEqual([]);
	expect(v.state[HARNESS].status).toBe('Reprint');
	expect(v.runs).toHaveLength(1);
	expect(v.runs[0]).toMatchObject({ result: 'Failed', comps: [0, 1, 2] });
	await expect(tag(page)).toHaveText(`0/${N} pieces`);
	// A Reprint part can be picked again, all nine pieces on offer.
	const dlg = await openPicker(h);
	await expect(dlg.getByTestId('piece-pick-item')).toHaveCount(N);
});

test('Deleting a piece run unticks its pieces', async ({ page }) => {
	const { buildId, h } = await start(page, 'pcdelete');
	await logFirst(page, h, 3, 'Success');
	await expect(tag(page)).toHaveText(`3/${N} pieces`);
	await logFirst(page, h, 2, 'Success');
	await expect(tag(page)).toHaveText(`5/${N} pieces`);
	expect(ticks(await view(page, buildId))).toEqual([0, 1, 2, 3, 4]);

	await openDetails(page);
	const editSheet = page.getByRole('dialog', { name: 'Edit print log' });
	// The runs list is oldest first or newest first: find the 3-piece run by its scope tag.
	const first = row(page, HARNESS)
		.locator('tbody tr')
		.filter({ hasText: `3 of ${N} pieces` });
	await expect(first).toHaveCount(1);
	await first.getByRole('button', { name: 'Edit entry' }).click();
	await expect(editSheet).toBeVisible();
	await editSheet.getByRole('button', { name: 'Delete', exact: true }).click();
	await editSheet.getByRole('button', { name: 'Delete log' }).click();
	await expect(editSheet).toBeHidden();

	await expect(tag(page)).toHaveText(`2/${N} pieces`);
	const v = await view(page, buildId);
	// Only the second run's pieces (indexes 3 and 4 of what was left) remain ticked.
	expect(ticks(v)).toHaveLength(2);
	expect(v.runs).toHaveLength(1);
	expect(v.state[HARNESS].status).toBe('To print');
});

test('Pieces covered by a Success log are ticked and locked until the log is deleted', async ({
	page
}) => {
	const { buildId, h } = await start(page, 'pclocked');
	await logFirst(page, h, 3, 'Success');
	await expect(tag(page)).toHaveText(`3/${N} pieces`);
	await openDetails(page);
	const boxes = row(page, HARNESS).locator('.comps input[type="checkbox"]');
	await expect(boxes).toHaveCount(N);
	const tags = row(page, HARNESS).getByTestId('piece-logged');
	await expect(tags).toHaveCount(3);
	for (let i = 0; i < 3; i++) {
		await expect(boxes.nth(i)).toBeChecked();
		await expect(boxes.nth(i)).toBeDisabled();
		await expect(boxes.nth(i)).toHaveAccessibleDescription('logged');
	}
	// The other pieces are still the maker's to tick, and counting them adds to the badge.
	for (let i = 3; i < N; i++) {
		await expect(boxes.nth(i)).toBeEnabled();
		await expect(boxes.nth(i)).not.toBeChecked();
	}
	await boxes.nth(3).check();
	await expect(tag(page)).toHaveText(`4/${N} pieces`);
	await boxes.nth(3).uncheck();
	await expect(tag(page)).toHaveText(`3/${N} pieces`);

	// The API refuses a hand untick of a logged piece and says what to do.
	const res = await write(page, 'patch', `/api/builds/${buildId}/parts/${HARNESS}`, {
		comps: { 0: false }
	});
	expect(res.status()).toBe(400);
	expect(await res.text()).toContain('print log');
	await expect(boxes.nth(0)).toBeChecked();

	// Deleting the log frees them.
	const editSheet = page.getByRole('dialog', { name: 'Edit print log' });
	await row(page, HARNESS).getByRole('button', { name: 'Edit entry' }).first().click();
	await expect(editSheet).toBeVisible();
	await editSheet.getByRole('button', { name: 'Delete', exact: true }).click();
	await editSheet.getByRole('button', { name: 'Delete log' }).click();
	await expect(editSheet).toBeHidden();
	await expect(tags).toHaveCount(0);
	for (let i = 0; i < N; i++) {
		await expect(boxes.nth(i)).toBeEnabled();
		await expect(boxes.nth(i)).not.toBeChecked();
	}
	await expect(tag(page)).toHaveText(`0/${N} pieces`);
});

test('The menu entry has no check mark and is reachable by keyboard', async ({ page }) => {
	const { h } = await start(page, 'pckeys');
	const badge = h.getByTestId('plate-status');
	await badge.click();
	const menu = page.getByTestId('status-menu');
	await expect(menu).toBeVisible();
	const entry = menu.getByTestId('plate-print-some-pieces');
	await expect(entry).toHaveRole('menuitem');
	await expect(entry).not.toHaveAttribute('aria-checked');
	await expect(entry).toHaveAccessibleName('Print some pieces of Harness and Straps');
	await expect(entry.locator('.sb-mark')).toHaveText('');
	await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();

	// Keyboard only: arrow down to the entry (it is the last item), Enter opens the pick sheet.
	await badge.focus();
	await page.keyboard.press('Enter');
	await expect(menu).toBeVisible();
	await page.keyboard.press('End');
	await expect(entry).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(menu).toBeHidden();
	await expect(h.getByTestId('piece-pick')).toBeVisible();
});

test('Take off printer clears the piece list', async ({ page }) => {
	const { buildId, h } = await start(page, 'pctakeoff');
	await markFirst(page, h, 3);
	await expect(tag(page)).toHaveText(`0/${N} pieces · 3 printing`);
	await chooseStatus(h.getByTestId('plate-status'), 'To print');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'To print');
	await expect(tag(page)).toHaveText(`0/${N} pieces`);
	const v = await view(page, buildId);
	expect(v.state[HARNESS].printingComps ?? []).toEqual([]);
	expect(ticks(v)).toEqual([]);
	expect(v.runs).toHaveLength(0);
	await expect
		.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(true);
});

test('Ticking an on-printer piece by hand takes it off the print', async ({ page }) => {
	const { buildId, h } = await start(page, 'pchand');
	await markFirst(page, h, 3);
	await expect(tag(page)).toHaveText(`0/${N} pieces · 3 printing`);
	const r = row(page, HARNESS);
	await r.getByRole('button', { name: /^Details for / }).click();
	const boxes = r.locator('.comps input[type="checkbox"]');
	await expect(boxes).toHaveCount(N);
	await expect(r.locator('.comps label').first()).toContainText('on the printer');

	await boxes.nth(0).check();
	await expect(tag(page)).toHaveText(`1/${N} pieces · 2 printing`);
	let v = await view(page, buildId);
	expect(v.state[HARNESS].printingComps).toEqual([1, 2]);
	expect(v.state[HARNESS].status).toBe('Printing');
	await expect(r.locator('.comps label').first()).not.toContainText('on the printer');

	// A piece that was never on the printer leaves the print alone.
	await boxes.nth(8).check();
	v = await view(page, buildId);
	expect(v.state[HARNESS].printingComps).toEqual([1, 2]);

	// The last on-printer pieces: the print is over and the part is back to To print.
	await boxes.nth(1).check();
	await boxes.nth(2).check();
	await expect(r).toHaveAttribute('data-s', 'To print');
	await expect(tag(page)).toHaveText(`4/${N} pieces`);
	v = await view(page, buildId);
	expect(v.state[HARNESS].printingComps ?? []).toEqual([]);
	expect(ticks(v)).toEqual([0, 1, 2, 8]);
	expect(v.state[HARNESS].status).toBe('To print');
});

test('Picking every piece still to print is the whole-part start', async ({ page }) => {
	const { buildId, h } = await start(page, 'pcwhole');
	await logFirst(page, h, 3, 'Success');
	await expect(tag(page)).toHaveText(`3/${N} pieces`);

	const dlg = await openPicker(h);
	await expect(dlg.getByTestId('piece-pick-confirm')).toHaveText(
		`Mark all ${N - 3} pieces printing`
	);
	await dlg.getByTestId('piece-pick-confirm').click();
	await expect(dlg).toBeHidden();
	await expect(page.locator('.toasts')).toContainText(`Started plate ${PLATE}`);
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	// A normal start: no piece list, so the tag shows no "printing" count and the card no pieces.
	await expect(tag(page)).toHaveText(`3/${N} pieces`);
	const v = await view(page, buildId);
	expect(v.state[HARNESS].status).toBe('Printing');
	expect(v.state[HARNESS].printingComps ?? []).toEqual([]);

	await page.getByRole('link', { name: 'Overview', exact: true }).click();
	await expect(page.getByTestId('now-card')).toHaveCount(1);
	await expect(page.getByTestId('now-pieces')).toHaveCount(0);
	await expect(page.getByTestId('now-subset')).toHaveCount(0);
});

test('Hidden for a viewer, and when fewer than two pieces are left', async ({ page, browser }) => {
	const { buildId, chapterUrl, h } = await start(page, 'pcabsent');
	// The control shows (guards against a vacuous "absent" below).
	await expect
		.poll(() => offers(h.getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(true);

	// One piece left: nothing to pick (a single piece is just the part).
	const ticked = Object.fromEntries(Array.from({ length: N - 1 }, (_, i) => [String(i), true]));
	const patched = await write(page, 'patch', `/api/builds/${buildId}/parts/${HARNESS}`, {
		comps: ticked
	});
	expect(patched.ok()).toBe(true);
	await page.reload();
	await page.waitForLoadState('networkidle');
	await groupByPlate(page);
	await expect(tag(page)).toHaveText(`${N - 1}/${N} pieces`);
	await expect
		.poll(() => offers(head(page, PLATE).getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(false);
	await expect
		.poll(() => offers(row(page, HARNESS).getByTestId('part-status'), 'part-print-some'))
		.toBe(false);
	// A ticked piece cannot start again.
	const refused = await write(page, 'post', `/api/builds/${buildId}/printing`, {
		action: 'start',
		slugs: [HARNESS],
		comps: [0]
	});
	expect(refused.status()).toBe(400);

	// Two left is enough again.
	const two = Object.fromEntries(Array.from({ length: N - 2 }, (_, i) => [String(i), true]));
	await write(page, 'patch', `/api/builds/${buildId}/parts/${HARNESS}`, {
		comps: { ...two, [String(N - 2)]: false, [String(N - 1)]: false }
	});
	await page.reload();
	await page.waitForLoadState('networkidle');
	await groupByPlate(page);
	await expect
		.poll(() => offers(head(page, PLATE).getByTestId('plate-status'), 'plate-print-some-pieces'))
		.toBe(true);

	// A viewer sees the plate and the part but not the action.
	await page.goto(chapterUrl);
	const email = uniqueEmail('pcviewer');
	const link = await invite(page, email, 'viewer');
	const joiner = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		await joiner.page.goto(`/builds/${buildId}/print`);
		await joiner.page.waitForLoadState('networkidle');
		await groupByPlate(joiner.page);
		await expect(
			joiner.page.locator('.group-head').filter({ hasText: `Plate ${PLATE} ·` })
		).toBeVisible();
		await expect(row(joiner.page, HARNESS)).toBeVisible();
		await expect(joiner.page.getByTestId('plate-print-some-pieces')).toHaveCount(0);
		await expect(joiner.page.getByTestId('part-print-some')).toHaveCount(0);
		// And the server says no as well.
		const res = await joiner.page.request.post(`/api/builds/${buildId}/printing`, {
			data: { action: 'start', slugs: [HARNESS], comps: [N - 2] },
			headers: { origin: new URL(joiner.page.url()).origin }
		});
		expect(res.status()).toBeGreaterThanOrEqual(400);
		expect((await view(joiner.page, buildId)).state[HARNESS].status).toBe('To print');
	} finally {
		await joiner.context.close();
	}
});

test('The API refuses bad piece lists and parts that cannot print pieces', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pcapi');
	const startBody = (slugs: string[], comps: unknown) =>
		write(page, 'post', `/api/builds/${buildId}/printing`, { action: 'start', slugs, comps });
	const status = async (body: ReturnType<typeof startBody>) => (await body).status();

	expect(await status(startBody([HARNESS], [N]))).toBe(400); // out of range
	expect(await status(startBody([HARNESS], [-1]))).toBe(400);
	expect(await status(startBody([HARNESS], [1.5]))).toBe(400); // not an integer
	expect(await status(startBody([HARNESS], [1, 1]))).toBe(400); // duplicate
	expect(await status(startBody([HARNESS], []))).toBe(400); // nothing picked
	expect(
		await status(
			startBody(
				[HARNESS],
				Array.from({ length: N }, (_, i) => i)
			)
		)
	).toBe(400); // all nine
	expect(await status(startBody([HARNESS, 'connectors'], [0]))).toBe(400); // two parts
	expect(await status(startBody(['tires'], [0]))).toBe(400); // a part without pieces
	expect((await view(page, buildId)).state[HARNESS].status).toBe('To print');

	// A piece that is already ticked cannot start again.
	expect(
		(
			await write(page, 'patch', `/api/builds/${buildId}/parts/${HARNESS}`, {
				comps: { '0': true }
			})
		).ok()
	).toBe(true);
	expect(await status(startBody([HARNESS], [0, 1]))).toBe(400);

	// Logging: Partial and per-part results do not apply to pieces.
	const run = (data: Record<string, unknown>) =>
		write(page, 'post', `/api/builds/${buildId}/runs`, {
			plateNumber: PLATE,
			partSlug: HARNESS,
			date: new Date().toISOString().slice(0, 10),
			...data
		});
	expect((await run({ result: 'Partial', comps: [1, 2] })).status()).toBe(400);
	expect((await run({ result: 'Success', comps: [1, 1] })).status()).toBe(400);
	expect((await run({ result: 'Success', comps: [99] })).status()).toBe(400);
	expect((await view(page, buildId)).runs).toHaveLength(0);

	// A valid piece start works, and a second one on the same (now Printing) part is refused.
	expect((await startBody([HARNESS], [1, 2])).status()).toBe(200);
	expect((await view(page, buildId)).state[HARNESS].printingComps).toEqual([1, 2]);
	expect(await status(startBody([HARNESS], [3, 4]))).toBe(400);
});

test('With one piece left, starting that piece is the whole-part start (no piece list)', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'pcone');
	const ticked = Object.fromEntries(Array.from({ length: N - 1 }, (_, i) => [String(i), true]));
	expect(
		(await write(page, 'patch', `/api/builds/${buildId}/parts/${HARNESS}`, { comps: ticked })).ok()
	).toBe(true);
	const res = await write(page, 'post', `/api/builds/${buildId}/printing`, {
		action: 'start',
		slugs: [HARNESS],
		comps: [N - 1]
	});
	expect(res.status()).toBe(200);
	const v = await view(page, buildId);
	expect(v.state[HARNESS].status).toBe('Printing');
	expect(v.state[HARNESS].printingComps ?? []).toEqual([]);
});

for (const width of [390, 360]) {
	test(`Phone ${width}px: the open picker with nine rows does not overflow and Confirm is reachable`, async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, `pcphone${width}`);
		await page.setViewportSize({ width, height: 800 });
		const h = await openPrint(page, buildId);
		// The plate heading with its status menu open does not overflow the phone.
		await h.getByTestId('plate-status').click();
		const menu = page.getByTestId('status-menu');
		await expect(menu.getByTestId('plate-print-some-pieces')).toBeVisible();
		const mb = await menu.boundingBox();
		expect(mb!.x).toBeGreaterThanOrEqual(0);
		expect(mb!.x + mb!.width).toBeLessThanOrEqual(width);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			)
		).toBeLessThanOrEqual(0);
		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		const dlg = await openPicker(h);
		await expect(dlg.getByTestId('piece-pick-item')).toHaveCount(N);
		const confirm = dlg.getByTestId('piece-pick-confirm');
		await expect(confirm).toBeVisible();
		await confirm.scrollIntoViewIfNeeded();
		const box = await confirm.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width);
		expect(box!.y + box!.height).toBeLessThanOrEqual(800);
		const log = dlg.getByTestId('piece-pick-log');
		const lbox = await log.boundingBox();
		expect(lbox!.x + lbox!.width).toBeLessThanOrEqual(width);

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

		// Confirm still works from the phone.
		await dlg.getByTestId('piece-pick-item').first().getByRole('checkbox').uncheck();
		await confirm.click();
		await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	});
}
