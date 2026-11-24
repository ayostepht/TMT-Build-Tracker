import { expect, test, newClientContext } from './fixtures';
import {
	createBuild,
	invite,
	joinViaInvite,
	keepPrintedVisible,
	ownerWithBuild,
	signUp,
	startBuild,
	toSetupStep,
	uniqueEmail
} from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * Saved custom parts (issue 113, part 2): a custom part is saved for the workspace, offered in other
 * builds, listed on the Saved parts page, and (when marked "Include in new builds") added to every new
 * build. Saved parts are workspace data: every test signs up its own owner and chapter, so nothing
 * here touches a shared workspace, and afterEach deletes what the test saved.
 */

interface ViewJson {
	build: { organizationId: string };
	plates: {
		number: number;
		name: string;
		source: string;
		parts: string[];
		estSeconds: number | null;
	}[];
	parts: { slug: string; name: string; custom?: boolean }[];
	skipped: { slug: string; name: string }[];
	customPieces: { id: string; name: string; libraryId?: string | null; plates: number[] }[];
}
interface LibJson {
	id: string;
	name: string;
	isDefault: boolean;
	totalSeconds: number | null;
	totalGrams: number | null;
	plates: unknown[];
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;
const originOf = (page: Page) => ({ origin: new URL(page.url()).origin });
const customPlates = (v: ViewJson) => v.plates.filter((p) => p.source.startsWith('custom:'));
const library = async (page: Page, org: string) =>
	(
		(await (await page.request.get(`/api/custom-library?organizationId=${org}`)).json()) as {
			pieces: LibJson[];
		}
	).pieces;
const teamPath = (chapterUrl: string) => new URL(chapterUrl).pathname;

/** The workspace the running test saved parts in, for the cleanup. */
let cleanupOrg: string | null = null;
test.afterEach(async ({ page }) => {
	const org = cleanupOrg;
	cleanupOrg = null;
	if (!org) return;
	try {
		for (const l of await library(page, org))
			await page.request.delete(`/api/custom-library/${l.id}?organizationId=${org}`, {
				headers: originOf(page)
			});
	} catch {
		/* the test's own chapter is throwaway; best effort */
	}
});
async function orgOf(page: Page, buildId: string) {
	cleanupOrg = (await view(page, buildId)).build.organizationId;
	return cleanupOrg;
}

const sliced = (a: string, b: string) =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PETG'],
		plates: [
			{
				name: a,
				prediction: 36000,
				weight: 200,
				filaments: { 1: 200 },
				objects: [{ name: a.toLowerCase() }]
			},
			{
				name: b,
				prediction: 18000,
				weight: 100,
				filaments: { 1: 100 },
				objects: [{ name: b.toLowerCase() }]
			}
		]
	});
const cupHolder = () => sliced('CUP HOLDER BASE', 'CUP HOLDER ARM');
const tray = () => sliced('TRAY BASE', 'TRAY LID');

async function openFiles(page: Page, buildId: string) {
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
}

async function openSheet(page: Page, file: Uint8Array, fileName: string) {
	await page.getByTestId('add-custom-part').click();
	const dlg = page.getByTestId('custom-dialog');
	await expect(dlg).toBeVisible();
	await dlg.getByTestId('custom-3mf-file').setInputFiles({
		name: fileName,
		mimeType: 'model/3mf',
		buffer: Buffer.from(file)
	});
	await expect(dlg.getByTestId('custom-name')).toBeVisible();
	return dlg;
}

async function fillColours(dlg: Locator) {
	const selects = dlg.locator(
		'select[aria-label^="Build color for"], select[aria-label="Color of the part"]'
	);
	for (let i = 0; i < (await selects.count()); i++)
		if (!(await selects.nth(i).inputValue())) await selects.nth(i).selectOption({ index: 1 });
}

/** Files tab: add a custom part from a file; `save` ticks "Save for new builds". */
async function addPiece(
	page: Page,
	o: { file: Uint8Array; name: string; save?: boolean; replaces?: string[] }
) {
	const dlg = await openSheet(page, o.file, `${o.name}.3mf`);
	await dlg.getByTestId('custom-name').fill(o.name);
	await fillColours(dlg);
	if (o.replaces?.length) {
		await dlg.getByTestId('custom-replaces').locator('summary').click();
		for (const n of o.replaces) await dlg.getByRole('checkbox', { name: n, exact: true }).check();
	}
	if (o.save) await dlg.getByTestId('custom-save-library').check();
	await dlg.getByTestId('custom-add').click();
	await expect(dlg).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: `Added "${o.name}"` })).toBeVisible();
}

function kitPartToReplace(v: ViewJson) {
	const slug = v.plates.find((p) => !p.source.startsWith('custom:') && p.parts.length >= 3)!
		.parts[0];
	return { slug, name: v.parts.find((p) => p.slug === slug)!.name };
}

/** Owner with a chapter and a first build that holds a saved cup holder (replacing one kit part). */
async function ownerWithSavedPart(page: Page, label: string, save = true) {
	const { chapterUrl, buildId } = await ownerWithBuild(page, label);
	const org = await orgOf(page, buildId);
	const kit = kitPartToReplace(await view(page, buildId));
	await openFiles(page, buildId);
	await addPiece(page, { file: cupHolder(), name: 'Cup holder', save, replaces: [kit.name] });
	return { chapterUrl, buildId, org, kit };
}

async function setDefault(page: Page, org: string, id: string, isDefault: boolean) {
	const res = await page.request.patch(`/api/custom-library/${id}`, {
		headers: originOf(page),
		data: { organizationId: org, isDefault }
	});
	expect(res.status()).toBe(200);
}

test('Saving on add shows a Saved tag; a part added without it can be saved afterwards', async ({
	page
}) => {
	const { buildId, org } = await ownerWithSavedPart(page, 'lib-save');
	const piece = page.getByTestId('custom-piece').filter({ hasText: 'Cup holder' });
	await expect(piece.getByTestId('custom-saved')).toHaveText('Saved');
	await expect(piece.getByTestId('custom-save')).toHaveCount(0);
	const saved = await library(page, org);
	expect(saved).toHaveLength(1);
	expect(saved[0]).toMatchObject({ name: 'Cup holder', isDefault: false });
	expect(saved[0].totalSeconds).toBe(54000);
	expect(saved[0].totalGrams).toBe(300);

	// Without the checkbox: no tag, a Save button, nothing in the library.
	await addPiece(page, { file: tray(), name: 'Tray' });
	const tr = page.getByTestId('custom-piece').filter({ hasText: 'Tray' });
	await expect(tr.getByTestId('custom-saved')).toHaveCount(0);
	expect(await library(page, org)).toHaveLength(1);
	await tr.getByTestId('custom-save').click();
	await expect(tr.getByTestId('custom-saved')).toBeVisible();
	await expect(tr.getByTestId('custom-save')).toHaveCount(0);
	expect((await library(page, org)).map((l) => l.name).sort()).toEqual(['Cup holder', 'Tray']);

	// The build that holds a saved part is not offered it again in its own sheet.
	await page.getByTestId('add-custom-part').click();
	await expect(page.getByTestId('custom-dialog')).toBeVisible();
	await expect(page.getByTestId('custom-saved-list')).toHaveCount(0);
	await page.getByTestId('custom-dialog').getByRole('button', { name: 'Cancel' }).first().click();
	expect((await view(page, buildId)).customPieces.every((c) => c.libraryId)).toBe(true);
});

test('Another build lists the saved part; Add applies its plates, time, grams and replaced parts', async ({
	page
}) => {
	const { chapterUrl, kit } = await ownerWithSavedPart(page, 'lib-apply');
	await page.goto(chapterUrl);
	const otherId = await createBuild(page, 'Second chair', null);
	const before = await view(page, otherId);
	expect(customPlates(before)).toHaveLength(0);

	await openFiles(page, otherId);
	await page.getByTestId('add-custom-part').click();
	const dlg = page.getByTestId('custom-dialog');
	const list = dlg.getByTestId('custom-saved-list');
	await expect(list).toContainText('Saved custom parts');
	await expect(list).toContainText('Cup holder');
	await expect(list).toContainText('2 plates');
	await expect(list).toContainText('replaces 1 kit part');
	await list.getByTestId('custom-saved-add').click();
	// A saved part that replaces kit parts asks first, with those parts pre-checked.
	await expect(dlg.getByTestId('custom-saved-confirm-step')).toBeVisible();
	await expect(
		dlg.getByTestId('custom-saved-replaces').locator(`[data-slug="${kit.slug}"]`)
	).toBeChecked();
	await dlg.getByTestId('custom-saved-confirm').click();
	await expect(dlg).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: 'Added "Cup holder"' })).toContainText(
		`replaced ${kit.name}`
	);

	const v = await view(page, otherId);
	expect(customPlates(v).map((p) => p.estSeconds)).toEqual([36000, 18000]);
	expect(v.skipped.map((s) => s.slug)).toEqual([kit.slug]);
	expect(v.customPieces).toHaveLength(1);
	await expect(page.getByTestId('custom-piece')).toContainText('Cup holder');
	await expect(page.getByTestId('custom-saved')).toBeVisible();

	await keepPrintedVisible(page, otherId);
	await page.goto(`/builds/${otherId}/print`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('not-printing')).toContainText('Not printing (1)');
	await page.getByTestId('not-printing').locator('summary').click();
	await expect(page.getByTestId('not-printing-row')).toContainText(kit.name);

	// Applying it again is a no-op (the API says it is already there).
	const again = await page.request.post(`/api/builds/${otherId}/custom-pieces`, {
		headers: originOf(page),
		data: { libraryId: (await library(page, v.build.organizationId))[0].id }
	});
	expect(await again.json()).toMatchObject({ already: true });
	expect((await view(page, otherId)).customPieces).toHaveLength(1);
});

test('The Saved parts page renames, toggles Include in new builds and deletes; builds keep the part', async ({
	page
}) => {
	const { chapterUrl, buildId, org } = await ownerWithSavedPart(page, 'lib-page');
	await page.goto(chapterUrl);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('saved-parts-link').click();
	await expect(page).toHaveURL(/\/pieces$/);
	await page.waitForLoadState('networkidle');
	const row = page.getByTestId('saved-part');
	await expect(row).toHaveCount(1);
	await expect(row).toContainText('Cup holder');
	await expect(row).toContainText('2 plates');
	await expect(row).toContainText('Replaces:');
	await expect(row.getByTestId('saved-part-default')).not.toBeChecked();

	// Rename.
	await row.getByTestId('saved-part-rename').click();
	await row.getByTestId('saved-part-name-input').fill('Drinks holder');
	await row.getByTestId('saved-part-name-save').click();
	await expect(page.getByTestId('saved-part')).toContainText('Drinks holder');
	await expect(page.getByTestId('saved-part-name-input')).toHaveCount(0);
	expect((await library(page, org))[0].name).toBe('Drinks holder');

	// Include in new builds on and off.
	await row.getByTestId('saved-part-default').check();
	await expect.poll(async () => (await library(page, org))[0].isDefault).toBe(true);
	await expect(row.getByTestId('saved-part-default')).toBeChecked();
	await row.getByTestId('saved-part-default').uncheck();
	await expect.poll(async () => (await library(page, org))[0].isDefault).toBe(false);

	// Delete asks first.
	await row.getByTestId('saved-part-delete').click();
	await expect(page.getByTestId('saved-part')).toHaveCount(1);
	await row.getByTestId('saved-part-delete-confirm').click();
	await expect(page.getByTestId('saved-parts-empty')).toBeVisible();
	await expect(page.getByTestId('saved-part')).toHaveCount(0);
	expect(await library(page, org)).toHaveLength(0);

	// The build that already used the part keeps it.
	const v = await view(page, buildId);
	expect(v.customPieces.map((c) => c.name)).toEqual(['Cup holder']);
	expect(customPlates(v)).toHaveLength(2);
	await openFiles(page, buildId);
	await expect(page.getByTestId('custom-piece')).toContainText('Cup holder');
});

test('A new build gets the default saved part (also with setup skipped); a non-default one is not added', async ({
	page
}) => {
	const { chapterUrl, buildId, org, kit } = await ownerWithSavedPart(page, 'lib-default');
	// A second saved part, not included by default.
	await addPiece(page, { file: tray(), name: 'Tray', save: true });
	const lib = await library(page, org);
	const cup = lib.find((l) => l.name === 'Cup holder')!;
	await setDefault(page, org, cup.id, true);
	expect(buildId).toBeTruthy();

	// Through the wizard.
	await page.goto(chapterUrl);
	const id = await startBuild(page, 'Defaulted chair');
	const v = await view(page, id);
	expect(v.customPieces.map((c) => c.name)).toEqual(['Cup holder']);
	expect(customPlates(v)).toHaveLength(2);
	expect(v.skipped.map((s) => s.slug)).toEqual([kit.slug]);

	// Options step: Remove takes the default part out and brings the replaced part back.
	await toSetupStep(page, 2);
	const saved = page.getByTestId('setup-saved-parts');
	await expect(saved).toContainText('Saved custom parts');
	const cupRow = saved.getByTestId('setup-saved-part').filter({ hasText: 'Cup holder' });
	const trayRow = saved.getByTestId('setup-saved-part').filter({ hasText: 'Tray' });
	await expect(cupRow.getByTestId('setup-saved-remove')).toBeVisible();
	await expect(trayRow.getByTestId('setup-saved-add')).toBeVisible();
	await cupRow.getByTestId('setup-saved-remove').click();
	await expect(cupRow.getByTestId('setup-saved-add')).toBeVisible();
	let w = await view(page, id);
	expect(w.customPieces).toHaveLength(0);
	expect(w.skipped).toHaveLength(0);
	expect(w.parts.some((p) => p.slug === kit.slug)).toBe(true);

	// Add puts a non-default one in.
	await trayRow.getByTestId('setup-saved-add').click();
	await expect(trayRow.getByTestId('setup-saved-remove')).toBeVisible();
	w = await view(page, id);
	expect(w.customPieces.map((c) => c.name)).toEqual(['Tray']);
	// And the default part back again, then finish setup.
	await cupRow.getByTestId('setup-saved-add').click();
	// It replaces a kit part, so the wizard asks first (the part is pre-checked).
	await expect(cupRow.getByTestId('setup-saved-confirm-step')).toBeVisible();
	await cupRow.getByTestId('setup-saved-confirm').click();
	await expect(cupRow.getByTestId('setup-saved-remove')).toBeVisible();
	await page.getByTestId('skip-setup').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
	expect((await view(page, id)).customPieces.map((c) => c.name).sort()).toEqual([
		'Cup holder',
		'Tray'
	]);

	// Print tab and Activity show it.
	await keepPrintedVisible(page, id);
	await page.goto(`/builds/${id}/print`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('not-printing')).toContainText('Not printing (1)');
	await page.getByTestId('not-printing').locator('summary').click();
	await expect(page.getByTestId('not-printing-row')).toContainText(kit.name);
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page.locator('.activity')).toContainText('added the custom piece "Cup holder"');

	// Setup skipped at once: the default part is there, the other is not.
	await page.goto(chapterUrl);
	const skippedId = await createBuild(page, 'Skipped chair', null);
	const s = await view(page, skippedId);
	expect(s.customPieces.map((c) => c.name)).toEqual(['Cup holder']);
	expect(customPlates(s)).toHaveLength(2);
	expect(s.skipped.map((x) => x.slug)).toEqual([kit.slug]);
});

test('A viewer sees the Saved parts page without controls and the API answers 403', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId, org } = await ownerWithSavedPart(page, 'lib-viewer');
	const lib = (await library(page, org))[0];
	await setDefault(page, org, lib.id, true);
	const pieceId = (await view(page, buildId)).customPieces[0].id;
	await page.goto(chapterUrl);
	const email = uniqueEmail('lib-viewer');
	const link = await invite(page, email, 'viewer');
	const joined = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		const vp = joined.page;
		await vp.goto(`${teamPath(chapterUrl)}/pieces`);
		await vp.waitForLoadState('networkidle');
		const row = vp.getByTestId('saved-part');
		await expect(row).toContainText('Cup holder');
		await expect(row).toContainText('Added to every new build automatically');
		for (const id of [
			'saved-part-default',
			'saved-part-rename',
			'saved-part-delete',
			'saved-part-delete-confirm'
		])
			await expect(vp.getByTestId(id)).toHaveCount(0);

		const h = originOf(vp);
		const patch = await vp.request.patch(`/api/custom-library/${lib.id}`, {
			headers: h,
			data: { organizationId: org, name: 'Hijacked' }
		});
		expect(patch.status()).toBe(403);
		const del = await vp.request.delete(`/api/custom-library/${lib.id}?organizationId=${org}`, {
			headers: h
		});
		expect(del.status()).toBe(403);
		const post = await vp.request.post('/api/custom-library', {
			headers: h,
			data: { buildId, pieceId }
		});
		expect(post.status()).toBe(403);
		// Members may read the list.
		expect((await library(vp, org)).map((l) => l.name)).toEqual(['Cup holder']);
	} finally {
		await joined.context.close();
	}
	expect((await library(page, org)).map((l) => l.name)).toEqual(['Cup holder']);
});

test('A user outside the workspace gets 404 for its saved parts and cannot apply them', async ({
	page,
	browser
}) => {
	const { org } = await ownerWithSavedPart(page, 'lib-outsider');
	const lib = (await library(page, org))[0];

	const context = await newClientContext(browser);
	const op = await context.newPage();
	try {
		await signUp(op, 'Otto Outsider', uniqueEmail('lib-outsider'));
		const ownBuild = await createBuild(op, 'Own chair', null);
		const h = originOf(op);
		const list = await op.request.get(`/api/custom-library?organizationId=${org}`);
		expect(list.status()).toBe(404);
		const apply = await op.request.post(`/api/builds/${ownBuild}/custom-pieces`, {
			headers: h,
			data: { libraryId: lib.id }
		});
		expect(apply.status()).toBe(404);
		expect((await view(op, ownBuild)).customPieces).toHaveLength(0);
		const patch = await op.request.patch(`/api/custom-library/${lib.id}`, {
			headers: h,
			data: { organizationId: org, name: 'Hijacked' }
		});
		expect([403, 404]).toContain(patch.status());
	} finally {
		await context.close();
	}
	expect((await library(page, org))[0].name).toBe('Cup holder');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	const noOverflow = async (page: Page, what: string) => {
		for (const width of [390, 360]) {
			await page.setViewportSize({ width, height: 844 });
			const o = await page.evaluate(() => {
				const dlg = document.querySelector('[data-testid="custom-dialog"]');
				return {
					page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
					dlg: dlg ? dlg.scrollWidth - dlg.clientWidth : 0
				};
			});
			expect(o.page, `${what}: page at ${width} px`).toBeLessThanOrEqual(0);
			expect(o.dlg, `${what}: sheet at ${width} px`).toBeLessThanOrEqual(0);
		}
	};

	test('the Saved parts page, the wizard step and the add sheet stay inside the screen', async ({
		page
	}) => {
		const { chapterUrl } = await ownerWithSavedPart(page, 'lib-phone');
		await page.goto(chapterUrl);
		// A long name makes the rows wrap.
		const org = cleanupOrg!;
		const lib = (await library(page, org))[0];
		const patched = await page.request.patch(`/api/custom-library/${lib.id}`, {
			headers: originOf(page),
			data: {
				organizationId: org,
				name: 'A saved custom part with quite a long name to wrap on a phone',
				isDefault: false
			}
		});
		expect(patched.status()).toBe(200);

		await page.goto(`${teamPath(chapterUrl)}/pieces`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('saved-part')).toBeVisible();
		await noOverflow(page, 'Saved parts page');
		await page.getByTestId('saved-part-rename').click();
		await noOverflow(page, 'Saved parts page (renaming)');

		await page.goto(chapterUrl);
		const id = await startBuild(page, 'Phone chair');
		await toSetupStep(page, 2);
		await expect(page.getByTestId('setup-saved-parts')).toBeVisible();
		await noOverflow(page, 'wizard Options step');
		await page.getByTestId('skip-setup').click();
		await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));

		// The sheet with the saved list, then the review step with the checkbox.
		await openFiles(page, id);
		await page.getByTestId('add-custom-part').click();
		const dlg = page.getByTestId('custom-dialog');
		await expect(dlg.getByTestId('custom-saved-list')).toBeVisible();
		await noOverflow(page, 'sheet with saved list');
		await dlg.getByTestId('custom-3mf-file').setInputFiles({
			name: 'a very long file name for the phone check.3mf',
			mimeType: 'model/3mf',
			buffer: Buffer.from(tray())
		});
		await expect(dlg.getByTestId('custom-name')).toBeVisible();
		await dlg.getByTestId('custom-name').fill('Phone tray with a long name to wrap');
		await fillColours(dlg);
		await noOverflow(page, 'sheet review step');

		// Scroll every scrollable ancestor of the checkbox to its end: the checkbox and its hint must
		// then sit fully above the sticky button bar.
		const box = dlg.locator('label.cpu-save');
		await box.scrollIntoViewIfNeeded();
		await box.evaluate((el) => {
			for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
				if (n.scrollHeight > n.clientHeight) n.scrollTop = n.scrollHeight;
			}
		});
		const [b, bar] = await Promise.all([
			box.boundingBox(),
			dlg.getByTestId('custom-add').boundingBox()
		]);
		expect(b && bar).toBeTruthy();
		expect(b!.y, 'checkbox starts on screen').toBeGreaterThanOrEqual(0);
		expect(b!.y + b!.height, 'checkbox and hint end above the button bar').toBeLessThanOrEqual(
			bar!.y + 1
		);
		await expect(dlg.getByTestId('custom-save-library')).toBeInViewport();
		await dlg.getByTestId('custom-save-library').check();
		await noOverflow(page, 'sheet with checkbox');
	});
});
