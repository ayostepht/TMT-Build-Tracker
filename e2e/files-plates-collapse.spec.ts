import { expect, test } from './fixtures';
import { arrangeForCentauri, ownerWithBuild } from './helpers';

// Screenshots land in a gitignored folder.
const SHOTS = '.playwright-mcp/stage2-plates';

test('Files: printed plates collapse behind a remembered toggle; per-plate export in one tap', async ({
	page
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'collapse');
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
	await arrangeForCentauri(page);
	await expect(page.getByTestId('bed-compact')).toBeVisible();

	// Nothing printed yet: no toggle, per-plate export is there.
	await expect(page.getByTestId('printed-plates-toggle')).toHaveCount(0);
	const allCards = page.locator('section.plate-card');
	const total = await allCards.count();
	expect(total).toBeGreaterThan(3);
	const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);

	// Log every plate but the last as printed (through the API, like the Print tab does).
	const view = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const plates = view.plates as { number: number }[];
	for (const pl of plates.slice(0, -1)) {
		const r = await page.request.post(`/api/builds/${buildId}/runs`, {
			data: {
				plateNumber: pl.number,
				date: '2026-11-03',
				result: 'Success',
				grams: 50,
				hours: 2
			}
		});
		expect(r.ok()).toBeTruthy();
	}
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');

	// Plates that need several runs stay open after one logged run, so count from the toggle.
	const toggle = page.getByTestId('printed-plates-toggle');
	await expect(toggle).toHaveText(/^Show \d+ printed plates$/);
	const n = Number(/\d+/.exec((await toggle.textContent()) ?? '')![0]);
	expect(n).toBeGreaterThan(10);
	await expect(allCards).toHaveCount(plates.length - n);
	await expect(page.getByTestId('plate-row')).toHaveCount(0);
	const heightAfter = await page.evaluate(() => document.documentElement.scrollHeight);
	console.log(`files height: all unprinted ${heightBefore}px, printed collapsed ${heightAfter}px`);
	expect(heightAfter).toBeLessThan(heightBefore);
	await page.screenshot({ path: `${SHOTS}/collapsed-1440-light.png`, fullPage: true });

	// Open: one compact row per printed plate; the choice survives a reload.
	await toggle.click();
	await expect(page.getByTestId('plate-row')).toHaveCount(n);
	await expect(page.getByTestId('plate-row').first()).toContainText('Printed');
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('plate-row')).toHaveCount(n);
	await page.screenshot({ path: `${SHOTS}/rows-1440-light.png`, fullPage: true });

	// Details expands a row into the full card.
	await page
		.getByRole('button', { name: /^Show details for plate/ })
		.first()
		.click();
	await expect(page.getByTestId('plate-row')).toHaveCount(n - 1);
	await expect(allCards).toHaveCount(plates.length - n + 1);

	// Closing remembers per build.
	await page.getByTestId('printed-plates-toggle').click();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('printed-plates-toggle')).toHaveText(`Show ${n} printed plates`);
	await expect(allCards).toHaveCount(plates.length - n);

	// Deep link to a collapsed plate opens it.
	const first = plates[0].number;
	await page.goto(`/builds/${buildId}/files#plate-${first}`);
	await page.waitForLoadState('networkidle');
	await expect(page.locator(`section#plate-${first}`)).toBeVisible();

	// Per-plate export: the slicer choice is remembered and names the plate in the file.
	const lastCard = page.locator('section.plate-card').last();
	const last = Number((await lastCard.getAttribute('id'))!.replace('plate-', ''));
	const btn = lastCard.getByTestId('plate-export-btn');
	await expect(btn).toHaveAttribute(
		'href',
		new RegExp(`flavor=orca.*plates=${last}|plates=${last}`)
	);
	await page.getByTestId('plate-export-format').selectOption('bambu');
	await expect(btn).toHaveAttribute('href', /flavor=bambu/);
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(
		page.locator(`section#plate-${last}`).getByTestId('plate-export-btn')
	).toHaveAttribute('href', /flavor=bambu/);
	await page.goto(`/builds/${buildId}/files`);
	await expect(page.getByTestId('export-flavor')).toHaveValue('bambu');
	await page.screenshot({ path: `${SHOTS}/export-1440-light.png`, fullPage: false });

	// Phone and dark shots.
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.goto(`/builds/${buildId}/files`);
			await page.waitForLoadState('networkidle');
			await page.screenshot({ path: `${SHOTS}/collapsed-${w}-${scheme}.png`, fullPage: true });
			await page.getByTestId('printed-plates-toggle').click();
			await page.getByTestId('printed-plates-toggle').scrollIntoViewIfNeeded();
			await page.evaluate(() => window.scrollBy(0, -70));
			await page.screenshot({ path: `${SHOTS}/rows-${w}-${scheme}.png` });
			await page.getByTestId('printed-plates-toggle').click();
		}
	}

	// No horizontal overflow with the rows open at 360 px.
	await page.setViewportSize({ width: 360, height: 800 });
	await page.goto(`/builds/${buildId}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('printed-plates-toggle').click();
	await expect(page.getByTestId('plate-row').first()).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
});
