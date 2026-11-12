import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import { gotoIntegrations } from './integrations-helpers';

/** r49 screenshots (not assertions about looks): Integrations and the Printers view, 390/1440, light/dark. */
const DIR = 'data/r49-shots-integrations';
let mock: MockSdcp;
test.beforeAll(async () => {
	mock = new MockSdcp();
	await mock.start();
});
test.afterAll(async () => {
	await mock.stop();
});

test('integrations and printers shots', async ({ page }) => {
	test.setTimeout(240_000);
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'ig-shots');
	const view = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const org: string = view.build.organizationId;

	const shoot = async (name: string, full = true) => {
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const)
			for (const scheme of ['light', 'dark'] as const) {
				await page.setViewportSize({ width: w, height: h });
				await page.emulateMedia({ colorScheme: scheme });
				await page.waitForTimeout(300);
				await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png`, fullPage: full });
			}
		await page.emulateMedia({ colorScheme: 'light' });
	};

	// Empty states first.
	await gotoIntegrations(page, chapterUrl);
	await shoot('integrations-empty');
	await page.goto(`${chapterUrl}/printers`);
	await expect(page.getByTestId('printers-empty')).toBeVisible();
	await shoot('printers-empty');

	// A connected printer (the simulated one) and a manual one.
	const origin = new URL(page.url()).origin;
	const post = (data: unknown) => page.request.post('/api/printers', { data, headers: { origin } });
	expect(
		(
			await post({
				organizationId: org,
				name: 'Shop Centauri',
				kind: 'elegoo-sdcp',
				host: '127.0.0.1',
				port: mock.port,
				secrets: { mainboardId: 'ABCDEF' }
			})
		).ok()
	).toBe(true);
	expect((await post({ organizationId: org, name: 'Garage printer', kind: 'manual' })).ok()).toBe(
		true
	);
	mock.printing('Plate 1.gcode', 42);

	await gotoIntegrations(page, chapterUrl);
	await expect(page.getByTestId('printer-row')).toHaveCount(2);
	await shoot('integrations');
	await page.getByTestId('add-printer').click();
	await expect(page.getByTestId('printer-chooser')).toBeVisible();
	await shoot('chooser');
	await page.getByTestId('option-octoeverywhere').click();
	await expect(page.getByTestId('printer-form')).toBeVisible();
	await shoot('form-octoeverywhere');
	await page.getByRole('button', { name: 'Cancel' }).last().click();
	await page.getByRole('button', { name: 'Cancel' }).first().click();
	await page.getByTestId('team-spoolman').scrollIntoViewIfNeeded();
	await shoot('spoolman', false);

	await page.goto(`${chapterUrl}/printers`);
	await expect(page.getByTestId('printer-card')).toHaveCount(2);
	await expect(
		page
			.getByTestId('printer-card')
			.filter({ hasText: 'Shop Centauri' })
			.getByTestId('printer-state')
	).toHaveText('Printing', { timeout: 20_000 });
	await shoot('printers');
});
