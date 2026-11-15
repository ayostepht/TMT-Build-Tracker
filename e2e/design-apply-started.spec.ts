import type { Page } from '@playwright/test';
import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { arrangeForCentauri, createBuild, ownerWithBuild } from './helpers';

// Issue #56, design side: applying a design (or a palette) to a build that has started printing asks
// first, "Colors only" keeps everything but the slot filaments, and plates are never rebuilt under a
// started build. Every test makes its own user, builds and designs.

interface Filament {
	key: string;
	name: string;
	material: string;
	hex: string;
	spools: number;
}
interface PartDef {
	slug: string;
	role: string;
	locked: boolean;
}
interface View {
	filaments: Filament[];
	allParts: PartDef[];
	state: Record<string, { status: string }>;
	plates: { number: number; name: string; parts: string[] }[];
	started: { started: boolean; liveJobs: number; printingPlates: number[] };
}

async function api(page: Page, method: string, url: string, data?: unknown) {
	const res = await page.request.fetch(url, { method, data });
	return { status: res.status(), body: await res.json().catch(() => ({})) };
}

async function viewOf(page: Page, buildId: string): Promise<View> {
	const { status, body } = await api(page, 'GET', `/api/builds/${buildId}/view`);
	expect(status).toBe(200);
	return body as View;
}

// Plate identity (numbers, names, parts); times may legitimately change (a linked job sets one).
const platesOf = (v: View) => JSON.stringify(v.plates.map((p) => [p.number, p.name, p.parts]));
const hexOf = (v: View, key: string) => v.filaments.find((f) => f.key === key)!.hex.toLowerCase();
const statesOf = (v: View) =>
	JSON.stringify(Object.entries(v.state).map(([slug, s]) => [slug, s.status]));

/**
 * Saves a design (private) from a separate source build in the chapter that recolors primary and accent (PETG, so
 * nothing is skipped for material) and leaves soft and tire as the build has them.
 */
async function makeDesign(page: Page, chapterUrl: string, name: string) {
	await page.goto(chapterUrl);
	const buildId = await createBuild(page, `Source ${name}`);
	const v = await viewOf(page, buildId);
	const keep = (key: string) => {
		const f = v.filaments.find((x) => x.key === key)!;
		return { name: f.name, material: f.material, hex: f.hex };
	};
	await api(page, 'PATCH', `/api/builds/${buildId}/design`, {
		palette: {
			label: name,
			slots: {
				primary: { name: 'Ocean', material: 'PETG', hex: '#0044cc' },
				accent: { name: 'Sunset', material: 'PETG', hex: '#ee6611' },
				soft: keep('soft'),
				tire: keep('tire')
			}
		}
	});
	const made = await api(page, 'POST', '/api/designs', { buildId, name, isPublic: false });
	expect(made.status).toBe(200);
	return made.body.id as string;
}

/** Puts the first part of the first plate into `status` (a started build); returns its slug. */
async function startPart(page: Page, buildId: string, status: string, nth = 0) {
	const v = await viewOf(page, buildId);
	const slug = v.plates[0].parts[nth];
	const r = await api(page, 'POST', `/api/builds/${buildId}/parts/${slug}/status`, { status });
	expect(r.status).toBe(200);
	return slug;
}

async function lockPart(page: Page, buildId: string, role: string) {
	const v = await viewOf(page, buildId);
	const slug = v.allParts.find((p) => p.role === role)!.slug;
	await api(page, 'PATCH', `/api/builds/${buildId}/design`, {
		lock: { slugs: [slug], locked: true }
	});
	return slug;
}

async function openDialog(page: Page, buildId: string, designName: string) {
	await page.goto(`/builds/${buildId}/design`);
	await page.getByTestId('open-apply').click();
	await page.getByTestId('apply-design-select').selectOption({ label: `${designName} (mine)` });
	await page.getByRole('button', { name: 'Apply this design…' }).click();
	const dlg = page.getByTestId('started-apply-dialog');
	await expect(dlg.getByTestId('started-apply-summary')).toBeVisible();
	return dlg;
}

/**
 * A printer job that is printing right now and linked to `plateNumber` of the build, through the
 * SDCP mock (as printer-partial does). The caller stops the mock.
 */
async function liveJob(page: Page, buildId: string, plateNumber: number) {
	const mock = new MockSdcp();
	await mock.start();
	try {
		const { organizationId } = (await (
			await page.request.get(`/api/builds/${buildId}/printer-jobs`)
		).json()) as { organizationId: string };
		const created = await page.request.post('/api/printers', {
			data: {
				organizationId,
				name: 'Shop Centauri',
				kind: 'elegoo-sdcp',
				host: '127.0.0.1',
				port: mock.port,
				secrets: { mainboardId: 'ABCDEF' }
			}
		});
		expect(created.ok()).toBe(true);
		mock.printing('benchy.gcode', 40);
		let jobId = '';
		await expect
			.poll(
				async () => {
					const j = (await (
						await page.request.get(`/api/builds/${buildId}/printer-jobs`)
					).json()) as { jobs: { id: string }[] };
					jobId = j.jobs[0]?.id ?? '';
					return jobId;
				},
				{ timeout: 20_000 }
			)
			.not.toBe('');
		const link = await page.request.post(`/api/printers/jobs/${jobId}`, {
			data: { action: 'link', buildId, plateNumber }
		});
		expect(link.ok()).toBe(true);
		await expect
			.poll(async () => (await viewOf(page, buildId)).started.liveJobs)
			.toBeGreaterThan(0);
		return mock;
	} catch (e) {
		await mock.stop();
		throw e;
	}
}

test('colors only: slots recolor; plates, part states and locks stay; activity says so', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'dstarted-colors');
	const name = `Colors only ${Date.now().toString(36)}`;
	const designId = await makeDesign(page, chapterUrl, name);
	expect(designId).toBeTruthy();
	await startPart(page, buildId, 'Printed');
	const locked = await lockPart(page, buildId, 'tire');
	const before = await viewOf(page, buildId);
	expect(before.started.started).toBe(true);
	expect(hexOf(before, 'primary')).not.toBe('#0044cc');

	const dlg = await openDialog(page, buildId, name);
	await expect(dlg.getByTestId('started-apply-blocked')).toHaveCount(0);
	await dlg.getByTestId('started-apply-colors').click();
	await expect(dlg).toHaveCount(0);
	await expect(page.getByText(`Applied the colors of "${name}"`)).toBeVisible();

	const after = await viewOf(page, buildId);
	expect(hexOf(after, 'primary')).toBe('#0044cc');
	expect(hexOf(after, 'accent')).toBe('#ee6611');
	expect(hexOf(after, 'tire')).toBe(hexOf(before, 'tire'));
	expect(after.plates.length).toBe(before.plates.length);
	expect(after.plates.map((p) => p.number)).toEqual(before.plates.map((p) => p.number));
	expect(platesOf(after)).toBe(platesOf(before));
	expect(statesOf(after)).toBe(statesOf(before));
	expect(after.allParts.filter((p) => p.locked).map((p) => p.slug)).toEqual([locked]);
	expect(after.allParts.map((p) => [p.slug, p.role])).toEqual(
		before.allParts.map((p) => [p.slug, p.role])
	);

	await page.goto(`/builds/${buildId}/activity`);
	await expect(
		page.getByText(`changed the colors to design "${name}" (colors only; plates and progress kept)`)
	).toBeVisible();
});

test('undo after a colors-only apply restores the previous slot filaments', async ({ page }) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'dstarted-undo');
	const name = `Undo me ${Date.now().toString(36)}`;
	await makeDesign(page, chapterUrl, name);
	await startPart(page, buildId, 'Reprint');
	const before = await viewOf(page, buildId);

	const dlg = await openDialog(page, buildId, name);
	await dlg.getByTestId('started-apply-colors').click();
	await expect(dlg).toHaveCount(0);
	await expect.poll(async () => hexOf(await viewOf(page, buildId), 'primary')).toBe('#0044cc');

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect
		.poll(async () => hexOf(await viewOf(page, buildId), 'primary'))
		.toBe(hexOf(before, 'primary'));
	const after = await viewOf(page, buildId);
	expect(
		after.filaments.map((f) => [f.key, f.name, f.material, f.hex.toLowerCase()]).sort()
	).toEqual(before.filaments.map((f) => [f.key, f.name, f.material, f.hex.toLowerCase()]).sort());
	expect(platesOf(after)).toBe(platesOf(before));
});

test('replacing print files is off while a part is printing, on otherwise, and keeps locks', async ({
	page
}) => {
	test.setTimeout(120_000);
	const { chapterUrl } = await ownerWithBuild(page, 'dstarted-full');
	const name = `Full ${Date.now().toString(36)}`;
	await makeDesign(page, chapterUrl, name);

	// A part is Printing on an arranged plate: only colors only is offered.
	await page.goto(chapterUrl);
	const printing = await createBuild(page, 'Printing build');
	await page.goto(`/builds/${printing}/files`);
	await arrangeForCentauri(page);
	await expect(page.getByTestId('layout-name')).toBeVisible();
	await startPart(page, printing, 'Printing');
	let dlg = await openDialog(page, printing, name);
	await expect(dlg.getByTestId('started-apply-summary')).toContainText('is printing');
	await expect(dlg.getByTestId('started-apply-blocked')).toBeVisible();
	await expect(dlg.getByTestId('started-apply-full')).toBeDisabled();
	await expect(dlg.getByTestId('started-apply-colors')).toBeEnabled();
	await page.keyboard.press('Escape');
	await expect(dlg).toHaveCount(0);

	// Started but nothing printing: both are offered; a full replace keeps the locks.
	await page.goto(chapterUrl);
	const idle = await createBuild(page, 'Reprint build');
	await startPart(page, idle, 'Reprint');
	const locked = await lockPart(page, idle, 'accent');
	dlg = await openDialog(page, idle, name);
	await expect(dlg.getByTestId('started-apply-blocked')).toHaveCount(0);
	await expect(dlg.getByTestId('started-apply-full')).toBeEnabled();
	await dlg.getByTestId('started-apply-full').click();
	await expect(dlg).toHaveCount(0);
	await expect(page.getByText(/colors and print files/)).toBeVisible();
	const after = await viewOf(page, idle);
	expect(hexOf(after, 'primary')).toBe('#0044cc');
	expect(after.allParts.find((p) => p.slug === locked)!.locked).toBe(true);
});

test('replacing print files is off while a printer job is live', async ({ page }) => {
	test.setTimeout(120_000);
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'dstarted-live');
	const name = `Live ${Date.now().toString(36)}`;
	const designId = await makeDesign(page, chapterUrl, name);
	const plate = (await viewOf(page, buildId)).plates[0].number;
	const mock = await liveJob(page, buildId, plate);
	try {
		const dlg = await openDialog(page, buildId, name);
		await expect(dlg.getByTestId('started-apply-blocked')).toBeVisible();
		await expect(dlg.getByTestId('started-apply-full')).toBeDisabled();
		await expect(dlg.getByTestId('started-apply-colors')).toBeEnabled();
		await page.keyboard.press('Escape');

		// The server agrees, with the confirmation too.
		const full = await api(page, 'POST', `/api/designs/${designId}/apply`, {
			buildId,
			mode: 'full',
			confirm: true
		});
		expect(full.status).toBe(409);
		expect(full.body).toMatchObject({ code: 'build-started' });
	} finally {
		await mock.stop();
	}
});

test('apply API: no mode asks (409), full while printing is refused, colors works', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'dstarted-api');
	const designId = await makeDesign(page, chapterUrl, `Api ${Date.now().toString(36)}`);
	const before = await viewOf(page, buildId);
	const url = `/api/designs/${designId}/apply`;

	// Not started: the plain call works as it always did.
	const plain = await api(page, 'POST', url, { buildId });
	expect(plain.status).toBe(200);

	await startPart(page, buildId, 'Printing');
	const started = await viewOf(page, buildId);
	const midPrint = platesOf(started);

	const bare = await api(page, 'POST', url, { buildId });
	expect(bare.status).toBe(409);
	expect(bare.body).toMatchObject({ code: 'build-started' });
	expect(bare.body.started).toMatchObject({ started: true });
	expect(typeof bare.body.summary).toBe('string');
	expect(bare.body.summary).toContain('is printing');

	const full = await api(page, 'POST', url, { buildId, mode: 'full', confirm: true });
	expect(full.status).toBe(409);
	expect(full.body).toMatchObject({ code: 'build-started' });

	// Colors only: allowed while printing; the plates stay.
	const colors = await api(page, 'POST', url, { buildId, mode: 'colors' });
	expect(colors.status).toBe(200);
	const after = await viewOf(page, buildId);
	expect(platesOf(after)).toBe(midPrint);
	expect(hexOf(after, 'primary')).toBe('#0044cc');
	expect(hexOf(before, 'primary')).not.toBe('#0044cc');
});

test('palette Apply on a started build asks first; Cancel changes nothing', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'dstarted-palette');
	await startPart(page, buildId, 'Printed');
	const before = await viewOf(page, buildId);

	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Palettes' }).click();
	await expect(page.getByTestId('palettes-drawer')).toBeVisible();
	const list = page.getByRole('group', { name: 'Ready-made palettes' });
	if (!(await list.isVisible()))
		await page.getByTestId('readymade-toggle').locator('summary').click();
	await page.locator('[data-palette="fire-truck"]').click();
	await page.getByTestId('palette-bar').getByRole('button', { name: 'Apply' }).click();

	const dlg = page.getByTestId('started-apply-dialog');
	await expect(dlg.getByTestId('started-apply-summary')).toBeVisible();
	await expect(dlg.getByTestId('started-apply-colors')).toBeVisible();
	await dlg.getByRole('button', { name: 'Cancel' }).click();
	await expect(dlg).toHaveCount(0);

	const after = await viewOf(page, buildId);
	expect(JSON.stringify(after.filaments)).toBe(JSON.stringify(before.filaments));
	expect(platesOf(after)).toBe(platesOf(before));
	await expect(page.getByText('Applied Fire Truck')).toHaveCount(0);
});

test('a build that has not started keeps the old apply flow (no started dialog)', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'dstarted-fresh');
	const name = `Fresh ${Date.now().toString(36)}`;
	await makeDesign(page, chapterUrl, name);
	expect((await viewOf(page, buildId)).started.started).toBe(false);

	await page.goto(`/builds/${buildId}/design`);
	await page.getByTestId('open-apply').click();
	await page.getByTestId('apply-design-select').selectOption({ label: `${name} (mine)` });
	await page.getByRole('button', { name: 'Apply this design…' }).click();
	await expect(
		page.getByRole('alertdialog', { name: 'Confirm applying the design' })
	).toBeVisible();
	await expect(page.getByTestId('started-apply-dialog')).toHaveCount(0);
	await page.getByRole('button', { name: 'Replace colors' }).click();
	await expect(page.getByText(`Applied design "${name}"`)).toBeVisible();
	await expect(page.getByTestId('started-apply-dialog')).toHaveCount(0);
});

test.describe('plates under a started build', () => {
	/** An arranged build (Centauri) with one part Printed, then one part moved to another slot. */
	async function startedArranged(page: Page, label: string) {
		const { buildId } = await ownerWithBuild(page, label);
		await page.goto(`/builds/${buildId}/files`);
		await arrangeForCentauri(page);
		await expect(page.getByTestId('layout-name')).toBeVisible();
		await startPart(page, buildId, 'Printed');
		return buildId;
	}

	async function moveAPart(page: Page, buildId: string) {
		const v = await viewOf(page, buildId);
		const slug = v.allParts.find((p) => p.role === 'primary' && !p.locked)!.slug;
		const r = await api(page, 'PATCH', `/api/builds/${buildId}/design`, {
			partRoles: { [slug]: 'accent' }
		});
		expect(r.status).toBe(200);
	}

	test('colors and part moves do not re-arrange; the banner says plates were kept', async ({
		page
	}) => {
		test.setTimeout(120_000);
		const buildId = await startedArranged(page, 'dstarted-stale');
		const before = await viewOf(page, buildId);
		await moveAPart(page, buildId);

		const after = await viewOf(page, buildId);
		expect(platesOf(after)).toBe(platesOf(before));

		await page.goto(`/builds/${buildId}/files`);
		await expect(page.getByTestId('stale-banner')).toBeVisible();
		await expect(page.getByTestId('stale-text')).toContainText('Your plates were kept');
		await expect(page.getByTestId('stale-text')).toContainText('has started');
	});

	test('re-arranging a started build asks once; Cancel keeps the plates', async ({ page }) => {
		test.setTimeout(120_000);
		const buildId = await startedArranged(page, 'dstarted-rearrange');
		await moveAPart(page, buildId);
		const before = await viewOf(page, buildId);

		await page.goto(`/builds/${buildId}/files`);
		await page
			.getByTestId('stale-banner')
			.getByRole('button', { name: 'Re-arrange plates' })
			.click();
		const ask = page.getByTestId('ask-dialog');
		await expect(ask).toBeVisible();
		await expect(ask.getByTestId('ask-message')).not.toBeEmpty();
		await ask.getByTestId('ask-cancel').click();
		await expect(ask).toHaveCount(0);
		await expect(page.getByTestId('plates-refused')).toHaveCount(0);

		expect(platesOf(await viewOf(page, buildId))).toBe(platesOf(before));
	});

	test('re-arranging is refused while a printer job is live', async ({ page }) => {
		test.setTimeout(120_000);
		const buildId = await startedArranged(page, 'dstarted-refused');
		await moveAPart(page, buildId);
		const before = await viewOf(page, buildId);
		const mock = await liveJob(page, buildId, before.plates[0].number);
		try {
			await page.goto(`/builds/${buildId}/files`);
			await expect(page.getByTestId('plates-refused')).toContainText(
				'wait until the print finishes'
			);
			await expect(
				page.getByTestId('stale-banner').getByRole('button', { name: 'Re-arrange plates' })
			).toBeDisabled();
			await expect(page.getByTestId('ask-dialog')).toHaveCount(0);
			expect(platesOf(await viewOf(page, buildId))).toBe(platesOf(before));
		} finally {
			await mock.stop();
		}
	});
});
