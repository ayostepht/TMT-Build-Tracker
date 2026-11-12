import { expect, newClientContext, test } from './fixtures';
import {
	createBuild,
	invite,
	joinViaInvite,
	ownerWithBuild,
	signUp,
	startBuild,
	uniqueEmail
} from './helpers';
import { chooseStatus } from './status-helpers';

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

test('start a plate in 2 taps and log it done in 3 taps, from the landing', async ({ page }) => {
	const { chapterUrl } = await ownerWithBuild(page, 'landing');
	await page.goto(chapterUrl);
	await settled(page);

	await expect(page.getByTestId('landing-now')).toContainText('Nothing on a printer right now.');
	const next = page.getByTestId('next-up-card').first();
	await expect(next).toBeVisible();
	const plate = await next.getAttribute('data-plate');
	await page.screenshot({ path: `${SHOTS}/landing-next-${page.viewportSize()!.width}.png` });

	// Taps 1 and 2: the status badge, then Printing (no printer connected: no dialog).
	let taps = 0;
	await chooseStatus(next.getByTestId('plate-status'), 'Printing');
	taps++;
	const now = page.getByTestId('landing-now-card').first();
	await expect(now).toContainText(`Plate ${plate}`);
	console.log(`TAPS start=${taps}`);
	expect(taps).toBeLessThanOrEqual(2);
	// The next plate moves up while this one prints.
	await expect(page.getByTestId('next-up-card').first()).not.toHaveAttribute('data-plate', plate!);
	await page.screenshot({ path: `${SHOTS}/landing-printing-${page.viewportSize()!.width}.png` });

	// Taps 1 to 3: the status badge, Printed (Success is preselected), Save.
	taps = 0;
	await chooseStatus(now.getByTestId('plate-status'), 'Printed');
	taps += 2;
	await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
	taps++;
	await expect(page.getByTestId('landing-now-card')).toHaveCount(0);
	console.log(`TAPS finish=${taps}`);
	expect(taps).toBeLessThanOrEqual(3);
});

test('a viewer sees status but no controls', async ({ page, browser }) => {
	const { chapterUrl } = await ownerWithBuild(page, 'landing-viewer');
	await page.goto(chapterUrl);
	await settled(page);
	await chooseStatus(
		page.getByTestId('next-up-card').first().getByTestId('plate-status'),
		'Printing'
	);
	await expect(page.getByTestId('landing-now-card')).toHaveCount(1);

	const email = uniqueEmail('landing-viewer');
	const link = await invite(page, email, 'viewer');
	const viewer = await joinViaInvite(browser, link, 'Vera Viewer', email);
	const vp = viewer.page;
	await vp.goto(chapterUrl);
	await settled(vp);
	await expect(vp.getByTestId('landing-now-card')).toHaveCount(1);
	await expect(vp.getByTestId('next-up-card').first()).toBeVisible();
	// A viewer sees the status as a plain badge: no menu button, no log action.
	await expect(vp.getByRole('button', { name: /status:.*Change status|Log a print/ })).toHaveCount(
		0
	);
	await expect(vp.getByTestId('plate-status').first()).toBeVisible();
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
	await chooseStatus(
		page.getByTestId('next-up-card').first().getByTestId('plate-status'),
		'Printing'
	);
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

test('the builds list is first, one tap to a build; build links in the cards lead there too', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'landing-quick');
	await page.goto(chapterUrl);
	await settled(page);
	await expect(page.getByTestId('landing-quick')).toHaveCount(0);
	const link = page.getByTestId('build-card').getByRole('link', { name: /Test chair/ });
	await expect(link).toHaveAttribute('href', `/builds/${buildId}`);

	// On screen without scrolling, and a thumb-sized target.
	// (the whole row is the link: the stretched ::after covers it)
	const card = page.getByTestId('build-card').first();
	await expect(card).toBeInViewport({ ratio: 1 });
	const box = await card.boundingBox();
	expect(box!.height).toBeGreaterThanOrEqual(44);
	expect(box!.y + box!.height).toBeLessThanOrEqual(844);
	expect(await page.evaluate(() => scrollY)).toBe(0);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		'no sideways scroll'
	).toBeLessThanOrEqual(0);

	await link.click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));

	await page.goto(chapterUrl);
	await settled(page);
	const open = page.getByTestId('next-up-card').first().getByTestId('landing-open-build');
	await expect(open).toHaveAttribute('href', `/builds/${buildId}`);
	await open.click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));

	// With a plate printing, its Now printing card has the pill too.
	await page.goto(chapterUrl);
	await settled(page);
	await chooseStatus(
		page.getByTestId('next-up-card').first().getByTestId('plate-status'),
		'Printing'
	);
	await expect(page.getByTestId('landing-now-card')).toHaveCount(1);
	const nowOpen = page.getByTestId('landing-now-card').getByTestId('landing-open-build');
	await expect(nowOpen).toHaveAttribute('href', `/builds/${buildId}`);
	await nowOpen.click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
});

test('a build card is one big link; the Setup pill inside it still goes to setup', async ({
	page
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'landing-card');
	// A second build left in setup.
	await page.goto(chapterUrl);
	const setupId = await startBuild(page, 'Setup chair');
	await page.goto(chapterUrl);
	await settled(page);

	const done = page.getByTestId('build-card').filter({ hasText: 'Test chair' });
	const inSetup = page.getByTestId('build-card').filter({ hasText: 'Setup chair' });
	await expect(done).toHaveCount(1);
	await expect(inSetup).toHaveCount(1);

	// Click away from the title (right edge, vertically centred).
	for (const [card, id] of [
		[done, buildId],
		[inSetup, setupId]
	] as const) {
		await card.scrollIntoViewIfNeeded();
		const box = (await card.boundingBox())!;
		await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
		await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
		await page.goto(chapterUrl);
		await settled(page);
	}

	await inSetup.getByRole('link', { name: /^Setup: step \d of 5/ }).click();
	await expect(page).toHaveURL(new RegExp(`/builds/${setupId}/setup`));
	await expect(done.getByRole('link', { name: /^Setup:/ })).toHaveCount(0);
});

test('a build card link is keyboard focusable and Enter opens it', async ({ page }) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'landing-key');
	await page.goto(chapterUrl);
	await settled(page);
	const link = page.getByTestId('build-card').getByRole('link', { name: 'Test chair' });
	await link.focus();
	await expect(link).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
});

for (const [label, name] of [
	['build rows and cards', 'Second chair'],
	['a very long build name', 'A rather long build name that keeps going and going past the edge'],
	['a 40-character single word as the name', 'Supercalifragilisticexpialidocious12345678']
] as const) {
	test(`the landing has no sideways scroll at 390 and 360px with ${label}`, async ({ page }) => {
		const { chapterUrl } = await ownerWithBuild(page, 'landing-ovf');
		await page.goto(chapterUrl);
		await createBuild(page, name, null);
		await page.goto(chapterUrl);
		await settled(page);
		// Print the plate of the long-named build, so its Now printing card is on the page.
		await chooseStatus(
			page.getByTestId('next-up-card').filter({ hasText: name }).getByTestId('plate-status'),
			'Printing'
		);
		await expect(page.getByTestId('landing-now-card')).toHaveCount(1);
		await expect(page.getByTestId('build-card').first()).toBeVisible();
		await expect(page.getByTestId('build-card')).toHaveCount(2);
		for (const width of [390, 360]) {
			await page.setViewportSize({ width, height: 844 });
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
				`${width}px`
			).toBeLessThanOrEqual(0);
		}
	});
}

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
	await chooseStatus(
		page.getByTestId('next-up-card').first().getByTestId('plate-status'),
		'Printing'
	);
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

test('tracking card actions: same row, at least 44 px high, not overlapping (phone)', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl } = await ownerWithBuild(page, 'landing-btns');
	await page.goto(chapterUrl);
	await settled(page);

	const tol = 1;
	type Box = { x: number; y: number; width: number; height: number };
	const boxes = async (locs: import('@playwright/test').Locator[]): Promise<Box[]> => {
		const out: Box[] = [];
		for (const l of locs) {
			await expect(l).toBeVisible();
			out.push((await l.boundingBox())!);
		}
		return out;
	};
	const check = (bs: Box[], sameTop: boolean) => {
		for (const b of bs) expect(b.height).toBeGreaterThanOrEqual(44 - tol);
		if (sameTop) for (const b of bs) expect(Math.abs(b.y - bs[0].y)).toBeLessThanOrEqual(tol);
		const sorted = [...bs].sort((a, b) => a.x - b.x);
		for (let i = 1; i < sorted.length; i++)
			expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width - tol);
	};

	// Next up: the status badge, and Log a print… beside it.
	const next = page.getByTestId('next-up-card').first();
	const nextBtns = [
		next.getByTestId('plate-status'),
		next.getByRole('button', { name: /^Log a print on plate/ })
	];
	check(await boxes(nextBtns), true);

	// Start a plate, then the Now card.
	await chooseStatus(nextBtns[0], 'Printing');
	const now = page.getByTestId('landing-now-card').first();
	const nowBtns = [now.getByTestId('plate-status'), now.getByTestId('now-details')];
	check(await boxes(nowBtns), true);

	// The next plate that moved up keeps the same rules.
	const next2 = page.getByTestId('next-up-card').first();
	check(
		await boxes([
			next2.getByTestId('plate-status'),
			next2.getByRole('button', { name: /^Log a print on plate/ })
		]),
		true
	);
});
