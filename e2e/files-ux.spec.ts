import { expect, test } from './fixtures';
import { arrangeForCentauri, createBuild, createChapter, signUp, uniqueEmail } from './helpers';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';

const SHOTS = 'data/shots-files';

const sliced = () =>
	makeProjectThreeMf({
		sliced: true,
		app: 'ElegooSlicer-1.0.0',
		printerModel: 'Elegoo Centauri Carbon',
		printerSettingsId: 'Elegoo Centauri Carbon 0.4 nozzle',
		filamentTypes: ['PETG', 'TPU'],
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

test('own sliced file: visible button, select option and drop all open the upload in view', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await signUp(page, 'Fiona Files', uniqueEmail('files'));
	const id = await createBuild(page, 'Files chair');
	await page.goto(`/builds/${id}/files`);
	await page.waitForLoadState('networkidle');

	// No printer yet: choosing Arrange shows the bed picker expanded; the sliced-file card is on top.
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await expect(page.getByTestId('bed-picker')).toBeVisible();
	await page.getByTestId('use-own-sliced').click();
	const dlg = page.getByRole('dialog', { name: 'Use my own sliced file' });
	await expect(dlg).toBeInViewport();
	await dlg.getByTestId('3mf-file').setInputFiles({
		name: 'my chair.3mf',
		mimeType: 'model/3mf',
		buffer: Buffer.from(sliced())
	});
	await expect(dlg.getByText('Elegoo Centauri Carbon')).toBeVisible();
	await dlg.getByTestId('apply-upload').click();
	await expect(page.getByRole('status').filter({ hasText: 'Plates organized' })).toBeVisible();
	await expect(page.getByTestId('layout-name')).toHaveText('Your uploaded 3MF');

	// Opening the Files tab in-app with a slow layouts answer: the heading comes from the plates at
	// once (never the default profile), the select waits disabled, and only one request is made.
	const layoutsUrl = /\/plates\/layouts/;
	let layoutRequests = 0;
	const gate = Promise.withResolvers<void>();
	const slowLayouts = async (route: import('@playwright/test').Route) => {
		layoutRequests++;
		await new Promise((r) => setTimeout(r, 2000));
		await route.continue();
		gate.resolve();
	};
	await page.route(layoutsUrl, slowLayouts);
	try {
		await page.goto(`/builds/${id}`);
		await page.waitForLoadState('networkidle');
		layoutRequests = 0;
		await page.getByRole('link', { name: 'Files', exact: true }).first().click();
		await expect(page).toHaveURL(/\/files$/);
		await expect(page.getByTestId('layout-name')).toHaveText('Your uploaded 3MF');
		await expect(page.getByTestId('plate-layout')).toBeDisabled();
		await expect(page.getByTestId('layout-name')).not.toHaveText('MakeGood profile');
		await expect(page.getByTestId('plate-layout')).toBeEnabled({ timeout: 10_000 });
		await gate.promise;
		await expect(page.getByTestId('layout-name')).toHaveText('Your uploaded 3MF');
		await expect(page.getByTestId('plate-layout').locator('option:checked')).toHaveText(
			'Your uploaded 3MF'
		);
		expect(layoutRequests).toBe(1);
	} finally {
		await page.unroute(layoutsUrl, slowLayouts);
	}

	// The select option opens the same dialog, in view.
	await page.getByTestId('plate-layout').selectOption({ label: 'Use my own sliced file…' });
	await expect(dlg).toBeInViewport();
	await dlg.getByRole('button', { name: 'Cancel' }).click();
	await expect(dlg).toBeHidden();

	// Dropping a 3MF anywhere shows the overlay, then the upload.
	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.items.add(new File(['x'], 'dropped.3mf'));
		window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, cancelable: true }));
	});
	await expect(page.getByTestId('sliced-drop-overlay')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/drop-overlay-390.png` });
	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.items.add(new File(['x'], 'dropped.3mf'));
		window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
	});
	await expect(page.getByRole('dialog', { name: 'Use my own sliced file' })).toBeVisible();
});

test('upload sheet is a real modal: focus in, Tab trapped, Escape closes, focus restored', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1280, height: 800 });
	await signUp(page, 'Mona Modal', uniqueEmail('modal'));
	const id = await createBuild(page, 'Modal chair');
	await page.goto(`/builds/${id}/files`);
	await page.waitForLoadState('networkidle');

	const opener = page.getByTestId('use-own-sliced');
	await opener.click();
	const dlg = page.getByRole('dialog', { name: 'Use my own sliced file' });
	await expect(dlg).toBeVisible();
	// focus moved into the dialog
	await expect(dlg.locator(':focus')).toHaveCount(1);
	// Tab and Shift+Tab never reach the page behind: a native modal dialog may hand focus to the
	// browser chrome at its ends, but the page is inert, so focus is inside the dialog or nowhere
	const behind = () =>
		page.evaluate(() => {
			const a = document.activeElement;
			return !!a && a !== document.body && !a.closest('dialog[open]');
		});
	for (let i = 0; i < 6; i++) {
		await page.keyboard.press('Tab');
		expect(await behind()).toBe(false);
	}
	for (let i = 0; i < 6; i++) {
		await page.keyboard.press('Shift+Tab');
		expect(await behind()).toBe(false);
	}
	// back inside the dialog before Escape
	await dlg.getByRole('button', { name: 'Cancel' }).first().focus();
	await page.keyboard.press('Escape');
	await expect(dlg).toBeHidden();
	await expect(page.getByTestId('use-own-sliced')).toBeFocused();
});

test('compact printer summary, switching layouts asks first, printers from other workspaces', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await signUp(page, 'Cara Compact', uniqueEmail('compact'));
	const id = await createBuild(page, 'Compact chair');

	// A printer in a chapter, not in this (personal) workspace.
	await createChapter(page, `Compact chapter ${Date.now().toString(36)}`);
	const orgs = (await (await page.request.get('/api/auth/organization/list')).json()) as {
		id: string;
		metadata?: { personal?: boolean } | string;
	}[];
	const chapter = orgs.find((o) => !/personal/.test(JSON.stringify(o.metadata ?? '')))!;
	const add = await page.request.post('/api/printers', {
		data: {
			organizationId: chapter.id,
			name: 'CC1',
			kind: 'moonraker',
			host: '127.0.0.1',
			port: 7125,
			catalogId: 'elegoo-centauri-carbon'
		}
	});
	expect(add.ok()).toBe(true);
	const mine = await (await page.request.get(`/api/printers/mine`)).json();
	expect(JSON.stringify(mine)).not.toMatch(/secretEnc|accessCode|apiKey/);
	expect(mine.workspaces.length).toBeGreaterThanOrEqual(2);

	await page.goto(`/builds/${id}/files`);
	await page.waitForLoadState('networkidle');
	// The nav keeps pointing at the workspace that has printers.
	await expect(page.getByTestId('nav-printers')).toHaveAttribute('href', /\/printers$/);

	// Dropdown shows the chapter's printer although the build is in "My builds".
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	const sel = page.getByTestId('team-printer');
	await expect(page.getByTestId('team-printer-group').first()).toHaveAttribute('label', /.+/);
	await sel.selectOption({ label: 'CC1 · Elegoo Centauri Carbon · 256 × 256' });
	await expect(page.getByTestId('printer-model')).toHaveValue('elegoo-centauri-carbon');
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for CC1');

	// Compact summary; the picker is collapsed until asked.
	await expect(page.getByTestId('printer-summary-text')).toContainText(
		'CC1 · Elegoo Centauri Carbon'
	);
	await expect(page.getByTestId('printer-summary-text')).toContainText('256 × 256 × 256');
	await expect(page.getByTestId('bed-picker')).toHaveCount(0);
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({ path: `${SHOTS}/compact-390.png` });
	await page.getByTestId('change-bed').click();
	await expect(page.getByTestId('bed-picker')).toBeVisible();
	await page.getByTestId('hide-bed').click();
	await expect(page.getByTestId('bed-picker')).toHaveCount(0);

	// Switching to a MakeGood profile asks first; Cancel keeps the arrangement.
	await page.getByTestId('plate-layout').selectOption({ label: 'Bambu H2D / H2S (21 plates)' });
	await expect(page.getByTestId('layout-confirm')).toContainText('Replace your');
	// the safe choice (Cancel) has focus, not the destructive one
	await expect(page.getByTestId('layout-confirm-cancel')).toBeFocused();
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for CC1');
	await page.getByTestId('layout-confirm-cancel').click();
	await expect(page.getByTestId('plate-layout')).toBeFocused();
	await expect(page.getByTestId('layout-confirm')).toHaveCount(0);
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for CC1');
	await page.getByTestId('plate-layout').selectOption({ label: 'Bambu H2D / H2S (21 plates)' });
	await page.getByTestId('layout-confirm-yes').click();
	await expect(page.getByTestId('layout-name')).toHaveText("MakeGood's Bambu H2D / H2S profile");
});

test('Files tab screenshots: no printer (expanded) and printer set (compact)', async ({ page }) => {
	test.setTimeout(150_000);
	await signUp(page, 'Shot Maker', uniqueEmail('fshots'));
	const id = await createBuild(page, 'Shots chair');
	for (const set of [false, true]) {
		if (set) {
			await page.goto(`/builds/${id}/files`);
			await page.waitForLoadState('networkidle');
			await arrangeForCentauri(page);
			await expect(page.getByTestId('bed-compact')).toBeVisible();
		}
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			for (const [w, h] of [
				[390, 844],
				[1440, 900]
			] as const) {
				await page.setViewportSize({ width: w, height: h });
				await page.goto(`/builds/${id}/files`);
				await page.waitForLoadState('networkidle');
				if (!set)
					await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.screenshot({
					path: `${SHOTS}/${set ? 'printer' : 'noprinter'}-${w}-${scheme}.png`
				});
				if (set) {
					await page.evaluate(() => {
						const dt = new DataTransfer();
						dt.items.add(new File(['x'], 'a.3mf'));
						window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, cancelable: true }));
					});
					await page.screenshot({ path: `${SHOTS}/drop-${w}-${scheme}.png` });
				}
			}
		}
	}
	await page.emulateMedia({ colorScheme: 'light' });
});
