import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';
import { chooseStatus } from './status-helpers';

// r48 tracking UI: one actionable status badge per plate and part. Touch sizes, no horizontal
// overflow, menu placement, the viewer's plain badge and the shots (invented names only) in
// data/r48-shots-tracking/ (gitignored).
const DIR = 'data/r48-shots-tracking';

test.describe('touch', () => {
	test.use({ hasTouch: true, isMobile: true });

	test('badges and menu items are >= 44px, the menu stays on screen, nothing overflows at 390', async ({
		page
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 390, height: 844 });
		const { buildId } = await ownerWithBuild(page, 'r48touch');
		await page.goto(`/builds/${buildId}/print`);
		await page.waitForLoadState('networkidle');

		const plateBadge = page.locator('.group-head').getByTestId('plate-status').first();
		const partBadge = page.locator('.row').first().getByTestId('part-status');
		for (const b of [plateBadge, partBadge])
			expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		const overflow = () =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
			);
		expect(await overflow()).toBe(true);

		for (const b of [plateBadge, partBadge]) {
			await b.click();
			const menu = page.getByTestId('status-menu');
			await expect(menu).toBeVisible();
			const box = (await menu.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(390);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.y + box.height).toBeLessThanOrEqual(844);
			for (const item of await menu.getByRole('menuitemradio').all())
				expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
			// Not clipped by a card: the point at the menu's centre belongs to the menu.
			const top = await page.evaluate(
				([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="status-menu"]'),
				[box.x + box.width / 2, box.y + box.height / 2]
			);
			expect(top).toBe(true);
			expect(await overflow()).toBe(true);
			await page.keyboard.press('Escape');
			await expect(menu).toBeHidden();
		}
		// Outside tap closes the menu.
		await plateBadge.click();
		await expect(page.getByTestId('status-menu')).toBeVisible();
		await page.mouse.click(5, 400);
		await expect(page.getByTestId('status-menu')).toBeHidden();
	});
});

test('a viewer sees plain badges: no button, no menu', async ({ page, browser }) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'r48viewer');
	const email = uniqueEmail('r48viewer');
	await page.goto(chapterUrl);
	const link = await invite(page, email, 'viewer');
	const viewer = await joinViaInvite(browser, link, 'Vera Viewer', email);
	const vp = viewer.page;
	await vp.goto(`/builds/${buildId}/print`);
	const plate = vp.locator('.group-head').getByTestId('plate-status').first();
	await expect(plate).toBeVisible();
	expect(await plate.evaluate((el) => el.tagName)).toBe('SPAN');
	await expect(plate).toHaveAttribute('data-status', 'To print');
	await expect(vp.getByRole('button', { name: /status:.*Change status/ })).toHaveCount(0);
	await vp.goto(chapterUrl);
	await expect(vp.getByTestId('next-up-card').first().getByTestId('plate-status')).toBeVisible();
	await viewer.context.close();
});

test('shots: Print tab closed / menu open / dialog open, Files plate, landing Next up', async ({
	page
}) => {
	test.setTimeout(300_000);
	const sdcp = new MockSdcp();
	await sdcp.start();
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		const { buildId, chapterUrl } = await ownerWithBuild(page, 'r48shots');
		const org = (
			(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
				organizationId: string;
			}
		).organizationId;
		for (const name of ['Shop CC1', 'Garage CC2']) {
			const r = await page.request.post('/api/printers', {
				data: {
					organizationId: org,
					name,
					kind: 'elegoo-sdcp',
					host: '127.0.0.1',
					port: sdcp.port,
					secrets: { mainboardId: 'ABCDEF' }
				}
			});
			expect(r.ok()).toBe(true);
		}
		sdcp.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });

		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			for (const [w, h] of [
				[390, 844],
				[1440, 900]
			] as const) {
				await page.setViewportSize({ width: w, height: h });
				const tag = `${w}-${scheme}`;
				await page.goto(`/builds/${buildId}/print`);
				await page.waitForLoadState('networkidle');
				const badge = page.locator('.group-head').getByTestId('plate-status').first();
				await expect(badge).toBeVisible();
				await page.screenshot({ path: `${DIR}/print-closed-${tag}.png` });
				await badge.click();
				await expect(page.getByTestId('status-menu')).toBeVisible();
				await page.screenshot({ path: `${DIR}/print-menu-${tag}.png` });
				await page.getByTestId('status-option-Printing').click();
				await expect(page.getByTestId('where-printing')).toBeVisible();
				await page.screenshot({ path: `${DIR}/print-dialog-${tag}.png` });
				await page.getByTestId('where-printing').getByRole('button', { name: 'Cancel' }).click();
				await expect(page.getByTestId('where-printing')).toBeHidden();

				await page.goto(`/builds/${buildId}/files`);
				await page.waitForLoadState('networkidle');
				const card = page.locator('section.plate-card').first();
				if (await card.count()) {
					await card.scrollIntoViewIfNeeded();
					await page.screenshot({ path: `${DIR}/files-plate-${tag}.png` });
				}

				await page.goto(chapterUrl);
				await page.waitForLoadState('networkidle');
				await expect(page.getByTestId('next-up-card').first()).toBeVisible();
				await page.screenshot({ path: `${DIR}/landing-next-${tag}.png`, fullPage: true });
			}
		}

		// Confirming with a printer from the landing card keeps working end to end.
		await page.setViewportSize({ width: 390, height: 844 });
		await chooseStatus(
			page.getByTestId('next-up-card').first().getByTestId('plate-status'),
			'Printing'
		);
		await page.getByTestId('where-confirm').click();
		await expect(page.getByTestId('landing-now-card')).toHaveCount(1);
	} finally {
		await sdcp.stop();
	}
});
