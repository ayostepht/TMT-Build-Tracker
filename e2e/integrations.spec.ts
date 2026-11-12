import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';
import { gotoIntegrations } from './integrations-helpers';

/**
 * r49 phase 2: the Integrations page. Link printers are saved DISABLED and never tested: the suite
 * runs on a self-hosted server with real DNS, and a link is a made-up name that must never be
 * looked up or dialled. The hosted-site rendering (disabled cards, hosted note, Spoolman card)
 * follows `available` and `hosted` from the options; it is unit-tested in
 * src/lib/printers/integrations-view.test.ts because one e2e server runs in one mode.
 */
const LINK = 'https://shared-e2eintegr12345678.octoeverywhere.com';

const CARDS = [
	'elegoo-lan',
	'klipper-lan',
	'octoprint-lan',
	'bambu-lan',
	'octoeverywhere',
	'manual'
];

test('the chooser renders every option from the options endpoint with its two labels', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'ig-chooser');
	const opts = (await (await page.request.get('/api/printers/options')).json()) as {
		hosted: boolean;
		connectionOptions: {
			key: string;
			group: string;
			hosted: boolean;
			verifiedOnHardware: boolean;
			available: boolean;
		}[];
	};
	await gotoIntegrations(page, chapterUrl);
	// No printers yet: a plain line, and no hosted note on a self-hosted server.
	await expect(page.getByTestId('printers-none')).toBeVisible();
	await expect(page.getByTestId('hosted-note')).toHaveCount(0);
	await page.getByTestId('add-printer').click();
	const chooser = page.getByTestId('printer-chooser');
	await expect(chooser).toBeVisible();
	await expect(chooser.getByRole('heading', { level: 4 })).toHaveText([
		'On your network',
		'Through OctoEverywhere',
		'Not connected'
	]);
	for (const id of CARDS) await expect(page.getByTestId(`option-${id}`)).toBeVisible();
	await expect(chooser.locator('button[data-testid^="option-"]')).toHaveCount(CARDS.length);

	// The labels follow the data.
	for (const o of opts.connectionOptions.filter((x) => x.group === 'lan' || x.group === 'manual')) {
		const card = page.getByTestId(`option-${o.key}`);
		await expect(card.getByTestId('hosted-label')).toHaveText(
			o.hosted ? 'Works on a hosted site' : 'Needs the app on your own network'
		);
		if (o.group === 'manual') await expect(card.getByTestId('verified-label')).toHaveCount(0);
		else
			await expect(card.getByTestId('verified-label')).toHaveText(
				o.verifiedOnHardware ? 'In regular use' : 'New: not yet run on a real printer'
			);
		await expect(card).toBeEnabled();
	}
	const link = page.getByTestId('option-octoeverywhere');
	await expect(link.getByTestId('hosted-label')).toHaveText('Works on a hosted site');
	await expect(link.getByTestId('verified-label')).toHaveText(
		'In regular use with Elegoo; new for Klipper and OctoPrint'
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.getByRole('button', { name: 'Cancel' }).first().click();
	await expect(chooser).toHaveCount(0);
});

test('choosing an option shows only its fields and its setup steps', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'ig-forms');
	await gotoIntegrations(page, chapterUrl);
	const has = async (...ids: string[]) => {
		for (const id of ids) await expect(page.getByTestId(id), id).toHaveCount(1);
	};
	const hasNot = async (...ids: string[]) => {
		for (const id of ids) await expect(page.getByTestId(id), id).toHaveCount(0);
	};
	const steps = async (guide: RegExp) => {
		const n = await page.getByTestId('pf-steps').locator('li').count();
		expect(n).toBeGreaterThanOrEqual(3);
		expect(n).toBeLessThanOrEqual(5);
		await expect(page.getByTestId('pf-guide')).toHaveAttribute(
			'href',
			/^https:\/\/github\.com\/.+\/docs\/guides\/printers\.md#/
		);
		await expect(page.getByTestId('pf-guide')).toHaveAttribute('href', guide);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			390
		);
	};
	const open = async (id: string) => {
		await page.getByTestId('add-printer').click();
		await page.getByTestId(`option-${id}`).click();
		await expect(page.getByTestId('printer-form')).toBeVisible();
	};
	const cancel = async () => {
		await page.getByTestId('printer-form').getByRole('button', { name: 'Cancel' }).click();
		await page.getByTestId('printer-chooser').getByRole('button', { name: 'Cancel' }).click();
	};

	await open('elegoo-lan');
	await has('pf-host', 'pf-port', 'pf-mainboardId', 'pf-discover', 'pf-test', 'pf-camera-url');
	await hasNot('pf-shareLink', 'pf-kind', 'pf-link-type', 'pf-apiKey', 'pf-accessCode');
	await steps(/#elegoo-sdcp$/);
	await page.screenshot({
		path: 'data/r49-shots-integrations/form-elegoo-390-light.png',
		fullPage: true
	});
	await cancel();

	await open('klipper-lan');
	await has('pf-host', 'pf-port', 'pf-apiKey', 'pf-camera-url');
	await hasNot('pf-shareLink', 'pf-mainboardId', 'pf-discover', 'pf-accessCode');
	await expect(page.getByTestId('pf-apiKey')).not.toHaveAttribute('required', '');
	await steps(/#klipper-moonraker$/);
	await page.screenshot({
		path: 'data/r49-shots-integrations/form-klipper-390-light.png',
		fullPage: true
	});
	await cancel();

	await open('octoprint-lan');
	await has('pf-host', 'pf-port', 'pf-apiKey');
	await expect(page.getByTestId('pf-apiKey')).toHaveAttribute('required', '');
	await hasNot('pf-shareLink', 'pf-discover');
	await steps(/#octoprint$/);
	await page.screenshot({
		path: 'data/r49-shots-integrations/form-octoprint-390-light.png',
		fullPage: true
	});
	await cancel();

	await open('bambu-lan');
	await has('pf-host', 'pf-accessCode', 'pf-serial', 'pf-camera-unsupported');
	await hasNot('pf-camera-url', 'pf-shareLink', 'pf-apiKey', 'pf-discover', 'pf-link-type');
	await steps(/#bambu-lab-lan-mode$/);
	await page.screenshot({
		path: 'data/r49-shots-integrations/form-bambu-390-light.png',
		fullPage: true
	});
	await cancel();

	// OctoEverywhere: one card, a "Printer type" select inside, no address or port.
	await open('octoeverywhere');
	const type = page.getByTestId('pf-link-type');
	await expect(type.locator('option')).toHaveText(['Elegoo', 'Klipper', 'OctoPrint']);
	await has('pf-shareLink', 'pf-camera-via-link');
	await hasNot('pf-host', 'pf-port', 'pf-camera-url', 'pf-discover', 'pf-apiKey', 'pf-mainboardId');
	await expect(page.getByTestId('pf-shareLink')).toHaveAttribute('required', '');
	await steps(/#through-an-octoeverywhere-shared-link$/);
	await page.screenshot({
		path: 'data/r49-shots-integrations/form-octoeverywhere-elegoo-390-light.png',
		fullPage: true
	});
	await type.selectOption({ label: 'Klipper' });
	await has('pf-shareLink', 'pf-apiKey');
	await expect(page.getByTestId('pf-apiKey')).not.toHaveAttribute('required', '');
	await steps(/#klipper-moonraker-through-an-octoeverywhere-shared-link$/);
	await page.screenshot({
		path: 'data/r49-shots-integrations/form-octoeverywhere-klipper-390-light.png',
		fullPage: true
	});
	await type.selectOption({ label: 'OctoPrint' });
	await expect(page.getByTestId('pf-apiKey')).toHaveAttribute('required', '');
	await steps(/#octoprint-through-an-octoeverywhere-shared-link$/);
	await hasNot('pf-host');
	await cancel();

	await open('manual');
	await hasNot(
		'pf-host',
		'pf-port',
		'pf-test',
		'pf-camera',
		'pf-shareLink',
		'pf-apiKey',
		'pf-kind',
		'pf-enabled'
	);
	await expect(page.getByLabel('Model (optional)')).toBeVisible();
	await steps(/#a-printer-that-is-not-connected$/);
	await page.screenshot({
		path: 'data/r49-shots-integrations/form-manual-390-light.png',
		fullPage: true
	});
	await cancel();
});

test('a link printer of each type and a manual printer are created through the UI', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'ig-create');
	await gotoIntegrations(page, chapterUrl);

	// Automatic logging needs a connected printer: until then, one muted line.
	await expect(page.getByTestId('autolog-hint')).toBeVisible();
	await expect(page.getByTestId('autolog')).toHaveCount(0);

	// Manual printer: a name is enough.
	await page.getByTestId('add-printer').click();
	await page.getByTestId('option-manual').click();
	await page.getByLabel('Name', { exact: true }).fill('Garage printer');
	await page.getByTestId('pf-save').click();
	const rows = page.getByTestId('printer-row');
	await expect(rows).toHaveCount(1);
	await expect(rows.first().getByTestId('row-connection')).toHaveText('Not connected');
	await expect(rows.first().getByTestId('row-state')).toHaveText('Logged by hand');
	await expect(rows.first().getByTestId('toggle-printer')).toHaveCount(0);
	await expect(page.getByTestId('autolog-hint')).toBeVisible(); // still no connected printer

	// One link printer per type, saved disabled (never dialled).
	for (const [type, name, key] of [
		['Elegoo', 'Link Elegoo', ''],
		['Klipper', 'Link Klipper', 'KEY'],
		['OctoPrint', 'Link OctoPrint', 'KEY']
	]) {
		await page.getByTestId('add-printer').click();
		await page.getByTestId('option-octoeverywhere').click();
		await page.getByTestId('pf-link-type').selectOption({ label: type });
		await page.getByLabel('Name', { exact: true }).fill(name);
		await page.getByTestId('pf-shareLink').fill(LINK);
		if (key) await page.getByTestId('pf-apiKey').fill(key);
		await page.getByTestId('pf-enabled').uncheck();
		await page.getByTestId('pf-save').click();
		await expect(page.getByTestId('printer-form')).toHaveCount(0);
		await expect(rows.filter({ hasText: name })).toContainText(`${type} · OctoEverywhere link`);
		await expect(rows.filter({ hasText: name }).getByTestId('row-state')).toHaveText(
			'Monitoring stopped'
		);
	}
	await expect(rows).toHaveCount(4);
	// A connected printer exists now: the setting appears.
	await expect(page.getByTestId('autolog')).toBeVisible();
	await expect(page.getByTestId('autolog-hint')).toHaveCount(0);

	// Secrets are never rendered back or returned.
	const org = (
		(await (await page.request.get('/api/auth/organization/list')).json()) as {
			id: string;
			metadata?: { personal?: boolean };
		}[]
	).find((o) => !o.metadata?.personal)!.id;
	const raw = await (await page.request.get(`/api/printers?org=${org}`)).text();
	expect(raw).not.toMatch(/shared-|octoeverywhere\.com|KEY/);
	await page.getByTestId('edit-printer').nth(1).click();
	await expect(page.getByTestId('pf-shareLink')).toHaveValue('');
	await expect(page.getByTestId('pf-shareLink')).toHaveAttribute('placeholder', /Saved/);
	await expect(page.getByTestId('pf-link-type')).toHaveCount(0); // the printer type is fixed once saved
	expect(await page.content()).not.toContain('e2eintegr');
	await page.getByTestId('printer-form').getByRole('button', { name: 'Cancel' }).click();

	// The Printers view: no add form, a Manage link per card, the manual printer is neutral.
	await page.goto(`${chapterUrl}/printers`);
	await expect(page.getByTestId('printer-card')).toHaveCount(4);
	await expect(page.getByTestId('add-printer')).toHaveCount(0);
	await expect(page.getByTestId('printer-form')).toHaveCount(0);
	await expect(page.getByTestId('printer-manage')).toHaveCount(4);
	const manual = page.getByTestId('printer-card').filter({ hasText: 'Garage printer' });
	await expect(manual.getByTestId('printer-state')).toHaveText('Not connected');
	await expect(manual.getByTestId('printer-manual')).toBeVisible();
	await expect(manual.getByTestId('printer-progress')).toHaveCount(0);
	await expect(manual).not.toContainText(/offline|connecting/i);
	await expect(manual.getByTestId('printer-state')).not.toHaveClass(/ds-badge--(bad|warn)/);
	await page.getByTestId('printers-manage').click();
	await expect(page).toHaveURL(/\/integrations$/);

	// Remove through the shared dialog.
	await page.getByTestId('remove-printer').first().click();
	await page.getByTestId('ask-confirm').click();
	await expect(rows).toHaveCount(3);
});

test('a viewer sees the printers but no add, edit or remove controls', async ({
	page,
	browser
}) => {
	test.setTimeout(120_000);
	const { chapterUrl } = await ownerWithBuild(page, 'ig-viewer');
	await gotoIntegrations(page, chapterUrl);
	await page.getByTestId('add-printer').click();
	await page.getByTestId('option-manual').click();
	await page.getByLabel('Name', { exact: true }).fill('Garage printer');
	await page.getByTestId('pf-save').click();
	await expect(page.getByTestId('printer-row')).toHaveCount(1);
	await page.goto(chapterUrl);
	const viewerEmail = uniqueEmail('ig-viewer');
	const link = await invite(page, viewerEmail, 'viewer');
	const { context, page: v } = await joinViaInvite(browser, link, 'Vera Viewer', viewerEmail);
	await v.goto(`${new URL(chapterUrl).pathname}/integrations`);
	await expect(v.getByTestId('printer-row')).toHaveCount(1);
	await expect(v.getByTestId('printer-row')).toContainText('Garage printer');
	for (const id of ['add-printer', 'edit-printer', 'remove-printer', 'toggle-printer'])
		await expect(v.getByTestId(id), id).toHaveCount(0);
	await v.goto(`${new URL(chapterUrl).pathname}/printers`);
	await expect(v.getByTestId('printer-card')).toHaveCount(1);
	await expect(v.getByTestId('printer-manage')).toHaveCount(0);
	await expect(v.getByTestId('printers-manage')).toHaveCount(0);
	await context.close();
});

test('the Printers view: empty state with a way to Integrations; viewers are told to ask', async ({
	page,
	browser
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'ig-empty');
	await page.goto(`${chapterUrl}/printers`);
	await expect(page.getByTestId('printers-empty')).toContainText('No printers yet.');
	await expect(page.getByTestId('printers-manage')).toHaveText('Add or manage printers');
	await expect(page.getByTestId('add-printer')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.screenshot({
		path: 'data/r49-shots-integrations/printers-empty-390-light.png',
		fullPage: true
	});
	await page.goto(chapterUrl);
	const viewerEmail = uniqueEmail('ig-empty');
	const link = await invite(page, viewerEmail, 'viewer');
	const { context, page: v } = await joinViaInvite(browser, link, 'Vera', viewerEmail);
	await v.goto(`${new URL(chapterUrl).pathname}/printers`);
	await expect(v.getByTestId('printers-empty')).toContainText('Ask a chapter owner or editor');
	await expect(v.getByTestId('printers-manage')).toHaveCount(0);
	await context.close();
});

test('the Spoolman card: steps, own-network label, address field; no overflow at 390', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'ig-spoolman');
	await gotoIntegrations(page, chapterUrl);
	const card = page.getByTestId('team-spoolman');
	await expect(card.getByTestId('spoolman-hosted-label')).toHaveText(
		'Needs the app on your own network'
	);
	await expect(card.getByTestId('spoolman-steps').locator('li')).toHaveCount(3);
	await expect(card.getByTestId('spoolman-guide')).toHaveAttribute(
		'href',
		/printers\.md#spoolman-and-automatic-logging$/
	);
	await expect(card.getByTestId('spoolman-url')).toBeVisible();
	await expect(card.getByTestId('spoolman-deduct')).toBeDisabled();
	await expect(page.getByTestId('integrations-unavailable')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await card.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: 'data/r49-shots-integrations/spoolman-390-light.png',
		fullPage: true
	});
});
