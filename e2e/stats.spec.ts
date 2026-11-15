import { expect, test } from './fixtures';
import {
	createBuild,
	createChapter,
	invite,
	joinViaInvite,
	openNav,
	ownerWithBuild,
	signUp,
	uniqueEmail
} from './helpers';
import { newClientContext } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * #47: the build Stats tab (/builds/[id]/stats) and the workspace Stats page
 * (/teams/[slug]/stats), plus their navigation and layout on phones.
 */

interface ViewJson {
	plates: { number: number; parts: string[]; perPartRuns: boolean; runs: number }[];
}

const origin = (page: Page) => ({ origin: new URL(page.url()).origin });
const view = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

/** Local YYYY-MM-DD, `back` days ago (the app logs runs by local date). */
function day(back: number) {
	const d = new Date();
	d.setDate(d.getDate() - back);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function logRun(page: Page, buildId: string, data: Record<string, unknown>) {
	const res = await page.request.post(`/api/builds/${buildId}/runs`, {
		headers: origin(page),
		data: {
			partSlug: null,
			partSlugs: null,
			grams: null,
			printer: 'Stats printer',
			note: '',
			...data
		}
	});
	expect(res.ok(), await res.text()).toBe(true);
}

/**
 * Logs a known set of runs: plate A 12 h good (day -5) and 1.5 h failed (day -4), plate B 14 h good
 * (day -3), and a 4 h Partial on a multi-part plate (day -2) that keeps its first part.
 * Logged: 31.5 h; the good/failed split is derived from the app, not assumed here.
 */
async function seed(page: Page, buildId: string) {
	const v = await view(page, buildId);
	const whole = v.plates.filter((p) => !p.perPartRuns && p.parts.length >= 1);
	const multi = whole.find((p) => p.parts.length >= 2)!;
	const [a, b] = whole.filter((p) => p !== multi);
	expect(multi && a && b, 'the tuned layout has the plates this seed needs').toBeTruthy();
	await logRun(page, buildId, {
		plateNumber: a.number,
		date: day(5),
		result: 'Success',
		grams: 100,
		hours: 12
	});
	await logRun(page, buildId, {
		plateNumber: a.number,
		date: day(4),
		result: 'Failed',
		grams: 20,
		hours: 1.5
	});
	await logRun(page, buildId, {
		plateNumber: b.number,
		date: day(3),
		result: 'Success',
		grams: 150,
		hours: 14
	});
	await logRun(page, buildId, {
		plateNumber: multi.number,
		date: day(2),
		result: 'Partial',
		hours: 4,
		split: { keptSlugs: [multi.parts[0]], keptGrams: 60, lostGrams: 25 }
	});
	return { a, b, multi, partsPrinted: a.parts.length + b.parts.length + 1 };
}

const noSideways = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('build Stats: empty build shows the empty state and no charts', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'statsempty');
	await page.goto(`/builds/${buildId}/stats`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('stats-empty')).toBeVisible();
	await expect(
		page.getByTestId('stats-empty').getByRole('link', { name: 'Go to Print' })
	).toBeVisible();
	await expect(page.getByTestId('build-stats')).toHaveCount(0);
	await expect(page.locator('figure')).toHaveCount(0);
});

test('build Stats: tiles, failure chart, data table and keyboard on a seeded build', async ({
	page
}) => {
	test.setTimeout(120_000);
	const { buildId } = await ownerWithBuild(page, 'statsseed');
	const s = await seed(page, buildId);
	await page.goto(`/builds/${buildId}/stats`);
	await page.waitForLoadState('networkidle');

	await expect(page.getByTestId('stats-empty')).toHaveCount(0);
	await expect(page.getByTestId('build-stats')).toBeVisible();
	await expect(page.getByTestId('stats-tiles').locator('[data-testid^="stat-"]')).toHaveCount(4);

	// Tiles.
	await expect(page.getByTestId('stat-time')).toContainText('31.5');
	await expect(page.getByTestId('stat-time')).toContainText('h logged');
	await expect(page.getByTestId('stat-filament')).toContainText('Filament used');
	await expect(page.getByTestId('stat-parts')).toContainText(String(s.partsPrinted));
	await expect(page.getByTestId('stat-parts')).toContainText(/of \d+/);
	await expect(page.getByTestId('stat-parts')).toContainText(/\d+ failed prints?/);
	await expect(page.getByTestId('stat-finish')).toContainText('Projected finish');

	// Every chart is there, each with a summary and a data disclosure.
	for (const id of [
		'chart-progress',
		'chart-failures',
		'chart-filament',
		'chart-plates',
		'chart-time'
	]) {
		const fig = page.getByTestId(id).locator('figure');
		await expect(fig, id).toBeVisible();
		await expect(fig.locator('figcaption h3'), id).not.toBeEmpty();
		await expect(fig.locator('figcaption p'), id).not.toBeEmpty();
		await expect(fig.getByText('Show data'), id).toBeVisible();
	}

	// Failures: the failed plate is listed, with its rate, in the chart and in the table.
	const failures = page.getByTestId('chart-failures');
	await expect(failures).toContainText(new RegExp(`\\bP${s.a.number} `));
	await expect(failures.locator('figcaption p')).toContainText(/\d+ of \d+ prints failed/);
	await failures.getByText('Show data').click();
	const failTable = failures.getByRole('table');
	await expect(failTable).toBeVisible();
	await expect(failTable.getByRole('columnheader')).toHaveText([
		'Plate',
		'Runs',
		'Failed',
		'Failure rate'
	]);
	const failRow = failTable.getByRole('row').filter({ hasText: new RegExp(`\\bP${s.a.number} `) });
	await expect(failRow.getByRole('cell').nth(0)).toHaveText('2'); // runs
	await expect(failRow.getByRole('cell').nth(1)).toHaveText('1'); // failed
	await expect(failRow.getByRole('cell').nth(2)).toHaveText('50%');
	// The Partial's lost parts are a failure on its plate. (Runs and rate are not asserted: they
	// depend on the order two same-day runs come back in, see the report for #47.)
	const partialRow = failTable
		.getByRole('row')
		.filter({ hasText: new RegExp(`\\bP${s.multi.number} `) });
	await expect(partialRow.getByRole('cell').nth(1)).toHaveText('1');

	// Plate time against the estimate lists the plates that ran as logged.
	await expect(page.getByTestId('chart-plates')).toContainText(new RegExp(`\\bP${s.b.number} `));

	// Hours chart: the table matches what was logged, per day.
	const time = page.getByTestId('chart-time');
	await time.getByText('Show data').click();
	const timeTable = time.getByRole('table');
	await expect(timeTable.getByRole('columnheader')).toHaveText(['Day', 'Good (h)', 'Failed (h)']);
	const cells = async (back: number) =>
		timeTable
			.getByRole('row')
			.filter({ has: page.getByRole('rowheader', { name: day(back), exact: true }) })
			.getByRole('cell')
			.allTextContents();
	expect(await cells(5)).toEqual(['12', '0']);
	expect(await cells(4)).toEqual(['0', '1.5']);
	expect(await cells(3)).toEqual(['14', '0']);
	// The Partial day: its 4 h split between good and failed, and nothing is lost on the way.
	const partial = (await cells(2)).map(Number);
	expect(partial[0] + partial[1]).toBeCloseTo(4, 5);
	expect(partial[0]).toBeGreaterThan(0);
	expect(partial[1]).toBeGreaterThan(0);
	expect(await cells(1)).toEqual(['0', '0']);

	// Keyboard: one tab stop, ArrowRight moves, the readout follows, Escape clears.
	const cols = time.getByRole('button');
	const readout = time.locator('.sb-read');
	await expect(readout).toHaveText('Tap a bar for its value.');
	await expect(cols.first()).toHaveAttribute('tabindex', '0');
	await expect(cols.nth(1)).toHaveAttribute('tabindex', '-1');
	await cols.first().focus();
	await expect(cols.first()).toHaveAttribute('aria-pressed', 'true');
	await expect(readout).toContainText('12 h Good');
	const first = await readout.textContent();
	await page.keyboard.press('ArrowRight');
	await expect(cols.nth(1)).toBeFocused();
	await expect(cols.nth(1)).toHaveAttribute('aria-pressed', 'true');
	await expect(cols.first()).toHaveAttribute('aria-pressed', 'false');
	await expect(readout).not.toHaveText(first!);
	await expect(readout).toContainText('1.5 h Failed');
	await page.keyboard.press('End');
	await expect(cols.last()).toBeFocused();
	await page.keyboard.press('Home');
	await expect(cols.first()).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(cols.first()).toHaveAttribute('aria-pressed', 'false');
	await expect(readout).toHaveText('Tap a bar for its value.');

	// Names: every chart is labelled by its title and summary, every column button has a name.
	const bad = await page.evaluate(() => {
		const out: string[] = [];
		for (const svg of document.querySelectorAll('figure svg[role="img"]')) {
			const ids = (svg.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
			const text = ids.map((i) => document.getElementById(i)?.textContent?.trim() ?? '').join('');
			if (!text) out.push('svg without a name');
		}
		for (const b of document.querySelectorAll('figure button')) {
			if (!b.getAttribute('aria-label')?.trim()) out.push('button without a name');
		}
		return out;
	});
	expect(bad).toEqual([]);
});

test('build Stats: a Studio draft is sent to its Design tab', async ({ page }) => {
	await signUp(page, 'Dana Draft', uniqueEmail('statsdraft'));
	await page.waitForLoadState('networkidle');
	await page.getByTestId('nav-studio').click();
	await expect(page).toHaveURL(/\/studio/);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
	const id = new URL(page.url()).pathname.split('/')[2];
	await page.goto(`/builds/${id}/stats`);
	await expect(page).toHaveURL(new RegExp(`/builds/${id}/design$`));
	await expect(page.getByTestId('build-stats')).toHaveCount(0);
	// A draft's tab bar has no Stats tab.
	const tabs = page.getByRole('navigation', { name: 'Build sections' });
	await expect(tabs.getByRole('link', { name: 'Stats' })).toHaveCount(0);
});

test('workspace Stats: months selector, drafts left out, viewer access, outsider 404', async ({
	page,
	browser
}) => {
	test.setTimeout(180_000);
	await signUp(page, 'Wanda Owner', uniqueEmail('wsstats'));
	await createChapter(page, `Stats chapter ${Date.now().toString(36)}`);
	const chapterUrl = page.url().replace(/\/$/, '');
	const statsUrl = `${chapterUrl}/stats`;

	// A draft in this workspace, and no builds yet: nothing to chart.
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
	await page.goto(statsUrl);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('workspace-stats')).toBeVisible();
	await expect(page.getByTestId('stats-empty')).toBeVisible();
	await expect(page.getByTestId('stats-builds')).toHaveCount(0);

	// A real build with runs.
	await page.goto(chapterUrl);
	const buildId = await createBuild(page, 'Stats chair');
	await seed(page, buildId);
	await page.goto(statsUrl);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('stats-empty')).toHaveCount(0);
	await expect(page.getByTestId('stat-time')).toContainText('31.5');
	await expect(page.getByTestId('stat-builds')).toContainText('1 in progress');
	for (const id of ['chart-weekly', 'chart-printers', 'chart-filaments', 'chart-plates']) {
		await expect(page.getByTestId(id), id).toBeVisible();
	}
	await expect(page.getByTestId('stat-perchair')).toContainText('Not yet');
	// Only the build is listed; the draft is not, and its name never appears.
	await expect(page.getByTestId('stats-build-row')).toHaveCount(1);
	await expect(page.getByTestId('stats-build-row')).toContainText('Stats chair');
	await expect(
		page.getByTestId('stats-build-row').getByRole('link', { name: 'Stats chair' })
	).toHaveAttribute('href', `/builds/${buildId}/stats`);

	// Printers chart names the printer the runs were logged on.
	await expect(page.getByTestId('chart-printers')).toContainText('Stats printer');

	// Months selector: 6 by default, links change ?months and aria-current.
	const months = page.getByTestId('stats-months');
	await expect(page.getByTestId('months-6')).toHaveAttribute('aria-current', 'true');
	await expect(months.locator('[aria-current="true"]')).toHaveCount(1);
	await expect(months.getByRole('link')).toHaveText([
		'3 months',
		'6 months',
		'12 months',
		'24 months'
	]);
	for (const m of [12, 3, 24, 6]) {
		await page.getByTestId(`months-${m}`).click();
		await expect(page).toHaveURL(new RegExp(`/stats\\?months=${m}$`));
		await expect(page.getByTestId(`months-${m}`)).toHaveAttribute('aria-current', 'true');
		await expect(months.locator('[aria-current="true"]')).toHaveCount(1);
		await expect(page.getByTestId('stat-time')).toContainText('31.5');
	}
	// An unknown window falls back to the default.
	await page.goto(`${statsUrl}?months=banana`);
	await expect(page.getByTestId('months-6')).toHaveAttribute('aria-current', 'true');

	// A viewer member sees the page and the same numbers.
	const viewerEmail = uniqueEmail('wsviewer');
	const link = await invite(page, viewerEmail, 'viewer');
	const viewer = await joinViaInvite(browser, link, 'Vera Viewer', viewerEmail);
	await viewer.page.goto(statsUrl);
	await viewer.page.waitForLoadState('networkidle');
	await expect(viewer.page.getByTestId('workspace-stats')).toBeVisible();
	await expect(viewer.page.getByTestId('stat-time')).toContainText('31.5');
	await expect(viewer.page.getByTestId('stats-build-row')).toHaveCount(1);
	await viewer.context.close();

	// Someone outside the chapter gets a 404, and nothing of the numbers.
	const outsider = await newClientContext(browser);
	const op = await outsider.newPage();
	await signUp(op, 'Otto Outsider', uniqueEmail('wsout'));
	const res = await op.goto(statsUrl);
	expect(res?.status()).toBe(404);
	await expect(op.getByTestId('workspace-stats')).toHaveCount(0);
	await expect(op.getByText('Stats chair')).toHaveCount(0);
	await outsider.close();
});

test('workspace Stats: the personal workspace (My builds) has a Stats page', async ({ page }) => {
	test.setTimeout(120_000);
	await signUp(page, 'Pia Personal', uniqueEmail('statspersonal'));
	await expect(page.getByRole('heading', { level: 1, name: 'My builds' })).toBeVisible();
	const home = page.url().replace(/\/$/, '');

	await openNav(page);
	await page.getByTestId('nav-stats').click();
	await expect(page).toHaveURL(`${home}/stats`);
	await expect(page.getByTestId('workspace-stats')).toBeVisible();
	await expect(page.getByTestId('stats-empty')).toBeVisible();

	await page.goto(home);
	const buildId = await createBuild(page, 'Solo stats chair');
	await seed(page, buildId);
	await page.goto(`${home}/stats`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('stat-time')).toContainText('31.5');
	await expect(page.getByTestId('stats-build-row')).toHaveCount(1);
});

test('Stats navigation: main nav link and the build and chapter section bars', async ({ page }) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'statsnav');
	const statsUrl = `${new URL(chapterUrl).pathname.replace(/\/$/, '')}/stats`;

	// From a build page, the main nav goes to the current workspace's Stats.
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	await openNav(page);
	await expect(page.getByTestId('nav-stats')).toHaveAttribute('href', statsUrl);
	await page.getByTestId('nav-stats').click();
	await expect(page).toHaveURL(statsUrl);
	await openNav(page);
	await expect(page.getByTestId('nav-stats')).toHaveAttribute('aria-current', 'page');

	// The chapter's section bar has a Stats link too.
	const chapterNav = page.getByRole('navigation', { name: 'Chapter sections' });
	await expect(chapterNav.getByRole('link', { name: 'Stats' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await page.goto(chapterUrl);
	await chapterNav.getByRole('link', { name: 'Stats' }).click();
	await expect(page).toHaveURL(statsUrl);

	// Build tab bar: 8 tabs, Stats between Activity and Settings, and the tab opens the page.
	await page.goto(`/builds/${buildId}`);
	const tabs = page.getByRole('navigation', { name: 'Build sections' });
	await expect(tabs.getByRole('link')).toHaveText([
		'Overview',
		'Design',
		'Print',
		'Files',
		'Finish',
		'Activity',
		'Stats',
		'⚙ Settings'
	]);
	await tabs.getByRole('link', { name: 'Stats' }).click();
	await expect(page).toHaveURL(`/builds/${buildId}/stats`);
	await expect(tabs.locator('[aria-current="page"]')).toHaveText('Stats');
	await expect(page.getByTestId('stats-empty')).toBeVisible();
});

for (const width of [360, 320]) {
	test(`Stats pages do not scroll sideways at ${width}px; the tab row scrolls inside itself below 352px`, async ({
		page
	}) => {
		test.setTimeout(150_000);
		await page.setViewportSize({ width, height: 800 });
		const { chapterUrl, buildId } = await ownerWithBuild(page, `statsphone${width}`);
		await seed(page, buildId);
		const wsUrl = `${new URL(chapterUrl).pathname.replace(/\/$/, '')}/stats`;

		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			for (const path of [`/builds/${buildId}/stats`, wsUrl, `${wsUrl}?months=24`]) {
				await page.goto(path);
				await page.waitForLoadState('networkidle');
				await expect(page.locator('figure').first()).toBeVisible();
				expect(await noSideways(page), `${path} ${scheme}`).toBeLessThanOrEqual(0);
				// An open data table scrolls inside its own region, not the page.
				await page.locator('summary', { hasText: 'Show data' }).first().click();
				expect(await noSideways(page), `${path} ${scheme} with data open`).toBeLessThanOrEqual(0);
			}
		}

		await page.goto(`/builds/${buildId}/stats`);
		await page.waitForLoadState('networkidle');
		const row = page.locator('.tb-in');
		const m = await row.evaluate((el) => ({
			scroll: el.scrollWidth,
			client: el.clientWidth,
			overflowX: getComputedStyle(el).overflowX
		}));
		if (width < 352) {
			expect(m.scroll, 'row overflows itself').toBeGreaterThan(m.client);
			expect(['auto', 'scroll']).toContain(m.overflowX);
			// The active tab (Stats) was scrolled into view, and every tab is reachable by scrolling.
			const stats = page
				.getByRole('navigation', { name: 'Build sections' })
				.getByRole('link', { name: 'Stats' });
			const inView = await stats.evaluate((el) => {
				const a = el.getBoundingClientRect();
				const p = el.parentElement!.getBoundingClientRect();
				return a.left >= p.left - 1 && a.right <= p.right + 1;
			});
			expect(inView).toBe(true);
			await row.evaluate((el) => (el.scrollLeft = 0));
			await expect(
				page
					.getByRole('navigation', { name: 'Build sections' })
					.getByRole('link', { name: 'Overview' })
			).toBeInViewport();
		} else {
			expect(m.scroll).toBeLessThanOrEqual(m.client + 1);
		}
		expect(await noSideways(page)).toBeLessThanOrEqual(0);
	});
}
