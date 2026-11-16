import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild, row } from './helpers';
import type { Page } from '@playwright/test';

/**
 * #46: a Partial print on the manual log sheet records which parts printed OK (a Success run) and
 * which did not (a Failed run), with the grams kept and lost, in one step and one undo.
 */

interface ViewJson {
	plates: { number: number; parts: string[]; perPartRuns: boolean; runs: number }[];
	runs: {
		id: string;
		plateNumber: number | null;
		result: string;
		grams: number | null;
		partSlugs?: string[] | null;
	}[];
	state: Record<string, { status: string }>;
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

/** A plate whose parts can be told apart: several parts, one run of the whole plate. */
function splittable(v: ViewJson) {
	const plate = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 2 && p.runs <= 1);
	expect(plate, 'the tuned layout has a multi-part plate').toBeTruthy();
	return plate!;
}

const origin = (page: Page) => ({ origin: new URL(page.url()).origin });

/** Print tab, grouped by plate, with the Log a print button of one plate clicked. */
async function openPlateSheet(page: Page, buildId: string, plateNumber: number) {
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
	const head = page
		.locator('.group-head')
		.getByRole('button', { name: `Log a print on plate ${plateNumber}`, exact: true });
	await expect(head).toBeVisible();
	await head.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	return sheet;
}

const num = async (loc: ReturnType<Page['getByTestId']>) => Number(await loc.inputValue());

test('Partial: tick the parts that printed OK, edit Kept and Lost, save; statuses, activity and Overview follow', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'partialsheet');
	const plate = splittable(await view(page, buildId));
	// A slicer weight makes Kept and Lost prefill (without any number they stay empty).
	const patched = await page.request.patch(`/api/builds/${buildId}/plates/${plate.number}`, {
		data: { slicerGrams: 100 },
		headers: origin(page)
	});
	expect(patched.ok()).toBe(true);
	const [okSlug, ...others] = plate.parts;

	const sheet = await openPlateSheet(page, buildId, plate.number);
	const save = sheet.getByRole('button', { name: 'Save', exact: true });
	await expect(sheet.getByTestId('partial-parts')).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Partial', exact: true }).click();
	await expect(sheet.getByTestId('partial-parts')).toBeVisible();

	// Nothing ticked: Save is off and the hint says why.
	const hint = sheet.getByTestId('partial-hint');
	await expect(save).toBeDisabled();
	await expect(hint).toContainText('Tick at least one part that printed OK');
	// All ticked is not a Partial either.
	for (const s of plate.parts) await sheet.getByTestId(`partial-part-${s}`).check();
	await expect(save).toBeDisabled();
	await expect(hint).toContainText('leave at least one unticked');
	for (const s of others) await sheet.getByTestId(`partial-part-${s}`).uncheck();
	await expect(save).toBeEnabled();
	await expect(hint).toContainText('Ticked parts count as printed');

	// Kept and Lost prefill from the slicer weight; "how far" starts at 100 and scales Lost.
	const kept = sheet.getByTestId('log-grams-kept');
	const lost = sheet.getByTestId('log-grams-lost');
	const progress = sheet.getByTestId('log-progress');
	await expect(progress).toHaveValue('100');
	await expect(kept).not.toHaveValue('');
	await expect(lost).not.toHaveValue('');
	const keptFull = await num(kept);
	const lostFull = await num(lost);
	expect(keptFull + lostFull).toBeGreaterThanOrEqual(99);
	expect(keptFull + lostFull).toBeLessThanOrEqual(101);
	await progress.fill('50');
	await expect.poll(() => num(lost)).toBeCloseTo(lostFull / 2, -0.3);
	expect(await num(kept)).toBe(keptFull);

	// Typed grams win over the prefill.
	await kept.fill('60');
	await lost.fill('25');
	await sheet.getByLabel('Total print time').fill('4h');
	await save.click();
	await expect(sheet).toBeHidden();
	await expect(page.locator('.toasts')).toContainText(`Logged plate ${plate.number} · Partial`);

	// Two runs, one per half; the ticked part is Printed, the others are flagged for reprint.
	await expect(row(page, okSlug)).toHaveAttribute('data-s', 'Printed');
	for (const s of others) await expect(row(page, s)).toHaveAttribute('data-s', 'Reprint');
	const v = await view(page, buildId);
	const mine = v.runs.filter((r) => r.plateNumber === plate.number);
	expect(mine.map((r) => r.result).sort()).toEqual(['Failed', 'Success']);
	expect(mine.find((r) => r.result === 'Success')).toMatchObject({
		grams: 60,
		partSlugs: [okSlug]
	});
	expect(mine.find((r) => r.result === 'Failed')).toMatchObject({ grams: 25, partSlugs: others });

	// Activity: one sentence for the pair, not one per run.
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page).toHaveURL(/\/activity$/);
	const sentence = page
		.locator('.activity li')
		.filter({ hasText: `logged a partial print of plate ${plate.number}` });
	await expect(sentence).toHaveCount(1);
	await expect(sentence).toContainText('printed (60 g)');
	await expect(sentence).toContainText('flagged for reprint (25 g lost)');

	// Overview: the lost grams show under Used, and the hours are split good / failed.
	await page.getByRole('link', { name: 'Overview', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
	const lostTags = page.getByTestId('filament-lost');
	await expect(lostTags.first()).toBeVisible();
	const sum = (await lostTags.allInnerTexts())
		.map((t) => Number(/([\d,]+(?:\.\d+)?) g lost/.exec(t)?.[1]?.replace(',', '')))
		.reduce((a, b) => a + b, 0);
	// Each color's share is rounded to whole grams.
	expect(Math.abs(sum - 25)).toBeLessThanOrEqual(plate.parts.length);
	await expect(page.getByTestId('time-logged')).toContainText('4 h logged');
	await expect(page.getByTestId('time-logged')).toContainText('failed');
	await expect(page.getByTestId('time-logged')).not.toContainText('0 failed');
});

test('Undo of a Partial removes both runs in one go and puts the parts back', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'partialundo');
	const plate = splittable(await view(page, buildId));
	const [okSlug, ...others] = plate.parts;

	const sheet = await openPlateSheet(page, buildId, plate.number);
	await sheet.getByRole('button', { name: 'Partial', exact: true }).click();
	await sheet.getByTestId(`partial-part-${okSlug}`).check();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(row(page, okSlug)).toHaveAttribute('data-s', 'Printed');
	expect(
		(await view(page, buildId)).runs.filter((r) => r.plateNumber === plate.number)
	).toHaveLength(2);

	await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
	await expect(page.locator('.toasts')).toContainText('Undone');
	await expect
		.poll(async () =>
			(await view(page, buildId)).runs.filter((r) => r.plateNumber === plate.number)
		)
		.toHaveLength(0);
	await expect(row(page, okSlug)).toHaveAttribute('data-s', 'To print');
	for (const s of others) await expect(row(page, s)).toHaveAttribute('data-s', 'To print');

	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(
		page
			.locator('.activity li')
			.filter({ hasText: `undid a partial print of plate ${plate.number} (both of its logs)` })
	).toHaveCount(1);
});

test('Partial is not offered on a single-part log or a one-part-per-run plate', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'partialnot');
	const v = await view(page, buildId);
	const perPart = v.plates.find((p) => p.perPartRuns && p.parts.length >= 2);
	expect(perPart, 'the tuned layout has a one-part-per-run plate').toBeTruthy();

	// The plate-level sheet of a one-part-per-run plate: Success, Failed and the rest, no Partial.
	const sheet = await openPlateSheet(page, buildId, perPart!.number);
	await expect(sheet.getByRole('button', { name: 'Success', exact: true })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Failed', exact: true })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Partial', exact: true })).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Cancel' }).first().click();
	await expect(sheet).toBeHidden();

	// A log on one part has a single target.
	const part = row(page, splittable(v).parts[0]);
	await part.getByRole('button', { name: /^Details for / }).click();
	await part.getByRole('button', { name: 'Log a print…' }).click();
	const one = page.getByRole('dialog');
	await expect(one.getByRole('button', { name: 'Success', exact: true })).toBeVisible();
	await expect(one.getByRole('button', { name: 'Partial', exact: true })).toHaveCount(0);
	await expect(one.getByTestId('partial-parts')).toHaveCount(0);
});

test('Failed % fills the grams from the slicer weight, and shows only with one', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'partialpct');
	const plate = splittable(await view(page, buildId));

	// Without a slicer weight there is nothing to scale, so no % field.
	let sheet = await openPlateSheet(page, buildId, plate.number);
	await sheet.getByRole('button', { name: 'Failed', exact: true }).click();
	await expect(sheet.getByTestId('log-progress')).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Cancel' }).first().click();
	await expect(sheet).toBeHidden();

	const patched = await page.request.patch(`/api/builds/${buildId}/plates/${plate.number}`, {
		data: { slicerGrams: 200 },
		headers: origin(page)
	});
	expect(patched.ok()).toBe(true);

	sheet = await openPlateSheet(page, buildId, plate.number);
	await sheet.getByRole('button', { name: 'Failed', exact: true }).click();
	const progress = sheet.getByTestId('log-progress');
	const grams = sheet.getByLabel('Filament used (g)');
	await expect(progress).toHaveValue('');
	await expect(grams).toHaveValue('');
	await progress.fill('40');
	await expect(grams).toHaveValue('80');
	await expect(sheet).toContainText('Estimated from 40% progress');
	await progress.fill('25');
	await expect(grams).toHaveValue('50');
	// Typing the grams stops the follow-along.
	await grams.fill('61');
	await progress.fill('90');
	await expect(grams).toHaveValue('61');
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	const v = await view(page, buildId);
	expect(v.runs.filter((r) => r.plateNumber === plate.number).map((r) => r.grams)).toEqual([61]);
});

test('API: a Partial split needs a strict subset; undo takes both run ids', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'partialapi');
	const plate = splittable(await view(page, buildId));
	const [okSlug] = plate.parts;
	const headers = origin(page);
	const post = (path: string, data: unknown) =>
		page.request.post(`/api/builds/${buildId}/${path}`, { data, headers });
	const run = (split: unknown) => ({
		plateNumber: plate.number,
		date: '2026-11-03',
		result: 'Partial',
		split
	});

	// Nothing ticked, or everything ticked, is not a Partial.
	expect((await post('runs', run({ keptSlugs: [], keptGrams: 1, lostGrams: 1 }))).status()).toBe(
		400
	);
	expect(
		(await post('runs', run({ keptSlugs: plate.parts, keptGrams: 1, lostGrams: 1 }))).status()
	).toBe(400);
	expect((await view(page, buildId)).runs).toHaveLength(0);

	const ok = await post('runs', run({ keptSlugs: [okSlug], keptGrams: 30, lostGrams: 12 }));
	expect(ok.ok()).toBe(true);
	const { id, ids } = (await ok.json()) as { id: string; ids: string[] };
	expect(ids).toHaveLength(2);
	expect(ids).toContain(id);
	const v = await view(page, buildId);
	expect(v.runs.map((r) => [r.result, r.grams]).sort()).toEqual([
		['Failed', 12],
		['Success', 30]
	]);
	expect(v.state[okSlug].status).toBe('Printed');

	// Undo with the run ids removes both; the parts go back to the snapshot.
	const parts = plate.parts.map((slug) => ({
		slug,
		status: 'To print',
		startedAt: null,
		printedOn: null,
		runEstSeconds: null,
		comps: {}
	}));
	const undo = await post(`runs/${id}/undo`, { parts, runIds: ids });
	expect(undo.ok()).toBe(true);
	const after = await view(page, buildId);
	expect(after.runs).toHaveLength(0);
	expect(after.state[okSlug].status).toBe('To print');
});
