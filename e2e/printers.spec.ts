import { createServer, type Server } from 'node:http';
import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { createBuild, ownerWithBuild, signUp, startBuild, uniqueEmail } from './helpers';

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

	// Printers page and the add form.
	await page.goto(`${chapterUrl}/printers`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Printers', level: 2 })).toBeVisible();
	await page.getByTestId('add-printer').click();
	await page.getByLabel('Name', { exact: true }).fill('Shop Centauri');
	await page.getByTestId('pf-host').fill('127.0.0.1');
	await page.getByTestId('pf-port').fill(String(mock.port));
	await page.getByLabel('Model (optional)').selectOption({ label: 'Centauri Carbon' });

	// Test connection shows a live snapshot (idle printer).
	await page.getByTestId('pf-test').click();
	await expect(page.getByTestId('test-result')).toContainText('Connected', { timeout: 20_000 });
	await expect(page.getByTestId('test-result').getByTestId('printer-state')).toHaveText('Idle');
	await page.getByTestId('pf-save').click();
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
	await page.getByRole('button', { name: 'Dismiss' }).click();
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
	await page.goto(`${chapterUrl}/printers`);
	await page.getByRole('button', { name: 'Remove…' }).click();
	await page.getByRole('button', { name: 'Remove for good' }).click();
	await expect(page.getByTestId('printer-card')).toHaveCount(0);
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

test('plate layout picker lists the workspace printers first and can add a new one', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'picker-printers');

	// No printer yet: only "New printer…" (and a hint). Add one inline from the Files tab.
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	const sel = page.getByTestId('team-printer');
	await expect(sel.locator('option')).toContainText(['No printers added yet', 'New printer…']);
	await sel.selectOption({ label: 'New printer…' });
	const dlg = page.getByTestId('new-printer-dialog');
	await expect(dlg).toBeVisible();
	await dlg.getByLabel('Name', { exact: true }).fill('Bench Centauri');
	await dlg.getByTestId('pf-host').fill('127.0.0.1');
	await dlg.getByTestId('pf-port').fill(String(mock.port));
	await dlg.getByLabel('Model (optional)').selectOption({ label: 'Centauri Carbon' });
	await dlg.getByTestId('pf-save').click();
	await expect(dlg).toBeHidden();
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
	// Phone: the same items live in the account menu and the header never overflows.
	for (const w of [360, 390]) {
		await page.setViewportSize({ width: w, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
		await page.getByTestId('account-menu').click();
		await expect(page.getByRole('menuitem', { name: 'Integrations' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Members' })).toHaveCount(0);
		await page.screenshot({ path: `data/shots-nav/menu-account-${w}-light.png` });
		await page.keyboard.press('Escape');
	}
	await page.setViewportSize({ width: 390, height: 844 });
	const buildId = await createBuild(page, 'Solo chair');

	// From the build, the top nav leads to the printers page.
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	await page.screenshot({ path: `data/shots-nav/nav-390-light.png` });
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

	// A solo maker adds a printer without creating a chapter.
	await page.waitForLoadState('networkidle');
	await page.getByTestId('add-printer').click();
	await page.getByLabel('Name', { exact: true }).fill('Solo Centauri');
	await page.getByTestId('pf-host').fill('127.0.0.1');
	await page.getByTestId('pf-port').fill(String(mock.port));
	await page.getByLabel('Model (optional)').selectOption({ label: 'Centauri Carbon' });
	await page.getByTestId('pf-save').click();
	await expect(page.getByTestId('printer-card').first()).toContainText('Solo Centauri');
	await page.getByRole('link', { name: 'Integrations', exact: true }).click();
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
		await page.locator('.now-card').scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${SHOTS_NOW}/${tag}-${w}.png` });
		const m = await page.evaluate(() => {
			const card = document.querySelector('.now-card')!.getBoundingClientRect();
			const wrap = document.querySelector('.wrap')!;
			const cs = getComputedStyle(wrap);
			const contentW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
			const out: string[] = [];
			for (const el of document.querySelectorAll('.now-card *')) {
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
	await page.locator('.now-card').scrollIntoViewIfNeeded();
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
	await page.getByRole('button', { name: 'Dismiss' }).click();
	await expect(page.getByTestId('confirm-print-log')).toBeHidden();
	await expect.poll(() => state('rims-1-4')).toBe('To print');
	mock.set({ printStatus: 0, machineStatus: [0], file: '' });
});
