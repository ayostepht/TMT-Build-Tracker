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
import type { Page } from '@playwright/test';

/**
 * "Not printing": a part or a whole plate is set aside from the Print tab's status menu, leaves the
 * progress, filament and time totals, and is listed in the folded "Not printing (N)" group until
 * "Bring back" (which restores its earlier status). Each test makes its own build.
 */

interface ViewJson {
	plates: { number: number; parts: string[]; perPartRuns: boolean; runs: number }[];
	parts: { slug: string; name: string }[];
	state: Record<string, { status: string }>;
	skipped: { slug: string; name: string; status: string }[];
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

const kpi = (page: Page, key: 'parts' | 'filament' | 'time') =>
	page.getByTestId(`header-kpi-${key}`);

/** "Parts printed: 3 of 33" -> 33. */
async function partsTotal(page: Page) {
	const label = (await kpi(page, 'parts').getAttribute('aria-label')) ?? '';
	return Number(/ of (\d+)/.exec(label)![1]);
}

async function openPrint(page: Page, buildId: string) {
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await expect(page.locator('.row').first()).toBeVisible();
}

test('Not printing a part: totals drop, the group lists it, Undo and Bring back restore it', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'skip');
	const v = await view(page, buildId);
	// A part on a multi-part whole plate, so the part's own menu is the one under test.
	const slug = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 3)!.parts[0];
	const name = v.parts.find((p) => p.slug === slug)!.name;

	await openPrint(page, buildId);
	await expect(page.getByTestId('not-printing')).toHaveCount(0);
	const total = await partsTotal(page);
	const filBefore = await kpi(page, 'filament').getAttribute('aria-label');

	await chooseExtra(row(page, slug).getByTestId('part-status'), 'part-skip');
	await expect(page.locator('.toasts')).toContainText(`${name} · not printing`);
	await expect(row(page, slug)).toHaveCount(0);
	const group = page.getByTestId('not-printing');
	await expect(group).toContainText('Not printing (1)');
	await expect.poll(() => partsTotal(page)).toBe(total - 1);
	await expect(kpi(page, 'filament')).not.toHaveAttribute('aria-label', filBefore!);

	// The group is folded; open it to see the part and its button.
	await group.locator('summary').click();
	await expect(group.getByTestId('not-printing-row')).toContainText(name);

	// Undo puts it back.
	await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
	await expect(row(page, slug)).toBeVisible();
	await expect(page.getByTestId('not-printing')).toHaveCount(0);
	await expect.poll(() => partsTotal(page)).toBe(total);
	await expect(kpi(page, 'filament')).toHaveAttribute('aria-label', filBefore!);

	// Skip again, then Bring back from the group.
	await chooseExtra(row(page, slug).getByTestId('part-status'), 'part-skip');
	await expect(row(page, slug)).toHaveCount(0);
	await page.getByTestId('not-printing').locator('summary').click();
	await page.getByRole('button', { name: `Bring back ${name}` }).click();
	await expect(row(page, slug)).toBeVisible();
	await expect(page.getByTestId('not-printing')).toHaveCount(0);
	await expect.poll(() => partsTotal(page)).toBe(total);

	// The Activity feed has both sentences.
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page.locator('.activity')).toContainText(`marked ${name} as not printing`);
	await expect(page.locator('.activity')).toContainText(`brought ${name} back into the build`);
});

test('Bring back restores the status the part had; Printing parts cannot be skipped', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'skip-status');
	const v = await view(page, buildId);
	const [printed, printing] = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 3)!.parts;
	await openPrint(page, buildId);

	await chooseStatus(row(page, printed).getByTestId('part-status'), 'Printed');
	await expect(row(page, printed)).toHaveAttribute('data-s', 'Printed');
	await chooseExtra(row(page, printed).getByTestId('part-status'), 'part-skip');
	await expect(row(page, printed)).toHaveCount(0);
	const group = page.getByTestId('not-printing');
	await group.locator('summary').click();
	await expect(group.getByTestId('not-printing-row')).toContainText('Printed');
	await group.getByTestId('bring-back').click();
	await expect(row(page, printed)).toHaveAttribute('data-s', 'Printed');
	expect((await view(page, buildId)).state[printed].status).toBe('Printed');

	// A part that is Printing has no "Not printing" item, and the API refuses it.
	await chooseStatus(row(page, printing).getByTestId('part-status'), 'Printing');
	await expect(row(page, printing)).toHaveAttribute('data-s', 'Printing');
	expect(await offers(row(page, printing).getByTestId('part-status'), 'part-skip')).toBe(false);
	const res = await page.request.post(`/api/builds/${buildId}/parts/skip`, {
		headers: { origin: new URL(page.url()).origin },
		data: { slugs: [printing], skip: true }
	});
	expect(res.status()).toBe(409);
});

test('Not printing a whole plate removes the plate; Bring back all returns it', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'skip-plate');
	const v = await view(page, buildId);
	const plate = v.plates
		.filter((p) => !p.perPartRuns && p.runs <= 1 && p.parts.length >= 2)
		.sort((a, b) => b.parts.length - a.parts.length)[0];
	await openPrint(page, buildId);
	const total = await partsTotal(page);
	const filBefore = await kpi(page, 'filament').getAttribute('aria-label');
	const timeBefore = await kpi(page, 'time').getAttribute('aria-label');
	await page.getByLabel('Group by').selectOption('plate');
	const head = page.locator('.group-head').filter({
		has: page.locator(`[data-testid="plate-status"][aria-label^="Plate ${plate.number} status"]`)
	});
	await expect(head).toBeVisible();

	await chooseExtra(head.getByTestId('plate-status'), 'plate-skip');
	await expect(head).toHaveCount(0);
	for (const s of plate.parts) await expect(row(page, s)).toHaveCount(0);
	const group = page.getByTestId('not-printing');
	await expect(group).toContainText(`Not printing (${plate.parts.length})`);
	await expect.poll(() => partsTotal(page)).toBe(total - plate.parts.length);
	// The whole plate is out of the time and filament totals too.
	await expect(kpi(page, 'filament')).not.toHaveAttribute('aria-label', filBefore!);
	await expect(kpi(page, 'time')).not.toHaveAttribute('aria-label', timeBefore!);

	await group.locator('summary').click();
	await group.getByTestId('bring-back-all').click();
	await expect(head).toBeVisible();
	for (const s of plate.parts) await expect(row(page, s)).toBeVisible();
	await expect(page.getByTestId('not-printing')).toHaveCount(0);
	await expect.poll(() => partsTotal(page)).toBe(total);

	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page.locator('.activity')).toContainText(
		`marked plate ${plate.number} as not printing`
	);
	await expect(page.locator('.activity')).toContainText(
		`brought plate ${plate.number} back into the build`
	);
});

test('A viewer sees the list but has no menu item and the API answers 403', async ({
	page,
	browser
}) => {
	const { buildId, chapterUrl } = await ownerWithBuild(page, 'skip-viewer');
	const v = await view(page, buildId);
	const [a, b] = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 3)!.parts;
	await openPrint(page, buildId);
	await chooseExtra(row(page, a).getByTestId('part-status'), 'part-skip');
	await expect(page.getByTestId('not-printing')).toBeVisible();

	await page.goto(chapterUrl);
	const email = uniqueEmail('viewer');
	const link = await invite(page, email, 'viewer');
	const joined = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		const vp = joined.page;
		await vp.goto(`/builds/${buildId}/print`);
		await vp.waitForLoadState('networkidle');
		await expect(row(vp, b)).toBeVisible();
		expect(await offers(row(vp, b).getByTestId('part-status'), 'part-skip')).toBe(false);
		const group = vp.getByTestId('not-printing');
		await group.locator('summary').click();
		await expect(group.getByTestId('not-printing-row')).toHaveCount(1);
		await expect(group.getByTestId('bring-back')).toHaveCount(0);

		const origin = { origin: new URL(vp.url()).origin };
		const skip = await vp.request.post(`/api/builds/${buildId}/parts/skip`, {
			headers: origin,
			data: { slugs: [b], skip: true }
		});
		expect(skip.status()).toBe(403);
		const back = await vp.request.post(`/api/builds/${buildId}/parts/skip`, {
			headers: origin,
			data: { slugs: [a], skip: false }
		});
		expect(back.status()).toBe(403);
		expect((await view(page, buildId)).skipped.map((s) => s.slug)).toEqual([a]);
	} finally {
		await joined.context.close();
	}
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('the Print tab with the Not printing group open stays inside the screen', async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, 'skip-phone');
		const v = await view(page, buildId);
		const slug = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 3)!.parts[0];
		await openPrint(page, buildId);
		await chooseExtra(row(page, slug).getByTestId('part-status'), 'part-skip');
		const group = page.getByTestId('not-printing');
		await group.locator('summary').click();
		await expect(group.getByTestId('bring-back')).toBeVisible();
		await group.scrollIntoViewIfNeeded();
		for (const width of [390, 360]) {
			await page.setViewportSize({ width, height: 844 });
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow, `no horizontal overflow at ${width} px`).toBeLessThanOrEqual(0);
		}
	});
});
