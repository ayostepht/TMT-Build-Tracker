import { expect, newClientContext, test } from './fixtures';
import { ownerWithBuild, signUp, startBuild, uniqueEmail } from './helpers';
import { registerSyntheticGeometry, removeSyntheticGeometry } from './print-geometry-helper';

const SHOTS = 'data/shots-ia';

// The e2e DB is shared across specs; don't leave synthetic geometry behind for them.
test.afterAll(() => removeSyntheticGeometry());

const heading = (page: import('@playwright/test').Page, name: string) =>
	page.getByRole('heading', { name, exact: true });

test('new build walks the setup wizard: template, options, colors, files, export, done', async ({
	page
}) => {
	test.setTimeout(180_000);
	await signUp(page, 'Wendy Wizard', uniqueEmail('wizard'));
	const id = await startBuild(page, 'Wizard chair');
	await page.waitForLoadState('networkidle');

	// Step 1: the built-in kit is chosen. In e2e the bundled MakeGood files are absent, which the
	// step handles: it says so and still lets you carry on.
	await expect(heading(page, 'Choose build template')).toBeVisible();
	await expect(page.getByTestId('tpl-makegood')).toBeChecked();
	const status = page.getByTestId('makegood-status');
	await expect(status).toBeVisible();
	await expect(status).toHaveAttribute('data-state', /^(missing|partial|installing|ready)$/);
	await expect(page.getByTestId('makegood-missing')).toBeVisible();
	// Admins see the drop zone, everyone else is told to ask.
	await expect(page.getByTestId('kit-drop').or(page.getByTestId('kit-ask-admin'))).toBeVisible();
	for (const line of [
		'3MF: plates, painted supports and slicer export (required)',
		'STEP: 3D preview in the designer (optional)',
		'PDF: assembly guide pictures (optional)'
	])
		await expect(page.getByText(line)).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/wizard-step1-template.png`, fullPage: true });

	// Leaving and coming back: Overview offers to continue.
	await page.goto(`/builds/${id}`);
	await expect(page.getByTestId('continue-setup')).toContainText('Continue setup (step 1 of 5)');
	await page.getByRole('link', { name: /Continue setup/ }).click();
	await expect(page).toHaveURL(/\/setup$/);
	await page.waitForLoadState('networkidle');

	// Steps after the furthest one reached are not reachable yet.
	await expect(page.getByTestId('setup-step-3')).toBeDisabled();
	await page.getByTestId('wizard-next').click();

	// Step 2: options.
	await expect(heading(page, 'Options')).toBeVisible();
	await expect(page).toHaveURL(/step=2/);
	await page.getByTestId('wizard-next').click();

	// Step 3: colors. The full design workspace is embedded (no link out to the Design tab).
	await expect(heading(page, 'Colors').first()).toBeVisible();
	await expect(page.getByTestId('open-designer')).toHaveCount(0);
	await expect(page.getByTestId('design-workspace')).toBeVisible();
	await expect(page.getByTestId('no-model').or(page.locator('canvas').first())).toBeVisible();
	await page.waitForLoadState('networkidle');
	await page.getByTestId('open-palettes').click();
	await page.locator('[data-palette="fire-truck"]').click();
	await page.getByTestId('palette-bar').getByRole('button', { name: 'Apply' }).click();
	await expect(page.getByText('Applied Fire Truck')).toBeVisible();
	// Move a part between slots right here, then save-as-design is on offer too.
	await page.getByRole('tab', { name: 'Parts' }).click();
	const wing = page.locator('button.row[data-slug="wing-left"]');
	const wingBefore = await wing.innerText();
	await wing.click();
	const sheet = page.getByTestId('part-sheet');
	await expect(sheet).toContainText('Wing Left');
	await sheet.locator('button[data-role="primary"]:not([aria-pressed="true"])').click();
	await expect(page.locator('button.row[data-slug="wing-left"]')).not.toHaveText(wingBefore);
	await expect(page.getByTestId('wizard-next')).toBeVisible();
	await page.getByTestId('wizard-next').click();

	// Step 4: files. Choose the 256 mm bed preset and arrange.
	await expect(heading(page, 'Files').first()).toBeVisible();
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-preset-256x256').click();
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toContainText('Arranged for');
	await expect(page.getByTestId('plate-diagram').first()).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/wizard-step4-print.png`, fullPage: false });

	// Done steps can be revisited from the step bar.
	await page.getByTestId('setup-step-2').click();
	await expect(heading(page, 'Options')).toBeVisible();
	await page.getByTestId('setup-step-4').click();
	await expect(page.getByTestId('layout-name')).toContainText('Arranged for');
	await page.getByTestId('wizard-next').click();

	// Step 5: export. Synthetic geometry stands in for the MakeGood print files.
	await expect(heading(page, 'Export').first()).toBeVisible();
	registerSyntheticGeometry();
	const re = await page.request.post(`/api/builds/${id}/plates/arrange`, {
		data: { convertRuns: true }
	});
	expect(re.ok()).toBe(true);
	await page.reload();
	await expect(page.getByTestId('export-count')).toBeVisible();
	await expect(page.getByTestId('export-download')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/wizard-step5-export.png`, fullPage: false });

	// Finish: the Done screen, then the build's Overview without the continue banner.
	await page.getByTestId('wizard-done').click();
	await expect(page.getByTestId('setup-done')).toBeVisible();
	await page.getByTestId('setup-finish').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
	await expect(page.getByTestId('continue-setup')).toHaveCount(0);
	await expect(page.locator('.overall-top')).toBeVisible();
});

test('"Upload your own files" makes a workspace-owned copy of the kit', async ({
	page,
	browser
}) => {
	test.setTimeout(90_000);
	await signUp(page, 'Olga Own', uniqueEmail('own'));
	const id = await startBuild(page, 'Remix chair');
	await page.waitForLoadState('networkidle');
	const view = async () =>
		(await (await page.request.get(`/api/builds/${id}/view`)).json()) as {
			build: { templateId: string; templateOwned: boolean };
			parts: unknown[];
		};
	const before = await view();
	expect(before.build.templateOwned).toBe(false);

	await page.getByTestId('tpl-own').check();
	await expect(page.getByTestId('own-files')).toBeVisible();
	// The workspace owner may import into their own copy: the drop zone is there.
	await expect(page.getByTestId('kit-drop')).toBeVisible();
	const own = await view();
	expect(own.build.templateOwned).toBe(true);
	expect(own.build.templateId).not.toBe(before.build.templateId);
	expect(own.parts).toHaveLength(before.parts.length);
	await page.screenshot({ path: `${SHOTS}/wizard-step1-own-files.png`, fullPage: true });

	// Import rights: the owner passes the guard for their copy (a junk file is a 400, not a 404);
	// the built-in kit stays site-admin only and outsiders get a 404 on the copy.
	const junk = { data: Buffer.from('not a 3mf') };
	const mine = await page.request.post(
		`/api/templates/${own.build.templateId}/print-geometry?name=x.3mf`,
		junk
	);
	expect(mine.status()).not.toBe(404);
	expect(
		(await page.request.get(`/api/templates/${own.build.templateId}/kit-status`)).status()
	).toBe(200);
	const ctx = await newClientContext(browser);
	try {
		const other = await ctx.newPage();
		await signUp(other, 'Otto Outsider', uniqueEmail('outsider'));
		const theirs = await other.request.post(
			`/api/templates/${own.build.templateId}/print-geometry?name=x.3mf`,
			junk
		);
		expect(theirs.status()).toBe(404);
		const status = await (
			await other.request.get(`/api/templates/${own.build.templateId}/kit-status`)
		).json();
		expect(status.canImport).toBe(false);
	} finally {
		await ctx.close();
	}

	// Back to the built-in kit and again to the same copy.
	await page.getByTestId('tpl-makegood').check();
	await expect(page.getByTestId('makegood-status')).toBeVisible();
	await expect.poll(async () => (await view()).build.templateOwned).toBe(false);
	await page.getByTestId('tpl-own').check();
	await expect.poll(async () => (await view()).build.templateOwned).toBe(true);
	expect((await view()).build.templateId).toBe(own.build.templateId);
});

test('old tab URLs redirect to the new tabs', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'redirects');
	const b = `/builds/${buildId}`;
	// 308 for every old path, with the query string kept.
	for (const [from, to] of [
		['parts', 'print'],
		['plates', 'files'],
		['assembly', 'finish'],
		['handoff', 'finish']
	]) {
		const r = await page.request.get(`${b}/${from}?x=1`, { maxRedirects: 0 });
		expect(r.status(), from).toBe(308);
		expect(r.headers()['location'], from).toContain(`${b}/${to}?x=1`);
	}
	await page.goto(`${b}/parts`);
	await expect(page).toHaveURL(new RegExp(`${b}/print$`));
	await expect(page.getByRole('toolbar', { name: 'Filter parts' })).toBeVisible();
	await page.goto(`${b}/plates`);
	await expect(page).toHaveURL(new RegExp(`${b}/files$`));
	await expect(page.getByTestId('plate-layout')).toBeVisible();
	await page.goto(`${b}/assembly`);
	await expect(page).toHaveURL(new RegExp(`${b}/finish#assembly$`));
	await page.goto(`${b}/handoff`);
	await expect(page).toHaveURL(new RegExp(`${b}/finish#handoff$`));
	await expect(page.getByLabel('Recipient name')).toBeVisible();

	// /print was the plates view: its old anchors (bookmarks) move on to /files.
	for (const h of ['plates', 'export', 'settings']) {
		await page.goto(`${b}/print#${h}`);
		await expect(page).toHaveURL(new RegExp(`${b}/files#${h}$`));
		await expect(page.getByTestId('print-settings')).toBeVisible();
	}
	await page.goto(`${b}/print`);
	await expect(page).toHaveURL(new RegExp(`${b}/print$`));
});

test('setup wizard: ?step= accepts numbers and names, including the old "print"', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'step-names');
	for (const s of ['4', 'files', 'print']) {
		await page.goto(`/builds/${buildId}/setup?step=${s}`);
		await expect(page.getByTestId('plate-layout')).toBeVisible();
	}
});

test('navigation: Builds menu, back to the build on phones, chapter tabs', async ({ page }) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'nav');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForLoadState('networkidle');

	// Build tabs.
	await page.goto(`/builds/${buildId}`);
	const tabs = page.getByRole('navigation', { name: 'Build sections' });
	for (const t of ['Overview', 'Design', 'Print', 'Files', 'Finish', 'Settings'])
		await expect(tabs.getByRole('link', { name: t, exact: true })).toBeVisible();
	await expect(tabs.getByRole('link', { name: 'Plates' })).toHaveCount(0);
	// Order: Overview, Design, Print, Files, Finish, Settings.
	expect(await tabs.getByRole('link').allTextContents()).toEqual([
		'Overview',
		'Design',
		'Print',
		'Files',
		'Finish',
		'⚙ Settings'
	]);
	await expect(tabs.getByRole('link', { name: 'Parts' })).toHaveCount(0);

	// The Builds menu lists this build with its progress, All builds and New build.
	await page.getByTestId('builds-menu').click();
	const menu = page.getByTestId('builds-menu-panel');
	await expect(menu).toContainText('Test chair');
	await expect(menu.getByTestId('all-builds')).toBeVisible();
	await expect(menu.getByTestId('menu-new-build')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/nav-builds-menu-390.png` });
	await page.keyboard.press('Escape');
	await expect(page.getByRole('banner').getByTestId('nav-printers')).toBeVisible();
	await expect(menu).toHaveCount(0);

	// On a phone the build's name leads back to its Overview from other tabs and from Designs.
	await page.goto(`/builds/${buildId}/print`);
	await page.getByTestId('back-to-build').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
	await page.getByRole('banner').getByRole('link', { name: 'Studio' }).click();
	await expect(page).toHaveURL(/\/studio\?from=/);
	await expect(page.getByTestId('back-to-build-link')).toContainText('Test chair');
	await page.getByTestId('back-to-build-link').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));

	// Chapter page tabs.
	await page.goto(chapterUrl);
	const ct = page.getByRole('navigation', { name: 'Workspace sections' });
	for (const t of ['Builds', 'Members', 'Printers', 'Integrations'])
		await expect(ct.getByRole('link', { name: t, exact: true })).toBeVisible();
	await ct.getByRole('link', { name: 'Integrations' }).click();
	await expect(page.getByTestId('autolog')).toBeVisible();
	await ct.getByRole('link', { name: 'Printers' }).click();
	await expect(page.getByTestId('add-printer')).toBeVisible();
	await ct.getByRole('link', { name: 'Members' }).click();
	await expect(page.getByRole('heading', { name: 'Invite', exact: true })).toBeVisible();
});
