import { expect, test, newClientContext } from './fixtures';
import {
	createBuild,
	createChapter,
	invite,
	joinViaInvite,
	keepPrintedVisible,
	ownerWithBuild,
	signUp,
	startBuild,
	toSetupStep,
	uniqueEmail,
	TUNED_LAYOUT
} from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * Custom parts, round 2: the setup wizard's Custom parts card and confirm step, "Not used in this build"
 * filaments, recoloring a custom part (Files and Design tabs), the saved part Edit form, the add sheet's
 * confirm step, custom parts and "Not printing" in a Studio draft, and the access rules of the new API
 * shapes. Saved parts are workspace data: every test makes its own owner and workspace and afterEach
 * deletes what it saved. The 3MFs are built in code (no MakeGood data).
 */

interface ViewPlate {
	number: number;
	name: string;
	source: string;
	parts: string[];
	estSeconds: number | null;
	runs: number;
	slicerGrams: number | null;
	filamentGrams: Record<string, number>;
}
interface ViewJson {
	build: { organizationId: string };
	plates: ViewPlate[];
	parts: { slug: string; name: string; custom?: boolean }[];
	filaments: { key: string; name: string }[];
	skipped: { slug: string; name: string }[];
	state: Record<string, { status: string }>;
	customPieces: {
		id: string;
		name: string;
		libraryId?: string | null;
		plates: number[];
		colors: { slug: string; roles: { role: string; grams: number | null }[] }[];
	}[];
}
interface LibJson {
	id: string;
	name: string;
	isDefault: boolean;
	totalGrams: number | null;
	totalSeconds: number | null;
	replaces: string[];
	plates: {
		name: string;
		estSeconds: number | null;
		grams: number | null;
		runs: number;
		role: string;
	}[];
}
interface Template {
	roles: { key: string; name: string }[];
	parts: { slug: string; name: string }[];
}

const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;
const originOf = (page: Page) => ({ origin: new URL(page.url()).origin });
const customPlates = (v: ViewJson) => v.plates.filter((p) => p.source.startsWith('custom:'));
const libraryAll = async (page: Page, org: string) =>
	(await (await page.request.get(`/api/custom-library?organizationId=${org}`)).json()) as {
		pieces: LibJson[];
		template: Template;
	};
const library = async (page: Page, org: string) => (await libraryAll(page, org)).pieces;
const teamPath = (chapterUrl: string) => new URL(chapterUrl).pathname;
const sum = (o: Record<string, number>) =>
	Math.round(Object.values(o).reduce((a, b) => a + b, 0) * 100) / 100;

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
		/* the test's own workspace is throwaway; best effort */
	}
});
async function orgOf(page: Page, buildId: string) {
	cleanupOrg = (await view(page, buildId)).build.organizationId;
	return cleanupOrg;
}

// ---- files built in code

const plateSpec = (name: string, seconds: number, grams: number) => ({
	name,
	prediction: seconds,
	weight: grams,
	filaments: { 1: grams },
	objects: [{ name: name.toLowerCase() }]
});
const cupHolder = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PETG'],
		plates: [plateSpec('CUP HOLDER BASE', 36000, 200), plateSpec('CUP HOLDER ARM', 18000, 100)]
	});
/** One sliced plate in two filaments: 60 g in #1, 40 g (supports, say) in #2; 2 h. */
const twoTone = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PLA', 'PLA'],
		plates: [
			{
				name: 'TWO TONE',
				prediction: 7200,
				weight: 100,
				filaments: { 1: 60, 2: 40 },
				objects: [{ name: 'two tone' }]
			}
		]
	});
const asFile = (buffer: Uint8Array, name: string) => ({
	name,
	mimeType: 'model/3mf',
	buffer: Buffer.from(buffer)
});

// ---- helpers

async function openFiles(page: Page, buildId: string) {
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
}

/** Open the add sheet (Files tab or the wizard's card) and choose the file; stops at the review step. */
async function openSheet(page: Page, opener: string, file: Uint8Array, fileName: string) {
	await page.getByTestId(opener).click();
	const dlg = page.getByTestId('custom-dialog');
	await expect(dlg).toBeVisible();
	await dlg.getByTestId('custom-3mf-file').setInputFiles(asFile(file, fileName));
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

async function finishAdd(page: Page, dlg: Locator, name: string) {
	await dlg.getByTestId('custom-add').click();
	await expect(dlg).toBeHidden();
	await expect(page.getByRole('status').filter({ hasText: `Added "${name}"` })).toBeVisible();
}

/** Files tab: add a custom part from the cup holder file. */
async function addCupHolder(page: Page, name = 'Cup holder') {
	const dlg = await openSheet(page, 'add-custom-part', cupHolder(), `${name}.3mf`);
	await dlg.getByTestId('custom-name').fill(name);
	await fillColours(dlg);
	await finishAdd(page, dlg, name);
}

/** A saved part made through the API; `replaces` are kit part slugs. */
async function seedSaved(
	page: Page,
	org: string,
	name: string,
	extra: { replaces?: string[]; isDefault?: boolean } = {}
) {
	const { template } = await libraryAll(page, org);
	const res = await page.request.post('/api/custom-library', {
		headers: originOf(page),
		data: {
			organizationId: org,
			name,
			plates: [
				{ name: 'Base', estSeconds: 5400, grams: 12.5, role: template.roles[0].key, runs: 1 },
				{ name: 'Arm', estSeconds: 1800, grams: 6, role: template.roles[0].key, runs: 1 }
			],
			...extra
		}
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { piece: LibJson }).piece;
}

/** Kit parts (slug and name) of a build's first plates that hold three or more parts, one per call index. */
function kitParts(v: ViewJson, n: number) {
	const slugs = v.plates
		.filter((p) => !p.source.startsWith('custom:') && p.parts.length >= 3)
		.flatMap((p) => p.parts)
		.slice(0, n);
	return slugs.map((slug) => ({ slug, name: v.parts.find((p) => p.slug === slug)!.name }));
}

/** Signs up and makes a workspace; no build yet. */
async function ownerOnChapter(page: Page, label: string) {
	await signUp(page, 'Olive Owner', uniqueEmail(label));
	await createChapter(page, `Chapter ${label} ${Date.now().toString(36)}`);
	return page.url();
}

async function noOverflow(page: Page, what: string) {
	for (const width of [390, 360]) {
		await page.setViewportSize({ width, height: 844 });
		const o = await page.evaluate(() => {
			const dlg = document.querySelector('[data-testid="custom-dialog"]');
			const vw = document.documentElement.clientWidth;
			// the first elements that stick out, to name the culprit when the page is too wide
			const wide = [...document.querySelectorAll('body *')]
				.filter((el) => el.getBoundingClientRect().right > vw + 0.5)
				.slice(0, 6)
				.map(
					(el) =>
						`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)}#${el.getAttribute('data-testid') ?? ''}@${Math.round(el.getBoundingClientRect().right)}`
				);
			return {
				page: document.documentElement.scrollWidth - vw,
				dlg: dlg ? dlg.scrollWidth - dlg.clientWidth : 0,
				wide
			};
		});
		expect
			.soft(o.page, `${what}: page at ${width} px (wide: ${o.wide.join(' | ')})`)
			.toBeLessThanOrEqual(0);
		expect.soft(o.dlg, `${what}: sheet at ${width} px`).toBeLessThanOrEqual(0);
	}
}

/** "PETG · 12 parts · 300 g" on a Design tab slot -> 300. */
async function slotGrams(page: Page, role: string) {
	const text =
		(await page.locator(`li.slot[data-role="${role}"] .pick .muted`).first().textContent()) ?? '';
	return Number(/([\d.,]+) g/.exec(text)![1].replace(',', ''));
}

// ---- tests

const head2 = (page: Page, n: number) =>
	page.locator('.group-head', { has: page.getByText(new RegExp(`^Plate ${n} ·`)) });

test('Wizard on a fresh workspace: add a custom part from a file, see its plate, remove it', async ({
	page
}) => {
	await ownerOnChapter(page, 'r2-wiz');
	const id = await startBuild(page, 'Wizard chair');
	cleanupOrg = (await view(page, id)).build.organizationId;
	await toSetupStep(page, 2);

	const card = page.getByTestId('setup-saved-parts');
	await expect(card).toContainText('Custom parts');
	await expect(card.getByTestId('setup-custom-piece')).toHaveCount(0);
	const dlg = await openSheet(page, 'setup-add-custom', cupHolder(), 'wizard cup.3mf');
	await dlg.getByTestId('custom-name').fill('Wizard cup');
	await fillColours(dlg);
	await finishAdd(page, dlg, 'Wizard cup');
	const piece = card.getByTestId('setup-custom-piece');
	await expect(piece).toHaveCount(1);
	await expect(piece).toContainText('Wizard cup');
	await expect(piece).toContainText('2 plates');
	const plates = customPlates(await view(page, id));
	expect(plates.map((p) => p.estSeconds)).toEqual([36000, 18000]);

	// The Files step lists its plate with the time and grams from the file.
	await page.getByTestId('wizard-next').click();
	await expect(page).toHaveURL(/step=3/);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('wizard-next').click();
	await expect(page).toHaveURL(/step=4/);
	const plate = page.getByRole('region', { name: `Plate ${plates[0].number}`, exact: true });
	await expect(plate).toContainText('CUP HOLDER BASE');
	await expect(plate.getByTestId('plate-grams')).toContainText('200 g');
	await expect(plate).toContainText(/10(\.0)? h/);

	// Back on Options, Remove takes the part out again.
	await page.goto(`/builds/${id}/setup?step=2`);
	await page.waitForLoadState('networkidle');
	await expect(card.getByTestId('setup-custom-piece')).toHaveCount(1);
	await card.getByTestId('setup-custom-remove').click();
	await expect(card.getByTestId('setup-custom-piece')).toHaveCount(0);
	expect((await view(page, id)).customPieces).toHaveLength(0);
});

test('Wizard confirm step: choose what a saved part replaces, then bring a replaced part back', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'r2-wizc');
	const org = await orgOf(page, buildId);
	const [k1, k2] = kitParts(await view(page, buildId), 2);
	await seedSaved(page, org, 'Alpha part', { replaces: [k1.slug] });
	await seedSaved(page, org, 'Beta part', { replaces: [k2.slug] });

	await page.goto(chapterUrl);
	const id = await startBuild(page, 'Confirm chair');
	await toSetupStep(page, 2);
	const alpha = page.getByTestId('setup-saved-part').filter({ hasText: 'Alpha part' });
	const beta = page.getByTestId('setup-saved-part').filter({ hasText: 'Beta part' });

	// Alpha: its kit part is pre-checked; unchecked, the part is added and nothing is "Not printing".
	await alpha.getByTestId('setup-saved-add').click();
	await expect(alpha.getByTestId('setup-saved-confirm-step')).toBeVisible();
	const pick = alpha.getByTestId('setup-saved-replaces').locator(`input[data-slug="${k1.slug}"]`);
	await expect(pick).toBeChecked();
	await pick.uncheck();
	await alpha.getByTestId('setup-saved-confirm').click();
	await expect(alpha.getByTestId('setup-saved-remove')).toBeVisible();
	await expect(alpha.getByTestId('setup-saved-confirm-step')).toHaveCount(0);
	let v = await view(page, id);
	expect(v.customPieces.map((c) => c.name)).toEqual(['Alpha part']);
	expect(v.skipped).toHaveLength(0);
	await expect(alpha.getByTestId('setup-replaced')).toHaveCount(0);

	// Beta confirmed as is: its kit part is "Not printing"; the row says so and Bring back restores it.
	await beta.getByTestId('setup-saved-add').click();
	await expect(
		beta.getByTestId('setup-saved-replaces').locator(`input[data-slug="${k2.slug}"]`)
	).toBeChecked();
	await beta.getByTestId('setup-saved-confirm').click();
	await expect(beta.getByTestId('setup-saved-remove')).toBeVisible();
	v = await view(page, id);
	expect(v.skipped.map((p) => p.slug)).toEqual([k2.slug]);
	await expect(beta.getByTestId('setup-replaced')).toContainText(k2.name);
	await beta.getByTestId('setup-bring-back').click();
	await expect.poll(async () => (await view(page, id)).skipped).toHaveLength(0);
	await expect(beta.getByTestId('setup-bring-back')).toHaveCount(0);
	expect((await view(page, id)).parts.some((p) => p.slug === k2.slug)).toBe(true);
});

test('Not used filament: the add sheet and the Custom parts page leave its grams out', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'r2-ignore');
	const org = await orgOf(page, buildId);
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	const accent0 = await slotGrams(page, 'accent');
	await openFiles(page, buildId);

	const dlg = await openSheet(page, 'add-custom-part', twoTone(), 'two tone.3mf');
	await dlg.getByTestId('custom-name').fill('Two tone');
	const colors = dlg.getByTestId('custom-slot-color');
	await expect(colors).toHaveCount(2);
	await colors.nth(0).selectOption({ index: 1 });
	await colors.nth(1).selectOption({ index: 1 });
	const grams = dlg.getByTestId('custom-plate-grams');
	await expect(grams).toHaveValue('100');

	// Every filament left out: the sheet says why it cannot be added.
	await colors.nth(0).selectOption({ label: 'Not used in this build' });
	await colors.nth(1).selectOption({ label: 'Not used in this build' });
	await expect(dlg).toContainText('keeps no filament');
	await expect(dlg.getByTestId('custom-add')).toBeDisabled();

	// One filament back in: the grams box follows the kept filament(s).
	await colors.nth(1).selectOption({ index: 1 });
	await expect(grams).toHaveValue('40');
	await colors.nth(0).selectOption({ index: 1 });
	await expect(grams).toHaveValue('100');
	await colors.nth(1).selectOption({ label: 'Not used in this build' });
	await expect(grams).toHaveValue('60');
	await expect(dlg.getByTestId('custom-add')).toBeEnabled();
	await finishAdd(page, dlg, 'Two tone');

	const plate = customPlates(await view(page, buildId))[0];
	expect(plate.estSeconds).toBe(7200);
	expect(plate.slicerGrams).toBe(60);
	expect(sum(plate.filamentGrams)).toBe(60);
	expect(Object.keys(plate.filamentGrams)).toHaveLength(1);
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await expect.poll(() => slotGrams(page, 'accent')).toBe(accent0 + 60);

	// The Custom parts page: same choice on its add form; the saved part keeps the kept grams only.
	await page.goto(`${teamPath(chapterUrl)}/pieces`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('saved-part-add')).toBeEnabled();
	await page.getByTestId('saved-part-add').click();
	const form = page.getByTestId('library-add-form');
	await form.getByTestId('library-3mf-file').setInputFiles(asFile(twoTone(), 'two tone.3mf'));
	const slots = form.getByTestId('library-slots').locator('select');
	await expect(slots).toHaveCount(2);
	await expect(form.getByTestId('library-plate-grams')).toHaveValue('100');
	await slots.nth(0).selectOption({ index: 0 });
	await slots.nth(1).selectOption({ label: 'Not used (leave out its grams)' });
	await expect(form.getByTestId('library-plate-grams')).toHaveValue('60');
	await form.getByTestId('library-name').fill('Saved two tone');
	await form.getByTestId('library-create').click();
	await expect(page.getByTestId('saved-part-notice')).toContainText('Added "Saved two tone"');
	const saved = (await library(page, org)).find((l) => l.name === 'Saved two tone')!;
	expect(saved.totalGrams).toBe(60);
	expect(saved.totalSeconds).toBe(7200);
});

test('Recolor a custom part from the Files tab and the Design tab; a viewer cannot', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'r2-recolor');
	await orgOf(page, buildId);
	await openFiles(page, buildId);
	await addCupHolder(page);
	const [base, arm] = customPlates(await view(page, buildId));
	expect(base.filamentGrams).toEqual({ accent: 200 });
	expect(arm.filamentGrams).toEqual({ accent: 100 });
	const designGrams = async (role: string) => {
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		return slotGrams(page, role);
	};
	const accent0 = await designGrams('accent');
	await page.goto(`/builds/${buildId}/design`);
	const primary0 = await slotGrams(page, 'primary');
	const soft0 = await slotGrams(page, 'soft');

	// Files tab: the first part (200 g) moves from Accent to Primary.
	await openFiles(page, buildId);
	const selects = page.getByTestId('custom-piece').getByTestId('custom-color');
	await expect(selects).toHaveCount(2);
	await expect(selects.nth(0)).toHaveValue('accent');
	await selects.nth(0).selectOption('primary');
	await expect
		.poll(async () => customPlates(await view(page, buildId))[0].filamentGrams)
		.toEqual({ primary: 200 });
	expect(customPlates(await view(page, buildId))[1].filamentGrams).toEqual({ accent: 100 });
	await expect(selects.nth(0)).toHaveValue('primary');
	expect(await designGrams('accent')).toBe(accent0 - 200);
	expect(await slotGrams(page, 'primary')).toBe(primary0 + 200);

	// Design tab: the second part (100 g) moves from Accent to Soft; it is a group of its own.
	await page.getByRole('tab', { name: 'Parts' }).click();
	const group = page.getByTestId('design-custom-parts');
	await expect(group.getByTestId('design-custom-part')).toHaveCount(1);
	const dsel = group.getByTestId('design-custom-color');
	await expect(dsel).toHaveCount(2);
	await dsel.nth(1).selectOption('soft');
	await expect
		.poll(async () => customPlates(await view(page, buildId))[1].filamentGrams)
		.toEqual({ soft: 100 });
	await expect.poll(() => slotGrams(page, 'soft')).toBe(soft0 + 100);
	await expect.poll(() => slotGrams(page, 'accent')).toBe(accent0 - 300);

	// Activity has the sentence.
	await page.getByRole('link', { name: 'Activity', exact: true }).click();
	await expect(page.locator('.activity')).toContainText('changed the color of');

	// A viewer sees the colors but cannot change them.
	await page.goto(chapterUrl);
	const email = uniqueEmail('r2-viewer');
	const link = await invite(page, email, 'viewer');
	const joined = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		const vp = joined.page;
		await vp.goto(`/builds/${buildId}/design`);
		await vp.waitForLoadState('networkidle');
		await vp.getByRole('tab', { name: 'Parts' }).click();
		const vg = vp.getByTestId('design-custom-parts');
		await expect(vg.getByTestId('design-custom-part')).toHaveCount(1);
		await expect(vg.locator('select')).toHaveCount(0);
		await expect(vg.getByTestId('design-custom-color').first()).toContainText('Primary');
		await openFiles(vp, buildId);
		const vsel = vp.getByTestId('custom-color');
		await expect(vsel).toHaveCount(2);
		await expect(vsel.nth(0)).toBeDisabled();
		await expect(vsel.nth(1)).toBeDisabled();
	} finally {
		await joined.context.close();
	}
});

test('Saved part Edit form: plates, replaced parts and the automatic switch persist and reach new builds', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'r2-edit');
	const org = await orgOf(page, buildId);
	const [kit] = kitParts(await view(page, buildId), 1);
	const { template } = await libraryAll(page, org);
	await seedSaved(page, org, 'Edit part');
	const newRole = template.roles[1];

	await page.goto(`${teamPath(chapterUrl)}/pieces`);
	await page.waitForLoadState('networkidle');
	const row = page.getByTestId('saved-part').filter({ hasText: 'Edit part' });
	// The row's switch reads as the setting it is, with its hint.
	await expect(row).toContainText('Add to every new build automatically');
	await expect(row).toContainText('Off: it is still offered when you set up a build.');
	await row.getByTestId('saved-part-edit').click();
	const edit = row.getByTestId('saved-part-edit-form');
	await expect(edit).toBeVisible();
	await edit.getByTestId('saved-part-edit-plate-name').nth(0).fill('Base plate');
	await edit.getByTestId('saved-part-edit-runs').nth(0).fill('3');
	await edit.getByTestId('saved-part-edit-role').nth(0).selectOption(newRole.key);
	const replaces = edit.getByTestId('saved-part-edit-replaces');
	if (!(await replaces.evaluate((el) => (el as HTMLDetailsElement).open)))
		await replaces.locator('summary').click();
	await replaces.getByRole('checkbox', { name: kit.name, exact: true }).check();
	await edit.getByTestId('saved-part-default').check();
	await edit.getByTestId('saved-part-edit-save').click();
	await expect(edit).toHaveCount(0);
	await expect(row.getByTestId('saved-part-plates')).toContainText('Base plate');
	await expect(row.getByTestId('saved-part-plates')).toContainText('× 3');

	await page.reload();
	await page.waitForLoadState('networkidle');
	const again = page.getByTestId('saved-part').filter({ hasText: 'Edit part' });
	await expect(again.getByTestId('saved-part-plates')).toContainText('Base plate');
	await expect(again).toContainText(`Replaces: ${kit.name}`);
	await expect(again.getByTestId('saved-part-default')).toBeChecked();
	const saved = (await library(page, org)).find((l) => l.name === 'Edit part')!;
	expect(saved.isDefault).toBe(true);
	expect(saved.replaces).toEqual([kit.slug]);
	expect(saved.plates[0]).toMatchObject({ name: 'Base plate', runs: 3, role: newRole.key });
	expect(saved.plates[1]).toMatchObject({ name: 'Arm', runs: 1, role: template.roles[0].key });

	// A build made afterwards gets all of it.
	await page.goto(chapterUrl);
	const laterId = await createBuild(page, 'Later chair', null);
	const v = await view(page, laterId);
	const [first] = customPlates(v);
	expect(first.name).toBe('Edit part - Base plate');
	expect(first.runs).toBe(3);
	expect(v.customPieces[0].colors[0].roles[0].role).toBe(newRole.key);
	expect(v.skipped.map((p) => p.slug)).toEqual([kit.slug]);
});

test('Add sheet confirm step: pre-checked replaced part, other parts behind a disclosure', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'r2-sheetc');
	const org = await orgOf(page, buildId);
	const [k1, k2] = kitParts(await view(page, buildId), 2);
	await seedSaved(page, org, 'Sheet part', { replaces: [k1.slug] });

	await openFiles(page, buildId);
	await page.getByTestId('add-custom-part').click();
	const dlg = page.getByTestId('custom-dialog');
	await dlg.getByTestId('custom-saved-add').click();
	const step = dlg.getByTestId('custom-saved-confirm-step');
	await expect(step).toBeVisible();
	const picker = step.getByTestId('custom-saved-replaces');
	await expect(picker.locator(`input[data-slug="${k1.slug}"]`)).toBeChecked();
	const more = picker.locator('details.crp-more');
	await expect(more).not.toHaveAttribute('open', '');
	await expect(picker.locator(`input[data-slug="${k2.slug}"]`)).toBeHidden();
	await more.locator('summary').click();
	await picker.locator(`input[data-slug="${k2.slug}"]`).check();
	await expect(step).toContainText(`Marked Not printing: ${k1.name}, ${k2.name}`);
	await dlg.getByTestId('custom-saved-confirm').click();
	await expect(dlg).toBeHidden();

	expect((await view(page, buildId)).skipped.map((p) => p.slug).sort()).toEqual(
		[k1.slug, k2.slug].sort()
	);
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('not-printing')).toContainText('Not printing (2)');
});

test('Studio draft: a custom part and Not printing parts survive making it a build', async ({
	page
}) => {
	await signUp(page, 'Dana Draft', uniqueEmail('r2-draft'));
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
	const id = new URL(page.url()).pathname.split('/')[2];
	cleanupOrg = (await view(page, id)).build.organizationId;

	await openFiles(page, id);
	await page.getByTestId('plate-layout').selectOption({ label: TUNED_LAYOUT });
	await expect(page.getByTestId('layout-name')).toContainText("MakeGood's");
	await expect(page.getByTestId('custom-card')).toBeVisible();
	await addCupHolder(page);
	await expect(page.getByTestId('custom-piece')).toContainText('Cup holder');

	// Design tab: the custom part has its group; a kit part is set aside from the part sheet.
	const [kit] = kitParts(await view(page, id), 1);
	await page.goto(`/builds/${id}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Parts' }).click();
	await expect(page.getByTestId('design-custom-parts')).toContainText('Cup holder');
	const needs = () => page.locator('li.slot').allTextContents();
	const needsBefore = (await needs()).join('|');
	await expect(page.getByTestId('not-printing')).toHaveCount(0);
	await page.locator(`[data-testid="part-row"][data-slug="${kit.slug}"]`).click();
	await page.getByTestId('part-sheet').getByTestId('part-not-printing').click();
	await expect(
		page
			.locator(`[data-testid="part-row"][data-slug="${kit.slug}"]`)
			.getByTestId('part-row-skipped')
	).toBeVisible();
	const group = page.getByTestId('not-printing');
	await expect(group).toContainText('Not printing (1)');
	await group.locator('summary').click();
	await expect(group.getByTestId('not-printing-row')).toContainText(kit.name);
	await expect(group.getByTestId('bring-back')).toBeVisible();
	await expect.poll(async () => (await needs()).join('|')).not.toBe(needsBefore);
	expect((await view(page, id)).skipped.map((p) => p.slug)).toEqual([kit.slug]);

	// Make it a build: the custom part, its plates and the skipped part all come along.
	await page.getByTestId('make-build').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${id}/setup\\?step=5`));
	const v = await view(page, id);
	expect(v.customPieces.map((c) => c.name)).toEqual(['Cup holder']);
	expect(customPlates(v)).toHaveLength(2);
	expect(v.skipped.map((p) => p.slug)).toEqual([kit.slug]);

	// The custom plate can be logged as printed.
	const plate = customPlates(v)[0];
	await keepPrintedVisible(page, id);
	await page.goto(`/builds/${id}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
	await head2(page, plate.number)
		.getByRole('button', { name: `Log a print on plate ${plate.number}`, exact: true })
		.click();
	const sheet = page.getByRole('dialog');
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect
		.poll(async () => (await view(page, id)).state[plate.parts[0]].status)
		.toBe('Printed');
	await expect(page.getByTestId('not-printing')).toContainText('Not printing (1)');
});

test('A slot left on "Not tracked" in a regular sliced upload does not count in the plate grams', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'r2-untracked');
	await openFiles(page, buildId);
	await page.getByTestId('plate-layout').selectOption({ label: 'Use my own sliced file…' });
	const panel = page.getByRole('region', { name: 'Upload a 3MF' });
	const file = makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		filamentTypes: ['PETG', 'PLA'],
		plates: [
			{
				name: 'HANDLES (PRINT X2)',
				prediction: 7200,
				weight: 150,
				filaments: { 1: 120, 2: 30 },
				objects: [{ name: '3DTMT A1 HANDLE LEFT REV A.STEP' }]
			}
		]
	});
	await panel.getByTestId('3mf-file').setInputFiles(asFile(file, 'untracked.3mf'));
	await panel.getByLabel('Build filament for #2').selectOption({ label: 'Not tracked' });
	await panel.getByTestId('apply-upload').click();
	const plate = page.getByRole('region', { name: 'Plate 1', exact: true });
	await expect(plate.getByTestId('plate-grams')).toContainText('120 g per run');
	await expect(plate.getByTestId('plate-grams')).not.toContainText('150');
	const p = (await view(page, buildId)).plates[0];
	expect(p.slicerGrams).toBe(120);
	expect(sum(p.filamentGrams)).toBe(120);
});

test('Access: recoloring needs edit rights, and replaces must name kit parts of the build', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'r2-access');
	const org = await orgOf(page, buildId);
	const lib = await seedSaved(page, org, 'Access part');
	const other = await seedSaved(page, org, 'Other part');
	const h = originOf(page);
	const add = await page.request.post(`/api/builds/${buildId}/custom-pieces`, {
		headers: h,
		data: { libraryId: lib.id }
	});
	expect(add.status()).toBe(200);
	const pieceId = ((await add.json()) as { pieceId: string }).pieceId;
	const plate = customPlates(await view(page, buildId))[0];
	const slug = plate.parts[0];
	const from = (await view(page, buildId)).customPieces[0].colors[0].roles[0].role;
	const body = { roles: { [slug]: { [from]: from === 'soft' ? 'tire' : 'soft' } } };
	const url = `/api/builds/${buildId}/custom-pieces/${pieceId}`;

	// replaces naming something that is not a kit part of the build: refused, nothing added.
	const bad = await page.request.post(`/api/builds/${buildId}/custom-pieces`, {
		headers: h,
		data: { libraryId: other.id, replaces: ['not-a-kit-part'] }
	});
	expect(bad.status()).toBe(400);
	expect((await view(page, buildId)).customPieces).toHaveLength(1);

	await page.goto(chapterUrl);
	const email = uniqueEmail('r2-viewer');
	const link = await invite(page, email, 'viewer');
	const joined = await joinViaInvite(browser, link, 'Vera Viewer', email);
	try {
		const res = await joined.page.request.patch(url, {
			headers: originOf(joined.page),
			data: body
		});
		expect(res.status()).toBe(403);
	} finally {
		await joined.context.close();
	}
	const context = await newClientContext(browser);
	const op = await context.newPage();
	try {
		await signUp(op, 'Otto Outsider', uniqueEmail('r2-outsider'));
		const res = await op.request.patch(url, { headers: originOf(op), data: body });
		expect(res.status()).toBe(404);
	} finally {
		await context.close();
	}
	const roleNow = async () => (await view(page, buildId)).customPieces[0].colors[0].roles[0].role;
	expect(await roleNow()).toBe(from);

	// The owner may.
	const ok = await page.request.patch(url, { headers: h, data: body });
	expect(ok.status()).toBe(200);
	expect(await roleNow()).not.toBe(from);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('wizard confirm step, Design custom parts, saved part Edit form and a draft Files tab stay inside the screen', async ({
		page
	}) => {
		const { chapterUrl, buildId } = await ownerWithBuild(page, 'r2-phone');
		const org = await orgOf(page, buildId);
		const [k1, k2] = kitParts(await view(page, buildId), 2);
		// A part that replaces two kit parts (for the wizard) and one that replaces none (the Design tab, a draft).
		await seedSaved(page, org, 'Replacing part with quite a long name to wrap on a phone', {
			replaces: [k1.slug, k2.slug]
		});
		const saved = await seedSaved(
			page,
			org,
			'A saved custom part with quite a long name to wrap on a phone'
		);

		// Wizard: the confirm step open, with its "Add to build" button on screen.
		await page.goto(chapterUrl);
		await startBuild(page, 'Phone chair');
		await toSetupStep(page, 2);
		await page
			.getByTestId('setup-saved-part')
			.filter({ hasText: 'Replacing part' })
			.getByTestId('setup-saved-add')
			.click();
		const step = page.getByTestId('setup-saved-confirm-step');
		await expect(step).toBeVisible();
		await expect(page.getByTestId('setup-saved-confirm')).toBeInViewport();
		await noOverflow(page, 'wizard confirm step');
		await expect(page.getByTestId('setup-saved-confirm')).toBeInViewport();

		// Design tab of a build that holds the part.
		await page.setViewportSize({ width: 390, height: 844 });
		const add = await page.request.post(`/api/builds/${buildId}/custom-pieces`, {
			headers: originOf(page),
			data: { libraryId: saved.id }
		});
		expect(add.status()).toBe(200);
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('tab', { name: 'Parts' }).click();
		await expect(page.getByTestId('design-custom-parts')).toBeVisible();
		await page.getByTestId('design-custom-parts').scrollIntoViewIfNeeded();
		await noOverflow(page, 'Design tab custom parts');

		// The saved part's Edit form.
		await page.goto(`${teamPath(chapterUrl)}/pieces`);
		await page.waitForLoadState('networkidle');
		await page
			.getByTestId('saved-part')
			.filter({ hasText: 'Replacing part' })
			.getByTestId('saved-part-edit')
			.click();
		await expect(page.getByTestId('saved-part-edit-form')).toBeVisible();
		await noOverflow(page, 'saved part Edit form');

		// A draft's Files tab, holding the saved part.
		await page.goto('/studio');
		await page.waitForLoadState('networkidle');
		await page.getByTestId('new-draft').click();
		await page.getByTestId('create-draft').click();
		await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
		const draftId = new URL(page.url()).pathname.split('/')[2];
		const onDraft = await page.request.post(`/api/builds/${draftId}/custom-pieces`, {
			headers: originOf(page),
			data: { libraryId: saved.id }
		});
		expect(onDraft.status()).toBe(200);
		await openFiles(page, draftId);
		await expect(page.getByTestId('custom-piece')).toBeVisible();
		await noOverflow(page, 'draft Files tab');
	});
});
