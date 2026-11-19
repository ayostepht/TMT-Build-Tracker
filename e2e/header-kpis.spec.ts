import { expect, test } from './fixtures';
import { createChapter, ownerWithBuild, signUp, uniqueEmail } from './helpers';
import type { Page } from '@playwright/test';

/**
 * The build header shows the four Stats cards on every build tab (not on drafts), each a link to
 * the Stats tab. Screenshots go to HEADER_SHOTS when it is set.
 */
const SHOTS = process.env.HEADER_SHOTS;
test.use({ deviceScaleFactor: SHOTS ? 2 : 1 });
const origin = (page: Page) => ({ origin: new URL(page.url()).origin });

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
			printer: 'Header printer',
			note: '',
			...data
		}
	});
	expect(res.ok(), await res.text()).toBe(true);
}

async function seed(page: Page, buildId: string) {
	const v = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		plates: { number: number; parts: string[]; perPartRuns: boolean }[];
	};
	const whole = v.plates.filter((p) => !p.perPartRuns && p.parts.length >= 1);
	const [a, b] = whole;
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
}

const shot = async (page: Page, name: string) => {
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test('build header: four Stats cards on every build tab, live, linking to Stats', async ({
	page
}) => {
	test.setTimeout(180_000);
	const { buildId } = await ownerWithBuild(page, 'hdrkpi');

	// A fresh build: the cards are there with zeros and no estimate.
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	const strip = page.getByTestId('header-kpis');
	for (const k of ['parts', 'time', 'filament', 'finish'])
		await expect(page.getByTestId(`header-kpi-${k}`)).toBeVisible();
	await expect(page.getByTestId('header-kpi-parts')).toContainText('0');
	await page.setViewportSize({ width: 390, height: 844 });
	await shot(page, 'fresh-390-light');
	await page.setViewportSize({ width: 1440, height: 900 });
	await shot(page, 'fresh-1440-light');

	await seed(page, buildId);
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('header-kpi-time')).toContainText('27.5');
	await expect(page.getByTestId('header-kpi-time')).toContainText('h');
	await expect(page.getByTestId('header-kpi-filament')).toContainText('270');

	// Desktop: the short detail lines fit on one line (no "…"), and the full sentence is the hover title.
	for (const w of [1440, 1920]) {
		await page.setViewportSize({ width: w, height: 900 });
		await page.waitForTimeout(150);
		for (const k of ['parts', 'time', 'filament', 'finish']) {
			const d = page.getByTestId(`header-kpi-${k}`).locator('.st-detail');
			expect(
				await d.evaluate((e) => e.scrollWidth <= e.clientWidth),
				`${k} detail fits at ${w}`
			).toBe(true);
		}
	}
	const partsDetail = page.getByTestId('header-kpi-parts').locator('.st-detail');
	await expect(partsDetail).toHaveText(/^\d+ to go · 1 failed$/);
	await expect(partsDetail).toHaveAttribute('title', /^\d+ parts? to go · 1 failed print$/);
	const finishDetail = page.getByTestId('header-kpi-finish').locator('.st-detail');
	await expect(finishDetail).toHaveText(/^~[\d,.]+ h left$/);
	await expect(finishDetail).toHaveAttribute('title', /^About [\d,.]+ h left at [\d.]+ h a day/);

	// Every tab shows the strip, none of them scrolls sideways at 360 px.
	for (const tab of [
		'',
		'/print',
		'/files',
		'/design',
		'/finish',
		'/stats',
		'/activity',
		'/settings'
	]) {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto(`/builds/${buildId}${tab}`);
		await page.waitForLoadState('networkidle');
		// Phones: the Design tab is a work area and drops the cards.
		if (tab === '/design') await expect(strip).toBeHidden();
		else await expect(strip, tab || 'overview').toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			),
			`${tab} sideways scroll`
		).toBeLessThanOrEqual(0);
	}

	// A card is a link with a name, and it opens the Stats tab.
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	const card = page.getByRole('link', { name: /^Printing time: .* logged/ });
	await expect(card).toHaveAttribute('href', `/builds/${buildId}/stats`);
	await card.click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}/stats$`));
	await expect(page.getByTestId('header-kpis')).toBeVisible();

	// Live: a run logged through the API shows in the header without a reload.
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	const before = await page.getByTestId('header-kpi-parts').innerText();
	const v = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		plates: { number: number; perPartRuns: boolean; parts: string[] }[];
	};
	const c = v.plates.filter((p) => !p.perPartRuns && p.parts.length >= 1)[2];
	await logRun(page, buildId, {
		plateNumber: c.number,
		date: day(0),
		result: 'Success',
		grams: 80,
		hours: 3
	});
	await expect(page.getByTestId('header-kpi-parts')).not.toHaveText(before);

	for (const [w, h, scheme, name, scale] of [
		[390, 844, 'light', '390-light', 1],
		[360, 800, 'light', '360-light', 1],
		[390, 844, 'dark', '390-dark', 1],
		[1440, 900, 'light', '1440-light', 1],
		[1440, 900, 'dark', '1440-dark', 1],
		[1920, 1080, 'light', '1920-light', 1]
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		await page.emulateMedia({ colorScheme: scheme });
		await page.waitForTimeout(150);
		await shot(page, `seeded-${name}`);
		void scale;
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto(`/builds/${buildId}/stats`);
	await page.waitForLoadState('networkidle');
	await shot(page, 'stats-390-light');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await shot(page, 'design-390-light');
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(150);
	await shot(page, 'design-1440-light');
});

test('drafts keep the simple header with no cards', async ({ page }) => {
	await signUp(page, 'Dora Draft', uniqueEmail('hdrdraft'));
	await createChapter(page, `Draft chapter ${Date.now().toString(36)}`);
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('header-kpis')).toHaveCount(0);
});

test.describe('large desktop at 150%', () => {
	test.use({ viewport: { width: 1707, height: 900 }, deviceScaleFactor: 1.5 });
	test('header at 2560 px wide, 150% scale', async ({ page }) => {
		test.skip(!SHOTS, 'screenshots only');
		test.setTimeout(120_000);
		const { buildId } = await ownerWithBuild(page, 'hdrxl');
		await seed(page, buildId);
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		await shot(page, 'seeded-2560-150');
	});
});

test.describe('workspace Stats builds table on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	test('scroll shadow strength', async ({ page }) => {
		test.skip(!SHOTS, 'screenshots only');
		test.setTimeout(120_000);
		const { buildId, chapterUrl } = await ownerWithBuild(page, 'hdrws');
		await seed(page, buildId);
		await page.goto(`${chapterUrl.replace(/\/$/, '')}/stats`);
		await page.waitForLoadState('networkidle');
		await page.getByTestId('workspace-stats').scrollIntoViewIfNeeded();
		await page.evaluate(() => {
			const t = [...document.querySelectorAll('table')].pop();
			t?.scrollIntoView({ block: 'center' });
		});
		await shot(page, 'workspace-stats-table-390');
	});
});

test('time and filament cards carry an estimate line; Design hides the cards on phones', async ({
	page
}) => {
	test.setTimeout(120_000);
	const { buildId } = await ownerWithBuild(page, 'hdrest');
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('header-kpi-parts')).toHaveText(/^\s*Parts printed\s*0 of 33/);
	await expect(page.getByTestId('header-kpi-time')).toContainText(/\d h\s+of ~[\d,.]+ h/);
	await expect(page.getByTestId('header-kpi-filament')).toContainText(/k?g\s+of ~[\d,.]+ kg/);
	await page.setViewportSize({ width: 390, height: 844 });
	// Phones: the estimate is its own short line, never cut off.
	for (const k of ['time', 'filament']) {
		const est = page.getByTestId(`header-kpi-${k}`).locator('.st-detail');
		await expect(est).toHaveText(/^of ~[\d,.]+ (h|kg)$/);
		expect(await est.evaluate((e) => e.scrollWidth <= e.clientWidth), `${k} estimate fits`).toBe(
			true
		);
	}
	await expect(page.getByTestId('header-kpi-parts')).toHaveText(/0 \/ 33/);
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('header-kpis')).toBeHidden();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.getByTestId('header-kpis')).toBeVisible();
});
