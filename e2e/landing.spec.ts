import { expect, newClientContext, test } from './fixtures';
import { createBuild, invite, joinViaInvite, ownerWithBuild, signUp, uniqueEmail } from './helpers';

// Stage 2 landing: Now printing + Next up across the chapter's builds, with the shared start/log
// control. Exit check: starting a plate and logging it done take <= 2 taps each from landing.
import type { Page } from '@playwright/test';

const settled = (page: Page) => page.waitForLoadState('networkidle');
const SHOTS = '.playwright-mcp/stage2b-app-shell';
const SHOTS_4B = '.playwright-mcp/stage4b-app-shell';

test('a new user sees what the app is for and one New build button', async ({ page }) => {
	await signUp(page, 'Nina New', uniqueEmail('landing-empty'));
	await settled(page);
	const empty = page.getByTestId('landing-empty');
	await expect(empty).toContainText('MakeGood 3D TMT');
	await expect(page.getByTestId('new-build')).toHaveCount(1);
	await expect(page.getByText('No builds yet.')).toHaveCount(0);
	await expect(page.getByTestId('landing-now')).toHaveCount(0);
	await page.screenshot({ path: `${SHOTS}/landing-empty-${page.viewportSize()!.width}.png` });
});

test('start a plate in 1 tap and log it done in 2 taps, from the landing', async ({ page }) => {
	const { chapterUrl } = await ownerWithBuild(page, 'landing');
	await page.goto(chapterUrl);
	await settled(page);

	await expect(page.getByTestId('landing-now')).toContainText('Nothing on a printer right now.');
	const next = page.getByTestId('next-up-card').first();
	await expect(next).toBeVisible();
	const plate = await next.getAttribute('data-plate');
	await page.screenshot({ path: `${SHOTS}/landing-next-${page.viewportSize()!.width}.png` });

	// Tap 1: Start printing.
	let taps = 0;
	await next.getByRole('button', { name: /^Start printing plate/ }).click();
	taps++;
	const now = page.getByTestId('landing-now-card').first();
	await expect(now).toContainText(`Plate ${plate}`);
	console.log(`TAPS start=${taps}`);
	expect(taps).toBeLessThanOrEqual(2);
	// The next plate moves up while this one prints.
	await expect(page.getByTestId('next-up-card').first()).not.toHaveAttribute('data-plate', plate!);
	await page.screenshot({ path: `${SHOTS}/landing-printing-${page.viewportSize()!.width}.png` });

	// Taps 1 and 2: Finish & log (Success is preselected), Save.
	taps = 0;
	await now.getByRole('button', { name: /^Finish & log plate/ }).click();
	taps++;
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	taps++;
	await expect(page.getByTestId('landing-now-card')).toHaveCount(0);
	console.log(`TAPS finish=${taps}`);
	expect(taps).toBeLessThanOrEqual(2);
});

test('a viewer sees status but no controls', async ({ page, browser }) => {
	const { chapterUrl } = await ownerWithBuild(page, 'landing-viewer');
	await page.goto(chapterUrl);
	await settled(page);
	await page
		.getByTestId('next-up-card')
		.first()
		.getByRole('button', { name: /^Start printing plate/ })
		.click();
	await expect(page.getByTestId('landing-now-card')).toHaveCount(1);

	const email = uniqueEmail('landing-viewer');
	const link = await invite(page, email, 'viewer');
	const viewer = await joinViaInvite(browser, link, 'Vera Viewer', email);
	const vp = viewer.page;
	await vp.goto(chapterUrl);
	await settled(vp);
	await expect(vp.getByTestId('landing-now-card')).toHaveCount(1);
	await expect(vp.getByTestId('next-up-card').first()).toBeVisible();
	await expect(
		vp.getByRole('button', { name: /Start printing|Finish & log|Take off/ })
	).toHaveCount(0);
	await expect(vp.getByTestId('new-build')).toHaveCount(0);
	await viewer.context.close();
});

test('the landing opens few live streams and stays navigable', async ({ page }) => {
	test.setTimeout(180_000);
	const { chapterUrl } = await ownerWithBuild(page, 'landing-cap');
	for (let i = 2; i <= 7; i++) {
		await page.goto(chapterUrl);
		await createBuild(page, `Chair ${i}`, null);
	}
	await page.addInitScript(() => {
		const w = window as unknown as { __streams: string[]; EventSource: typeof EventSource };
		w.__streams = [];
		const Native = w.EventSource;
		w.EventSource = class extends Native {
			constructor(url: string | URL, init?: EventSourceInit) {
				super(url, init);
				w.__streams.push(String(url));
			}
		};
	});
	await page.goto(chapterUrl);
	await settled(page);
	await expect(page.getByTestId('next-up-card').first()).toBeVisible();
	await page.waitForTimeout(1500);
	const streams = await page.evaluate(
		() => (window as unknown as { __streams: string[] }).__streams
	);
	console.log('STREAMS', JSON.stringify(streams));
	// No build streams (polled instead); every build of the chapter shares one printer stream with
	// the nav (same org URL), so the page holds exactly 1 however many builds it shows.
	expect(streams.filter((u) => /\/api\/builds\//.test(u))).toHaveLength(0);
	expect(streams).toHaveLength(1);
	// Up to 6 builds appear (the owner's first plus 6 more were made: the 7th is left to "All builds").
	await expect(page.getByTestId('next-up-card')).toHaveCount(6);
	await expect(page.getByTestId('landing-more')).toContainText('All builds');
	// Layout check with 6 builds, one of them printing (a compact Now card).
	await page
		.getByTestId('next-up-card')
		.first()
		.getByRole('button', { name: /^Start printing plate/ })
		.click();
	await expect(page.getByTestId('landing-now-card')).toHaveCount(1);
	for (const [w, h] of [
		[390, 844],
		[1440, 900]
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		await page.screenshot({ path: `${SHOTS_4B}/landing-6-${w}.png`, fullPage: true });
	}
	// Still navigable: the page's own requests are not starved by streams.
	await page.getByTestId('new-build').click();
	await expect(page).toHaveURL(/\/builds\/new/);
});

const SIZES = [
	[390, 844],
	[1440, 900],
	[1920, 1080],
	[2560, 1440]
] as const;

test('screenshots: landing with something printing, and the empty state', async ({
	page,
	browser
}) => {
	test.setTimeout(120_000);
	const { chapterUrl } = await ownerWithBuild(page, 'landing-shots');
	await page.goto(chapterUrl);
	await settled(page);
	await page
		.getByTestId('next-up-card')
		.first()
		.getByRole('button', { name: /^Start printing plate/ })
		.click();
	await expect(page.getByTestId('landing-now-card')).toHaveCount(1);
	for (const [w, h] of SIZES) {
		for (const scheme of ['light', 'dark'] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(chapterUrl);
			await settled(page);
			await expect(page.getByTestId('next-up-card').first()).toBeVisible();
			const flow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
			expect(flow, 'no sideways scroll').toBe(true);
			await page.screenshot({ path: `${SHOTS}/landing-${w}-${scheme}.png` });
		}
	}

	const ctx = await newClientContext(browser);
	const fresh = await ctx.newPage();
	await signUp(fresh, 'Eve Empty', uniqueEmail('landing-empty-shots'));
	for (const [w, h] of [SIZES[0], SIZES[1]]) {
		for (const scheme of ['light', 'dark'] as const) {
			await fresh.setViewportSize({ width: w, height: h });
			await fresh.emulateMedia({ colorScheme: scheme });
			await fresh.reload();
			await settled(fresh);
			await fresh.screenshot({ path: `${SHOTS}/landing-empty-${w}-${scheme}.png` });
		}
	}
	await ctx.close();
});
