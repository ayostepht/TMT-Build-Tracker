import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

const SHOTS = '.playwright-mcp/stage2-design';

// The server's stale rule (arrangement.stale) is covered by printer-arrange / print-template; here the
// Design tab's notice is checked against a stubbed arrangement so no sliced file is needed.
test('design tab: plates-out-of-date notice links to Files and dismisses per change', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'design-stale');
	let stale = false;
	await page.route(`**/api/builds/${buildId}/arrangement`, async (route) => {
		const res = await route.fetch();
		const body = await res.json();
		await route.fulfill({ response: res, json: { ...body, stale } });
	});
	// The notice needs a printer on the build (the same condition Files uses).
	await page.goto(`/builds/${buildId}/files`);
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-pick-printer').click();
	await page.getByTestId('printer-brand').selectOption('Elegoo');
	await page.getByTestId('printer-model').selectOption({ label: 'Centauri Carbon' });
	await page.getByTestId('printer-mm').selectOption({ index: 1 });
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('printer-name')).toBeVisible();

	await page.goto(`/builds/${buildId}/design`);
	await expect(page.getByTestId('design-workspace')).toBeVisible();
	await expect(page.getByTestId('design-stale')).toHaveCount(0);

	stale = true;
	await page.reload();
	const note = page.getByTestId('design-stale');
	await expect(note).toContainText('Plates and export are out of date');
	await page.screenshot({ path: `${SHOTS}/design-stale-${page.viewportSize()?.width}.png` });

	await page.getByTestId('design-stale-dismiss').click();
	await expect(note).toHaveCount(0);

	// A new change brings it back.
	await page.getByRole('tab', { name: 'Parts' }).click();
	await page.locator('[data-testid="part-row"][data-slug="wing-left"]').click();
	await page.getByTestId('part-sheet').locator('button[data-role="primary"]').click();
	await expect(page.getByTestId('design-stale')).toBeVisible();

	await page.getByTestId('design-stale-review').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}/files`));
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('design tab: notice screenshots (phone, desktop; light and dark)', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'design-stale-shots');
	await page.route(`**/api/builds/${buildId}/arrangement`, async (route) => {
		const res = await route.fetch();
		await route.fulfill({ response: res, json: { ...(await res.json()), stale: true } });
	});
	await page.goto(`/builds/${buildId}/files`);
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-pick-printer').click();
	await page.getByTestId('printer-brand').selectOption('Elegoo');
	await page.getByTestId('printer-model').selectOption({ label: 'Centauri Carbon' });
	await page.getByTestId('printer-mm').selectOption({ index: 1 });
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('printer-name')).toBeVisible();
	for (const [w, h] of [
		[360, 800],
		[390, 844],
		[1440, 900]
	]) {
		for (const scheme of ['light', 'dark'] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(`/builds/${buildId}/design`);
			await expect(page.getByTestId('design-stale')).toBeVisible();
			await page.screenshot({ path: `${SHOTS}/design-stale-${w}-${scheme}.png` });
		}
	}
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});
