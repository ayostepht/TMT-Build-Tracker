import { expect, test } from './fixtures';
import { openNav, signUp, uniqueEmail } from './helpers';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PKG_VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
	.version;

// The static Help and About pages: reachable from the account menu, anchors, FAQ, links, and
// no phone overflow. Body sentences are deliberately not asserted (copy changes).

const SECTIONS = ['Getting started', 'Printing day', 'Glossary', 'FAQ'] as const;
const ANCHORS: Record<(typeof SECTIONS)[number], string> = {
	'Getting started': 'getting-started',
	'Printing day': 'printing-day',
	Glossary: 'glossary',
	FAQ: 'faq'
};

async function signedIn(page: Page, label: string) {
	await signUp(page, `Help ${label}`, uniqueEmail(label));
	await page.waitForLoadState('networkidle');
}

/** Pixels the page scrolls sideways (0 = no horizontal overflow). */
async function overflowX(page: Page): Promise<number> {
	return page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
}

for (const [width, height] of [
	[1440, 900],
	[390, 844]
] as const) {
	test(`account menu Help link opens /help at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height });
		await signedIn(page, `helpmenu${width}`);
		await openNav(page);
		await page.getByTestId('account-menu').click();
		await page.getByTestId('help-link').click();
		await expect(page).toHaveURL(/\/help$/);
		await expect(
			page.getByRole('heading', { level: 1, name: 'How the Build Tracker works' })
		).toBeVisible();
	});
}

test('help page: title, jump links reach their sections, FAQ opens, links to About', async ({
	page
}) => {
	await signedIn(page, 'helppage');
	await page.goto('/help');
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveTitle('Help · TMT Build Tracker');
	await expect(
		page.getByRole('heading', { level: 1, name: 'How the Build Tracker works' })
	).toBeVisible();

	const nav = page.getByTestId('help-nav');
	await expect(nav.getByRole('link')).toHaveText([...SECTIONS]);

	for (const name of [...SECTIONS].reverse()) {
		const id = ANCHORS[name];
		await nav.getByRole('link', { name, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`#${id}$`));
		const section = page.locator(`section#${id}`);
		await expect(section.getByRole('heading', { level: 2, name, exact: true })).toBeInViewport();
		await expect(page.getByRole('region', { name, exact: true })).toHaveAttribute('id', id);
	}

	const entries = page.locator('section#faq details');
	expect(await entries.count()).toBeGreaterThan(0);
	const first = entries.first();
	await expect(first).not.toHaveAttribute('open', '');
	await first.locator('summary').click();
	await expect(first).toHaveAttribute('open', '');
	await first.locator('summary').click();
	await expect(first).not.toHaveAttribute('open', '');

	await page.locator('main').getByRole('link', { name: 'About', exact: true }).first().click();
	await expect(page).toHaveURL(/\/about$/);
	await expect(page.getByRole('heading', { level: 1, name: 'TMT Build Tracker' })).toBeVisible();
});

test('about page: version, feedback link, MakeGood credit, safe external links', async ({
	page
}) => {
	await signedIn(page, 'about');
	await page.goto('/about');
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveTitle(/About/);
	await expect(page.getByRole('heading', { level: 1, name: 'TMT Build Tracker' })).toBeVisible();
	await expect(page.getByTestId('app-version')).toHaveText(/^\d+\.\d+\.\d+([-+][\w.-]+)?$/);
	await expect(page.getByTestId('app-version')).toHaveText(PKG_VERSION);
	const health = await page.request.get('/api/health');
	expect(health.status()).toBe(200);
	const body = (await health.json()) as { ok: boolean; version: string };
	expect(body.ok).toBe(true);
	expect(body.version).toBe(PKG_VERSION);

	await expect(page.getByTestId('feedback-link')).toHaveAttribute('href', /\/issues$/);
	await expect(page.locator('main a[href*="makerworld.com"]').first()).toBeVisible();

	const external = page.locator('main a[href^="http"]');
	expect(await external.count()).toBeGreaterThan(0);
	for (const link of await external.all()) {
		await expect(link).toHaveAttribute('rel', /noopener/);
	}

	await page.locator('main').getByRole('link', { name: 'Help', exact: true }).click();
	await expect(page).toHaveURL(/\/help$/);
});

test('signed out, /help and /about redirect to login', async ({ page }) => {
	for (const path of ['/help', '/about']) {
		await page.goto(path);
		await expect(page, path).toHaveURL(/\/login/);
	}
});

for (const width of [390, 360]) {
	test(`help and about do not overflow sideways at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await signedIn(page, `ovf${width}`);
		for (const path of ['/help', '/about']) {
			await page.goto(path);
			await page.waitForLoadState('networkidle');
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			expect(await overflowX(page), `${path} at ${width}px`).toBeLessThanOrEqual(0);
		}
		// Open FAQ entries are the widest content on Help.
		await page.goto('/help');
		for (const d of await page.locator('section#faq details summary').all()) await d.click();
		expect(await overflowX(page), `/help FAQ open at ${width}px`).toBeLessThanOrEqual(0);
	});
}
