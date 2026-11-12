import { createServer, type Server } from 'node:http';
import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { chooseStatus } from './status-helpers';
import { gotoIntegrations, openElegooForm } from './integrations-helpers';
import { createBuild, openNav, ownerWithBuild, signUp, startBuild, uniqueEmail } from './helpers';

const SHOTS = 'data/shots-m7';
const FILE = 'Plate 1 - Handle Left.gcode';

let mock: MockSdcp;
let spoolman: Server;
let spoolmanPort = 0;
let used = 100;

test.beforeAll(async () => {
	mock = new MockSdcp();
	await mock.start();
	spoolman = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			res.setHeader('content-type', 'application/json');
			const spool = (id: number, name: string, hex: string, mat: string, usedG: number) => ({
				id,
				archived: false,
				used_weight: usedG,
				initial_weight: 1000,
				remaining_weight: 1000 - usedG,
				filament: { name, material: mat, color_hex: hex, vendor: { name: 'Overture' } }
			});
			if (req.url === '/api/v1/info') return res.end('{"version":"0.22.1"}');
			if (req.url?.startsWith('/api/v1/spool?'))
				return res.end(
					JSON.stringify([
						spool(1, 'Cobalt Blue', '2b3f9e', 'PETG', used),
						spool(2, 'Signal Orange', 'f26b1d', 'PETG', 20),
						spool(3, 'Black', '151515', 'TPU', 300)
					])
				);
			if (req.method === 'GET' && req.url === '/api/v1/spool/1')
				return res.end(JSON.stringify(spool(1, 'Cobalt Blue', '2b3f9e', 'PETG', used)));
			if (req.method === 'PATCH' && /\/api\/v1\/spool\/1$/.test(req.url ?? ''))
				used = JSON.parse(body).used_weight;
			if (req.method === 'PUT' && /\/api\/v1\/spool\/1\/use$/.test(req.url ?? ''))
				used += JSON.parse(body).use_weight;
			res.end('{}');
		});
	});
	await new Promise<void>((r) => spoolman.listen(0, '127.0.0.1', r));
	spoolmanPort = (spoolman.address() as { port: number }).port;
});
test.afterAll(async () => {
	await mock.stop();
	await new Promise((r) => spoolman.close(() => r(null)));
});

test('printer: add, test connection, live status, job links to a plate, finish, log prompt', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'printers');

	// The Printers view has no add form: its empty state leads to Integrations, where printers are added.
	await page.goto(`${chapterUrl}/printers`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Printers', level: 2 })).toBeVisible();
	await expect(page.getByTestId('printers-empty')).toBeVisible();
	await expect(page.getByTestId('add-printer')).toHaveCount(0);
	await page.getByTestId('printers-manage').first().click();
	await expect(page).toHaveURL(/\/integrations$/);
	await openElegooForm(page);
	await page.getByLabel('Name', { exact: true }).fill('Shop Centauri');
	await page.getByTestId('pf-host').fill('127.0.0.1');
	await page.getByTestId('pf-port').fill(String(mock.port));
	await page.getByLabel('Model (optional)').selectOption({ label: 'Centauri Carbon' });

	// Test connection shows a live snapshot (idle printer).
	await page.getByTestId('pf-test').click();
	await expect(page.getByTestId('test-result')).toContainText('Connected', { timeout: 20_000 });
	await expect(page.getByTestId('test-result').getByTestId('printer-state')).toHaveText('Idle');
	await page.getByTestId('pf-save').click();
	await expect(page.getByTestId('printer-row')).toContainText('Shop Centauri');
	await expect(page.getByTestId('row-connection')).toHaveText('Elegoo · on your network');
	await page.goto(`${chapterUrl}/printers`);
	const card = page.getByTestId('printer-card').first();
	await expect(card).toContainText('Shop Centauri');
	await expect(card.getByTestId('printer-state')).toHaveText('Idle', { timeout: 20_000 });

	// A secret never comes back: the API lists no secret fields, only that they exist.
	const list = await (await page.request.get(`/api/printers?org=${await orgId(page)}`)).json();
	expect(JSON.stringify(list)).not.toMatch(/secretEnc|accessCode|apiKey/);

	// Printer starts the print: card goes live.
	mock.printing(FILE, 12);
	await expect(card.getByTestId('printer-state')).toHaveText('Printing', { timeout: 15_000 });
	await expect(card.getByTestId('printer-progress')).toContainText('12%');
	await expect(card.getByTestId('printer-file')).toHaveText(FILE);
	await page.screenshot({ path: `${SHOTS}/printers-390-light.png`, fullPage: true });

	// Build page: the job linked itself to plate 1 (file name) and shows live progress.
	await page.goto(`/builds/${buildId}`);
	const live = page.getByTestId('printer-live');
	await expect(live).toBeVisible({ timeout: 15_000 });
	await expect(live.getByTestId('live-pct')).toHaveText('12%');
	await expect(live.getByTestId('live-layer')).toContainText('Layer 48 / 400');
	mock.printing(FILE, 55);
	await expect(live.getByTestId('live-pct')).toHaveText('55%', { timeout: 15_000 });
	await expect(live.getByTestId('live-left')).toContainText('min left');
	await live.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/now-printing-390-light.png` });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.screenshot({ path: `${SHOTS}/now-printing-390-dark.png` });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `${SHOTS}/now-printing-1440-dark.png` });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.screenshot({ path: `${SHOTS}/now-printing-1440-light.png` });

	// Finish: a "Confirm print log" prompt, pre-filled; logging it creates the run.
	mock.set({ printStatus: 9, machineStatus: [0], progress: 100 });
	const prompt = page.getByTestId('confirm-print-log');
	await expect(prompt).toBeVisible({ timeout: 15_000 });
	await expect(prompt.getByTestId('confirm-result')).toHaveValue('Success');
	await page.screenshot({ path: `${SHOTS}/confirm-log-1440-light.png` });
	await prompt.getByTestId('confirm-grams').fill('38');
	await prompt.getByTestId('confirm-log').click();
	await expect(prompt).toBeHidden({ timeout: 15_000 });
	await expect(page.locator('body')).toContainText('logged a successful print of plate 1');
	await expect(page.locator('body')).toContainText('Shop Centauri started printing plate 1');

	// Unlinked file: offers "Link to plate…".
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	await page.waitForTimeout(500);
	mock.printing('benchy.gcode', 3);
	const link = page.getByTestId('link-plate');
	await expect(link).toBeVisible({ timeout: 15_000 });
	await link.selectOption({ index: 2 });
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 15_000 });
	mock.set({ printStatus: 8, machineStatus: [0] }); // stopped
	await expect(page.getByTestId('confirm-print-log')).toContainText('was stopped', {
		timeout: 15_000
	});
	await page.getByRole('button', { name: /Don.t log/ }).click();
	await expect(page.getByTestId('confirm-print-log')).toBeHidden();
	mock.set({ printStatus: 0, machineStatus: [0], file: '' });

	// Auto-log: turn it on for the team, run another plate-1 print to the end.
	await page.goto(`${chapterUrl}/integrations`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('autolog').check();
	await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
	const sl = await page.request.patch(`/api/builds/${buildId}/plates/1`, {
		data: { slicerGrams: 44 }
	});
	expect(sl.ok()).toBe(true);
	mock.printing('TMT-Test-chair-plate-1.3mf', 20, { ticks: 2 * 3600, totalTicks: 7200 });
	await page.waitForTimeout(1500);
	mock.set({ printStatus: 9, machineStatus: [0], progress: 100 });
	await page.goto(`/builds/${buildId}`);
	await expect(page.locator('body')).toContainText('logged automatically', { timeout: 20_000 });
	const runs = { view: await (await page.request.get(`/api/builds/${buildId}/view`)).json() };
	const auto = runs.view.runs.filter((r: { note: string }) => r.note.includes('automatically'));
	expect(auto).toHaveLength(1);
	expect(auto[0]).toMatchObject({
		result: 'Success',
		grams: 44,
		hours: 2,
		printer: 'Shop Centauri'
	});

	// Remove the printer again (team-level cleanup).
	await gotoIntegrations(page, chapterUrl);
	await page.getByTestId('remove-printer').click();
	// The dialog opens with Cancel focused; Escape cancels and focus returns to Remove….
	await expect(page.getByTestId('ask-cancel')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('ask-dialog')).toHaveCount(0);
	await expect(page.getByTestId('remove-printer')).toBeFocused();
	await page.getByTestId('remove-printer').click();
	await page.getByTestId('ask-confirm').click();
	await expect(page.getByTestId('printer-row')).toHaveCount(0);
});

test('spoolman: link a spool to a filament, see it on the tiles, grams deducted on a logged run', async ({
	page
}) => {
	test.setTimeout(120_000);
	used = 100;
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'spoolman');

	// Not configured yet.
	await page.goto(`/builds/${buildId}/settings`);
	await expect(page.getByTestId('spoolman-off')).toBeVisible();

	// Team page: set the address, test, turn on auto-deduct.
	await page.goto(`${chapterUrl}/integrations`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('spoolman-url').fill(`127.0.0.1:${spoolmanPort}`);
	await page.getByTestId('spoolman-save').click();
	await expect(page.getByTestId('spoolman-deduct')).toBeEnabled();
	await page.getByTestId('spoolman-deduct').check();
	await page.getByRole('button', { name: 'Test Spoolman' }).click();
	await expect(page.getByRole('status').filter({ hasText: '3 spools' })).toBeVisible();

	// Build settings: link the first filament to spool "Cobalt Blue".
	await page.goto(`/builds/${buildId}/settings`);
	const row = page.locator('.srow').first();
	await row.getByTestId('pick-spool').click();
	await page.getByTestId('spool-search').fill('cobalt');
	await page.getByTestId('spool-option').first().scrollIntoViewIfNeeded();
	await page.getByTestId('spool-link').scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/spoolman-link-390-light.png` });
	await page.getByTestId('spool-option').first().click();
	await expect(row).toContainText('Cobalt Blue');
	await expect(row).toContainText('900 g left');
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.getByTestId('spool-link').scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/spoolman-link-390-dark.png` });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByTestId('spool-link').scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/spoolman-link-1440-light.png` });

	// Overview tile shows remaining grams.
	await page.goto(`/builds/${buildId}`);
	await expect(page.getByTestId('spool-remaining').first()).toContainText('900 g left');
	await page.screenshot({ path: `${SHOTS}/spoolman-tiles-1440-light.png`, fullPage: true });

	// Logging a run deducts from the spool (Handle Left is on the first role).
	const v0 = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const role = v0.parts.find((p: { slug: string }) => p.slug === 'handle-left').role;
	const lk = await page.request.put(`/api/builds/${buildId}/filaments/${role}/spool`, {
		data: { spoolId: 1, spoolName: 'Cobalt Blue' }
	});
	expect(lk.ok()).toBe(true);
	const res = await page.request.post(`/api/builds/${buildId}/runs`, {
		data: { plateNumber: 1, date: '2026-11-03', result: 'Success', grams: 60, hours: 2 }
	});
	expect((await res.json()).spoolmanWarning).toBeUndefined();
	expect(used).toBeGreaterThan(100);
	const first = used;
	// Deleting the run puts it back.
	const view = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const runId = view.runs[view.runs.length - 1].id;
	await page.request.delete(`/api/builds/${buildId}/runs/${runId}`, {
		headers: { origin: new URL(page.url()).origin }
	});
	await expect.poll(() => used).toBeLessThan(first);
});

async function orgId(page: import('@playwright/test').Page): Promise<string> {
	const r = await page.request.get('/api/auth/organization/list');
	const orgs = (await r.json()) as { id: string; metadata?: { personal?: boolean } }[];
	return orgs.find((o) => !o.metadata?.personal)?.id ?? orgs[0].id;
}

test('plate layout picker lists the workspace printers first; adding one is on Integrations', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'picker-printers');

	// No printer yet: the picker offers none and points to Integrations, where one is added.
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	let sel = page.getByTestId('team-printer');
	await expect(sel.locator('option')).toHaveText(['No printers added yet']);
	await page.getByTestId('add-printer-hint').getByRole('link').click();
	await expect(page).toHaveURL(/\/integrations$/);
	await openElegooForm(page);
	await page.getByLabel('Name', { exact: true }).fill('Bench Centauri');
	await page.getByTestId('pf-host').fill('127.0.0.1');
	await page.getByTestId('pf-port').fill(String(mock.port));
	await page.getByLabel('Model (optional)').selectOption({ label: 'Centauri Carbon' });
	await page.getByTestId('pf-save').click();
	await expect(page.getByTestId('printer-row')).toContainText('Bench Centauri');
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	sel = page.getByTestId('team-printer');
	// Added to the team AND selected for this build.
	await expect(sel.locator('option:checked')).toContainText('Bench Centauri');
	await expect(sel.locator('option:checked')).toContainText('256 × 256');
	await expect(page.getByTestId('printer-model')).toHaveValue('elegoo-centauri-carbon');
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Bench Centauri');

	// One printer in the workspace: the setup wizard's Files step preselects it.
	await page.goto(chapterUrl);
	await page.waitForLoadState('networkidle');
	await startBuild(page, 'Printer chair');
	for (let i = 0; i < 3; i++) {
		await page.waitForLoadState('networkidle');
		await page.getByTestId('wizard-next').click();
	}
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await expect(page.getByTestId('team-printer').locator('option:checked')).toContainText(
		'Bench Centauri'
	);
	await page.screenshot({ path: `data/shots-bed/setup-team-printer-390.png`, fullPage: true });
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Bench Centauri');
});

test('top nav Printers reaches the printers page from a build; a personal workspace can add a printer', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await signUp(page, 'Solo Maker', uniqueEmail('solo'));
	// Personal workspace: no chapter. Members stays hidden, Integrations is there.
	await expect(page.getByRole('heading', { level: 1, name: 'My builds' })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByTestId('workspace-settings-menu').click();
	const wsMenu = page.getByTestId('workspace-settings-panel');
	await expect(wsMenu.getByTestId('ws-integrations')).toBeVisible();
	await expect(wsMenu.getByTestId('ws-members')).toHaveCount(0);
	await page.screenshot({ path: `data/shots-nav/menu-settings-1440-light.png` });
	await page.keyboard.press('Escape');
	// Phone: the same items sit in the menu panel and the header never overflows.
	for (const w of [360, 390]) {
		await page.setViewportSize({ width: w, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
		await openNav(page);
		await page.getByTestId('workspace-settings-menu').click();
		const panel = page.getByTestId('workspace-settings-panel');
		await expect(panel.getByRole('link', { name: 'Integrations' })).toBeVisible();
		await expect(panel.getByRole('link', { name: 'Members' })).toHaveCount(0);
		await page.screenshot({ path: `data/shots-nav/menu-account-${w}-light.png` });
		await page.keyboard.press('Escape');
	}
	// The first Escape closed the submenu; a second one closes the phone panel itself.
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 390, height: 844 });
	const buildId = await createBuild(page, 'Solo chair');

	// From the build, the top nav leads to the printers page.
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	await page.screenshot({ path: `data/shots-nav/nav-390-light.png` });
	await openNav(page);
	await page.getByTestId('builds-menu').click();
	await page.screenshot({ path: `data/shots-nav/menu-builds-390-light.png` });
	await page.keyboard.press('Escape');
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.screenshot({ path: `data/shots-nav/nav-390-dark.png` });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `data/shots-nav/nav-1440-dark.png` });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.screenshot({ path: `data/shots-nav/nav-1440-light.png` });
	await page.getByTestId('nav-printers').click();
	await expect(page).toHaveURL(/\/teams\/[^/]+\/printers$/);
	await expect(page.getByRole('heading', { name: 'Printers', level: 2 })).toBeVisible();

	// Contextual links: Overview's Now printing header and the Files tab.
	await page.goto(`/builds/${buildId}`);
	await page.getByTestId('now-printers-link').click();
	await expect(page).toHaveURL(/\/printers$/);
	await page.goto(`/builds/${buildId}/files`);
	await page.getByTestId('manage-printers').click();
	await expect(page).toHaveURL(/\/printers$/);

	// A solo maker adds a printer without creating a chapter: Printers leads to Integrations.
	await page.waitForLoadState('networkidle');
	await page.getByTestId('printers-manage').first().click();
	await expect(page).toHaveURL(/\/integrations$/);
	await openElegooForm(page);
	await page.getByLabel('Name', { exact: true }).fill('Solo Centauri');
	await page.getByTestId('pf-host').fill('127.0.0.1');
	await page.getByTestId('pf-port').fill(String(mock.port));
	await page.getByLabel('Model (optional)').selectOption({ label: 'Centauri Carbon' });
	await page.getByTestId('pf-save').click();
	await expect(page.getByTestId('printer-row').first()).toContainText('Solo Centauri');
	const tabs = page.getByRole('navigation', { name: 'Chapter sections' });
	await tabs.getByRole('link', { name: 'Printers', exact: true }).click();
	await expect(page.getByTestId('printer-card').first()).toContainText('Solo Centauri');
	await tabs.getByRole('link', { name: 'Integrations', exact: true }).click();
	await expect(page.getByTestId('autolog')).toBeVisible();
});

test('per-part plate: link a job to one rim color, Now printing shows it, Change moves it, a stopped print frees the part', async ({
	page
}) => {
	test.setTimeout(150_000);
	const SHOTS_RUN = 'data/shots-run-choice';
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'runchoice');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Rim Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	const state = async (slug: string) =>
		(await (await page.request.get(`/api/builds/${buildId}/view`)).json()).state[slug].status;

	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	mock.printing('rim-job.gcode', 8);

	// Pick the rim plate: a "Which run?" chooser appears, defaulting to the first part with runs left.
	const link = page.getByTestId('link-plate');
	await expect(link).toBeVisible({ timeout: 20_000 });
	await link.selectOption('13');
	const chooser = page.getByTestId('run-chooser');
	await expect(chooser).toBeVisible();
	await expect(chooser).toContainText('Which run?');
	await expect(page.getByTestId('link-run')).toHaveValue('rims-1-4');
	await expect(chooser.locator('option').first()).toContainText('0 of 2 done');
	await page.screenshot({ path: `${SHOTS_RUN}/chooser-390.png` });
	await page.getByTestId('link-run').selectOption('rims-2-3');
	await page.getByTestId('link-run-go').click();

	const live = page.getByTestId('printer-live');
	await expect(live).toBeVisible({ timeout: 15_000 });
	await expect(live.getByTestId('live-part-text')).toContainText('run 1 of 2');
	await expect(live.getByTestId('live-part-change')).toHaveValue('rims-2-3');
	expect(await state('rims-2-3')).toBe('Printing');
	expect(await state('rims-1-4')).not.toBe('Printing');
	const before = await live.getByTestId('live-part-text').innerText();

	// Layout at phone widths: the card uses the full content width and nothing spills out of it.
	const SHOTS_NOW = 'data/shots-mobile-now';
	const tag = process.env.SHOT_TAG ?? 'after';
	for (const w of [390, 360]) {
		await page.setViewportSize({ width: w, height: 844 });
		await expect(live).toBeVisible();
		await page.getByTestId('now-card').scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${SHOTS_NOW}/${tag}-${w}.png` });
		const m = await page.evaluate(() => {
			const card = document.querySelector('[data-testid="now-card"]')!.getBoundingClientRect();
			const wrap = document.querySelector('.wrap')!;
			const cs = getComputedStyle(wrap);
			const contentW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
			const out: string[] = [];
			for (const el of document.querySelectorAll('[data-testid="now-card"] *')) {
				const r = el.getBoundingClientRect();
				if (r.width > 0 && r.right > card.right + 1)
					out.push(`${el.tagName}.${(el as HTMLElement).className} right=${r.right}`);
			}
			return {
				cardW: card.width,
				contentW,
				out,
				scroll: document.documentElement.scrollWidth,
				client: document.documentElement.clientWidth
			};
		});
		expect(m.out, `overflowing at ${w}px`).toEqual([]);
		expect(m.cardW, `card width at ${w}px`).toBeGreaterThanOrEqual(m.contentW - 1);
		expect(m.scroll, `page scroll at ${w}px`).toBeLessThanOrEqual(m.client);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByTestId('now-card').scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS_NOW}/${tag}-1440.png` });
	await page.setViewportSize({ width: 390, height: 844 });

	// Change to the other color: Printing moves with it.
	await live.getByTestId('live-part-change').selectOption('rims-1-4');
	await expect(live.getByTestId('live-part-change')).toHaveValue('rims-1-4');
	await expect(live.getByTestId('live-part-text')).not.toHaveText(before);
	await expect.poll(() => state('rims-1-4')).toBe('Printing');
	expect(await state('rims-2-3')).not.toBe('Printing');

	await live.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS_RUN}/now-printing-390.png` });
	await page.setViewportSize({ width: 1440, height: 900 });
	await live.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS_RUN}/now-printing-1440.png` });

	// Stopped print, prompt dismissed, nothing logged: the part is no longer Printing.
	mock.set({ printStatus: 8, machineStatus: [0] });
	await expect(page.getByTestId('confirm-print-log')).toContainText('was stopped', {
		timeout: 15_000
	});
	await page.getByRole('button', { name: /Don.t log/ }).click();
	await expect(page.getByTestId('confirm-print-log')).toBeHidden();
	await expect.poll(() => state('rims-1-4')).toBe('To print');
	mock.set({ printStatus: 0, machineStatus: [0], file: '' });
});

test('a plate cancelled before it started logs nothing; one stopped at 40% offers a scaled Failed log', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'cancelled');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Cancel Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	expect(
		(
			await page.request.patch(`/api/builds/${buildId}/plates/1`, { data: { slicerGrams: 50 } })
		).ok()
	).toBe(true);
	const view = async () => (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const status = async () => (await view()).state['handle-left'].status;
	const idle = () => mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });

	idle();
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');

	// Cancelled at 0%: no run, no prompt, the part is back to To print, the activity says so.
	mock.printing(FILE, 0);
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 20_000 });
	await expect.poll(status).toBe('Printing');
	mock.set({ printStatus: 8, machineStatus: [0] });
	await expect.poll(status, { timeout: 15_000 }).toBe('To print');
	await expect(page.getByTestId('confirm-print-log')).toHaveCount(0);
	expect((await view()).runs).toHaveLength(0);
	await page.reload();
	await expect(page.locator('body')).toContainText('before it started; nothing was logged');
	idle();
	await page.waitForTimeout(500);

	// Stopped at 40%: prompt with Failed and grams scaled by progress (40% of 50 g), can be dismissed.
	mock.printing(FILE, 40);
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 20_000 });
	mock.set({ printStatus: 8, machineStatus: [0] });
	const prompt = page.getByTestId('confirm-print-log');
	await expect(prompt).toBeVisible({ timeout: 15_000 });
	await expect(prompt.getByTestId('confirm-result')).toHaveValue('Failed');
	await expect(prompt.getByTestId('confirm-grams')).toHaveValue('20');
	await prompt.getByTestId('confirm-dismiss').click();
	await expect(prompt).toBeHidden();
	await expect.poll(status).toBe('To print');
	expect((await view()).runs).toHaveLength(0);
	idle();
	await page.waitForTimeout(500);

	// The same again, but logged: a Failed run with the scaled grams, the part is flagged for reprint.
	mock.printing(FILE, 40);
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 20_000 });
	mock.set({ printStatus: 8, machineStatus: [0] });
	await expect(prompt).toBeVisible({ timeout: 15_000 });
	await prompt.getByTestId('confirm-log').click();
	await expect(prompt).toBeHidden();
	const v = await view();
	expect(v.runs).toHaveLength(1);
	expect(v.runs[0]).toMatchObject({ result: 'Failed', grams: 20, plateNumber: 1 });
	expect(v.state['handle-left'].status).toBe('Reprint');
	idle();
});

test('Now printing shows the live printer box and camera tile at 390 and 1440, and recovers from a failed first load', async ({
	page
}) => {
	test.setTimeout(150_000);
	const SHOTS_CAM = 'data/cam-fix';
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'camfix');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Cam Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	mock.printing(FILE, 81);

	// The printer-jobs requests fail (a dropped connection on a phone) until Retry is pressed: the
	// card says so and Retry recovers. (Every reload fails, so event-driven reloads cannot hide it.)
	let failing = true;
	await page.route('**/api/builds/*/printer-jobs', async (route) => {
		if (failing) {
			return route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: '{"error":"boom"}'
			});
		}
		return route.continue();
	});
	// The Now card (which shows the error) exists once the printer's job has linked and set the part Printing.
	await expect
		.poll(
			async () =>
				(await (await page.request.get(`/api/builds/${buildId}/view`)).json()).state['handle-left']
					.status,
			{ timeout: 20_000 }
		)
		.toBe('Printing');
	await page.goto(`/builds/${buildId}`);
	const live = page.getByTestId('printer-live');
	const err = page.getByTestId('printer-status-error');
	await expect(err).toContainText('Printer status unavailable', { timeout: 20_000 });
	// Retry while the requests still fail: the error stays and the button stays put.
	await err.getByRole('button', { name: 'Retry' }).click();
	await expect(err).toContainText('Printer status unavailable');
	failing = false;
	// Once requests succeed again, any reload (an SSE event, the 30 s poll, window focus) clears the
	// error by itself, so the button can vanish before this click lands. Both paths must recover.
	await err
		.getByRole('button', { name: 'Retry' })
		.click({ timeout: 3_000 })
		.catch(() => {});
	await expect(live).toBeVisible({ timeout: 20_000 });
	await expect(err).toBeHidden();
	await expect(page.getByTestId('camera-tile')).toBeVisible();
	await expect(page.getByTestId('camera-tile')).toContainText(
		/Camera unavailable|Retry|Updates every|Streaming/
	);
	for (const [w, h] of [
		[390, 844],
		[1440, 900]
	]) {
		await page.setViewportSize({ width: w, height: h });
		await live.scrollIntoViewIfNeeded();
		await expect(live).toBeVisible();
		await expect(page.getByTestId('camera-tile')).toBeVisible();
		await page.screenshot({ path: `${SHOTS_CAM}/now-printing-${w}.png` });
	}
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
});

test('unlinked print: chooser; "Start on <printer>" before the print starts turns it into a confirm; Take off printer brings the chooser back', async ({
	page
}) => {
	test.setTimeout(150_000);
	const SHOTS_EXP = process.env.EXPECTED_SHOTS ?? 'data/shots-expected';
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'confirmprint');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Confirm Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	const idle = () => mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	idle();
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');

	// 1. Printing, nothing sent from here: the plain chooser, never a guess.
	mock.printing('benchy.gcode', 8);
	await expect(page.getByTestId('link-plate')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);
	expect(await page.getByTestId('printer-live').count()).toBe(0);
	idle();
	await expect(page.getByTestId('unlinked-job')).toBeHidden({ timeout: 20_000 });

	// 2. "Start on <printer>" first, then the printer starts a file with no plate in its name.
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	// Wait for the server to have recorded the suggestion: leaving the page would cancel the request.
	const expectSent = page.waitForResponse(
		(r) => /\/api\/printers\/[^/]+\/expect$/.test(r.url()) && r.request().method() === 'POST'
	);
	// With a printer connected, choosing Printing asks where; the first printer is preselected.
	const badge = page.locator('.group-head').getByTestId('plate-status').first();
	await expect(page.getByTestId('start-on-printer')).toHaveCount(0);
	await chooseStatus(badge, 'Printing');
	const dlg = page.getByTestId('where-printing');
	await expect(dlg).toBeVisible();
	await expect(dlg).toContainText('Confirm Centauri');
	await expect(dlg).toContainText('Not on a connected printer');
	await expect(dlg).toContainText('never sends a print');
	await expect(dlg.locator('input[type="radio"]').first()).toBeChecked();
	await dlg.getByTestId('where-confirm').click();
	expect((await expectSent).ok()).toBe(true);
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	mock.printing('ECC_0.4_tmt_4691_Overture PETG HF_0.2_11h1m.gcode', 5);
	const ask = page.getByTestId('expected-confirm');
	await expect(ask).toBeVisible({ timeout: 20_000 });
	await expect(ask).toContainText(/Confirm Plate \d+/);
	await expect(ask).toContainText('is printing on Confirm Centauri?');
	await expect(page.getByTestId('link-plate')).toHaveCount(0);
	expect(await page.getByTestId('printer-live').count()).toBe(0);
	await page.screenshot({ path: `${SHOTS_EXP}/confirm-390.png` });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `${SHOTS_EXP}/confirm-1440.png` });
	await page.setViewportSize({ width: 390, height: 844 });
	await ask.getByTestId('expected-confirm-go').click();
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 15_000 });
	await expect(ask).toBeHidden();

	// 3. Take off printer: the running job is unlinked and the chooser is back, no navigation.
	await chooseStatus(page.getByTestId('now-card').getByTestId('plate-status').first(), 'To print');
	await expect(page.getByTestId('link-plate')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('printer-live')).toHaveCount(0);
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);
	idle();
});

test('"Where is it printing?" with a print already running links it to the plate at once; no confirm', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'onestep');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Onestep Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	const printerId = ((await created.json()).printer as { id: string }).id;
	const idle = () => mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	idle();
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');

	// The printer is already running a file the app cannot match to a plate: an unlinked job.
	mock.printing('benchy.gcode', 8);
	await expect(page.getByTestId('link-plate')).toBeVisible({ timeout: 20_000 });
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	const badge = page.locator('.group-head').getByTestId('plate-status').first();
	await chooseStatus(badge, 'Printing');
	const dlg = page.getByTestId('where-printing');
	await expect(dlg).toBeVisible();
	// The dialog says what the printer is printing now.
	await expect(dlg.getByTestId(`where-job-${printerId}`)).toContainText(
		'Printing now: benchy.gcode'
	);
	await dlg.getByTestId('where-confirm').click();
	await expect(dlg).toBeHidden();

	// One step: the job is linked straight away, a toast says so, and no confirmation follows.
	const toast = page
		.locator('.toasts')
		.filter({ hasText: /Linked Onestep Centauri.s print to plate \d+/ });
	await expect(toast).toBeVisible({ timeout: 15_000 });
	const plate = Number((await toast.innerText()).match(/plate (\d+)/)![1]);
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(
					(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
						jobs: { buildId: string | null; plateNumber: number | null; fileName: string }[];
					}
				).jobs.find((j) => j.fileName === 'benchy.gcode')?.plateNumber,
			{ timeout: 15_000 }
		)
		.toBe(plate);
	await page.goto(`/builds/${buildId}`);
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);

	// The Printers page lists the job as linked to that plate.
	await page.goto(`${chapterUrl}/printers`);
	const row = page.getByTestId('job-list').locator('li').filter({ hasText: 'benchy.gcode' });
	await expect(row.getByRole('link', { name: `Plate ${plate}` })).toBeVisible({ timeout: 15_000 });
	await expect(row).not.toContainText('Not linked to a plate');
	idle();
});

test('Printers page: a running unlinked job can be linked there; Stop monitoring says what it does', async ({
	page
}) => {
	test.setTimeout(150_000);
	const SHOTS_PP = process.env.STAGE2_SHOTS ?? 'data/shots-stage2';
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'pagelink');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Page Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	await page.goto(`${chapterUrl}/printers`);
	await page.waitForLoadState('networkidle');

	// A file with no plate number in its name: listed unlinked, with the link control right here.
	mock.printing('benchy.gcode', 8);
	const row = page.getByTestId('job-list').getByTestId('job-link');
	await expect(row).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('job-list')).toContainText('Not linked to a plate');
	const choose = row.getByTestId('link-plate');
	await expect(choose).toBeVisible({ timeout: 15_000 });
	await page.screenshot({ path: `${SHOTS_PP}/printers-unlinked-390-light.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.screenshot({ path: `${SHOTS_PP}/printers-unlinked-390-dark.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `${SHOTS_PP}/printers-unlinked-1440-light.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.screenshot({ path: `${SHOTS_PP}/printers-unlinked-1440-dark.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.setViewportSize({ width: 390, height: 844 });
	await choose.selectOption({ index: 1 });
	await expect(page.getByTestId('job-list').getByRole('link', { name: /^Plate \d+/ })).toBeVisible({
		timeout: 15_000
	});
	const view = await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json();
	expect(view.jobs.some((j: { buildId: string }) => j.buildId === buildId)).toBe(true);

	// Monitoring wording: the print is not paused, only the app stops watching.
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	await gotoIntegrations(page, chapterUrl);
	await page.getByRole('button', { name: 'Stop monitoring' }).click();
	await expect(page.getByTestId('row-state')).toHaveText('Monitoring stopped');
	await page.screenshot({ path: `${SHOTS_PP}/printer-monitoring-stopped-390-light.png` });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.screenshot({ path: `${SHOTS_PP}/printer-monitoring-stopped-390-dark.png` });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `${SHOTS_PP}/printer-monitoring-stopped-1440-dark.png` });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.screenshot({ path: `${SHOTS_PP}/printer-monitoring-stopped-1440-light.png` });
	await expect(page.getByRole('button', { name: 'Resume monitoring' })).toBeVisible();
	await page.getByRole('button', { name: 'Resume monitoring' }).click();
	await expect(page.getByRole('button', { name: 'Stop monitoring' })).toBeVisible();
});

test('status badge: Printing asks where (printer links, "Not on a connected printer" does not), part badge too; no printers, no dialog', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'badgewhere');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	const heads = page.locator('.group-head').getByTestId('plate-status');
	const expects: string[] = [];
	page.on('request', (r) => {
		if (/\/api\/printers\/[^/]+\/expect$/.test(r.url()) && r.method() === 'POST')
			expects.push(r.url());
	});

	// No enabled printer: no dialog, marked directly.
	await chooseStatus(heads.first(), 'Printing');
	await expect(heads.first()).toHaveAttribute('data-status', 'Printing');
	await expect(page.getByTestId('where-printing')).toHaveCount(0);
	// Back to To print through the menu (take off).
	await chooseStatus(heads.first(), 'To print');
	await expect(heads.first()).toHaveAttribute('data-status', 'To print');

	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Badge Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	const printerId = ((await created.json()) as { id?: string }).id;
	await page.reload();
	await page.waitForLoadState('networkidle');

	// Not on a connected printer: marked printing, nothing linked.
	await heads.first().click();
	await page.getByTestId('status-option-Printing').click();
	const dlg = page.getByTestId('where-printing');
	await expect(dlg).toBeVisible();
	await expect(dlg.getByTestId('where-none')).toBeVisible();
	if (printerId) await expect(dlg.getByTestId(`where-printer-${printerId}`)).toBeChecked();
	await dlg.getByTestId('where-none').check();
	await dlg.getByTestId('where-confirm').click();
	await expect(dlg).toBeHidden();
	await expect(heads.first()).toHaveAttribute('data-status', 'Printing');
	expect(expects).toHaveLength(0);
	// Focus is back on the badge that opened the dialog.
	await expect(heads.first()).toBeFocused();

	// Cancel changes nothing.
	const second = heads.nth(1);
	await second.click();
	await page.getByTestId('status-option-Printing').click();
	await page.getByTestId('where-printing').getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByTestId('where-printing')).toBeHidden();
	await expect(second).toHaveAttribute('data-status', 'To print');

	// A part badge: Printing asks too; confirming with the printer links it.
	const todo = page.locator('.row[data-s="To print"]').first();
	const slug = (await todo.getAttribute('data-id')) as string;
	const sent = page.waitForResponse(
		(r) => /\/api\/printers\/[^/]+\/expect$/.test(r.url()) && r.request().method() === 'POST'
	);
	await chooseStatus(todo.getByTestId('part-status'), 'Printing');
	await expect(page.getByTestId('where-printing')).toBeVisible();
	await page.getByTestId('where-confirm').click();
	expect((await sent).ok()).toBe(true);
	await expect(page.locator(`.row[data-id="${slug}"]`)).toHaveAttribute('data-s', 'Printing');
});
