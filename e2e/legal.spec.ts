import { expect, test } from './fixtures';
import { signUp, uniqueEmail } from './helpers';
import type { Page } from '@playwright/test';

// The public /privacy and /terms pages. Structure only: body sentences may change. The e2e server
// runs in self-hosted mode.

const PAGES = [
	{
		path: '/privacy',
		title: 'Privacy',
		marker: 'privacy-mode',
		sibling: 'terms-link',
		other: '/terms'
	},
	{
		path: '/terms',
		title: 'Terms',
		marker: 'terms-mode',
		sibling: 'privacy-link',
		other: '/privacy'
	}
] as const;

const settled = (page: Page) => page.waitForLoadState('networkidle');

/** Pixels the page scrolls sideways (0 = no horizontal overflow). */
async function overflowX(page: Page): Promise<number> {
	return page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
}

for (const p of PAGES) {
	test(`${p.path} signed out: structure, mode marker, back and sibling links`, async ({ page }) => {
		const res = await page.goto(p.path);
		expect(res?.status()).toBe(200);
		await settled(page);
		await expect(page.locator('main')).toHaveCount(1);
		await expect(page.locator('h1:visible')).toHaveCount(1);
		await expect(page.getByRole('heading', { level: 1, name: p.title, exact: true })).toBeVisible();
		await expect(page.locator('main')).toContainText('Last updated');
		await expect(page.getByTestId(p.marker)).toHaveAttribute('data-mode', 'selfhost');
		await expect(page.getByTestId(p.marker)).toBeHidden();

		await expect(page.getByTestId('legal-back')).toHaveAttribute('href', /\/login/);
		await page.getByTestId(p.sibling).click();
		await expect(page).toHaveURL(new RegExp(`${p.other}$`));
		await expect(page.locator('h1:visible')).toHaveCount(1);

		await page.goto(p.path);
		await page.getByTestId('legal-back').click();
		await expect(page).toHaveURL(/\/login/);
	});

	test(`${p.path} signed in: back leads into the app`, async ({ page }) => {
		await signUp(page, 'Lena Legal', uniqueEmail(`legal-in${p.title}`));
		await settled(page);
		await page.goto(p.path);
		await settled(page);
		await page.getByTestId('legal-back').click();
		await expect(page).toHaveURL(/\/teams\//);
	});

	for (const width of [390, 360]) {
		test(`${p.path} does not overflow sideways at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 844 });
			await page.goto(p.path);
			await settled(page);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			expect(await overflowX(page), `${p.path} at ${width}px`).toBeLessThanOrEqual(0);
		});
	}
}

test('external links in the legal pages are safe; the build guide is on Google Drive', async ({
	page
}) => {
	for (const p of PAGES) {
		await page.goto(p.path);
		await settled(page);
		for (const link of await page.locator('main a[href^="http"]').all()) {
			await expect(link).toHaveAttribute('rel', /noopener/);
		}
	}
	await page.goto('/terms');
	const guide = page.locator('main a[href*="drive.google.com"]');
	expect(await guide.count()).toBeGreaterThan(0);
	await expect(guide.first()).toHaveAttribute('rel', /noopener/);
});

for (const path of ['/login', '/signup']) {
	test(`${path} links the Terms and Privacy pages in its agreement sentence`, async ({ page }) => {
		await page.goto(path);
		await settled(page);
		const terms = page.getByTestId('terms-link');
		const privacy = page.getByTestId('privacy-link');
		await expect(terms).toHaveCount(1);
		await expect(privacy).toHaveCount(1);
		const sentence = page.locator('main p', { has: terms });
		await expect(sentence).toContainText(/agree/i);
		await expect(sentence.getByTestId('privacy-link')).toHaveCount(1);

		await terms.click();
		await expect(page).toHaveURL(/\/terms$/);
		await expect(page.getByRole('heading', { level: 1, name: 'Terms', exact: true })).toBeVisible();
		await page.goBack();
		await settled(page);
		await page.getByTestId('privacy-link').click();
		await expect(page).toHaveURL(/\/privacy$/);
		await expect(
			page.getByRole('heading', { level: 1, name: 'Privacy', exact: true })
		).toBeVisible();
	});
}

test('signing up still works with the agreement sentence on the page', async ({ page }) => {
	await signUp(page, 'Sam Signup', uniqueEmail('legal-signup'));
	await expect(page).toHaveURL(/\/teams\//);
});

test('signed in, /about and /help carry the Privacy and Terms links', async ({ page }) => {
	await signUp(page, 'Hana Help', uniqueEmail('legal-feet'));
	await settled(page);
	for (const path of ['/about', '/help']) {
		await page.goto(path);
		await settled(page);
		await expect(page.getByTestId('privacy-link'), path).toHaveAttribute('href', '/privacy');
		await expect(page.getByTestId('terms-link'), path).toHaveAttribute('href', '/terms');
		await page.getByTestId('terms-link').click();
		await expect(page).toHaveURL(/\/terms$/);
		await page.goBack();
		await settled(page);
		await page.getByTestId('privacy-link').click();
		await expect(page).toHaveURL(/\/privacy$/);
	}
});
