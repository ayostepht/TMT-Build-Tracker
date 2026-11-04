import { newClientContext } from './fixtures';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PASSWORD = 'correct-horse-battery';

let counter = 0;
export function uniqueEmail(label: string): string {
	counter += 1;
	return `${label}-${Date.now().toString(36)}-${counter}@example.com`;
}

/** Forms are plain HTML until hydration; wait for it so clicks run the JS handlers. */
async function settled(page: Page) {
	await page.waitForLoadState('networkidle');
}

export async function signUp(page: Page, name: string, email: string, redirect?: string) {
	await page.goto(redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : '/signup');
	await settled(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel(/^Password/).fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	// Without an invite redirect a new account lands on its personal workspace, not onboarding.
	if (!redirect) await expect(page).toHaveURL(/\/teams\//);
}

/** Creates a chapter from the create-a-chapter page (reached from the account menu). */
export async function createChapter(page: Page, name: string) {
	if (!/\/onboarding/.test(page.url())) await page.goto('/onboarding');
	await settled(page);
	await page.getByLabel('Chapter name').fill(name);
	await page.getByRole('button', { name: 'Create chapter' }).click();
	await expect(page).toHaveURL(/\/teams\//);
	await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** The MakeGood tuned layout the helpers pick unless a spec asks for another one. */
export const TUNED_LAYOUT = 'Bambu X1 / P1 / A1';

/** Creates a build from the chapter page; returns the build id. */
export async function createBuild(
	page: Page,
	name: string,
	layout: string | null = TUNED_LAYOUT
): Promise<string> {
	await settled(page);
	// The New build form defaults to "Arrange for my bed"; most specs assume the MakeGood plates.
	if (layout) await page.getByTestId('plate-layout').selectOption({ label: layout });
	await page.getByLabel('Name', { exact: true }).fill(name);
	await page.getByRole('button', { name: 'Create build' }).click();
	await expect(page).toHaveURL(/\/builds\/[^/]+$/);
	return new URL(page.url()).pathname.split('/')[2];
}

/** Owner on a chapter page creates an invite and returns its link. */
export async function invite(page: Page, email: string, role: 'viewer' | 'editor') {
	await settled(page);
	const form = page.locator('form[action="?/invite"]');
	await form.getByLabel('Email').fill(email);
	await form.getByLabel('Role').selectOption(role);
	await form.getByRole('button', { name: 'Create invite link' }).click();
	const link = page.locator('input[readonly]').first();
	await expect(link).toHaveValue(/\/invite\//);
	return link.inputValue();
}

/** New browser context: sign up through an invite link and accept it. */
export async function joinViaInvite(
	browser: Browser,
	link: string,
	name: string,
	email: string
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await newClientContext(browser);
	const page = await context.newPage();
	const path = new URL(link).pathname;
	await page.goto(path);
	await page.getByRole('link', { name: 'Create account' }).click();
	await expect(page).toHaveURL(/\/signup\?redirect=/);
	await settled(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel(/^Password/).fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page).toHaveURL(new RegExp(`${path}$`));
	await settled(page);
	await page.getByRole('button', { name: 'Accept' }).click();
	await expect(page).toHaveURL(/\/teams\//);
	return { context, page };
}

/** Owner signs up, makes a chapter and a build. */
export async function ownerWithBuild(page: Page, label = 'owner') {
	await signUp(page, 'Olive Owner', uniqueEmail(label));
	await createChapter(page, `Chapter ${label} ${Date.now().toString(36)}`);
	const chapterUrl = page.url();
	const buildId = await createBuild(page, 'Test chair');
	return { chapterUrl, buildId };
}

export function row(page: Page, slug: string) {
	return page.locator(`.row[data-id="${slug}"]`);
}

/** The site admin of the e2e server (`ADMIN_EMAILS` in playwright.config.ts). */
export const ADMIN_EMAIL = 'e2e-admin@example.test';

/**
 * Signs `page` in as the fixed site admin, creating the account on first use. Works in any spec
 * order: the account is admin through `ADMIN_EMAILS`, not by being the first user.
 */
export async function signInAsAdmin(page: Page) {
	await page.goto('/login');
	await settled(page);
	await page.getByLabel('Email').fill(ADMIN_EMAIL);
	await page.getByLabel(/^Password/).fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	const signedIn = await page
		.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8_000 })
		.then(() => true)
		.catch(() => false);
	if (!signedIn) {
		await signUp(page, 'Ada Admin', ADMIN_EMAIL);
	}
	const res = await page.goto('/admin/templates');
	expect(res?.status(), 'ADMIN_EMAILS must contain the e2e admin').toBe(200);
}

/** On the Plates tab: Arrange for my bed > Pick my printer > Elegoo Centauri Carbon with CANVAS. */
export async function arrangeForCentauri(page: Page) {
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-pick-printer').click();
	await page.getByTestId('printer-brand').selectOption('Elegoo');
	await page.getByTestId('printer-model').selectOption({ label: 'Centauri Carbon' });
	await page.getByTestId('printer-mm').selectOption({ index: 1 });
	await page.getByTestId('arrange-bed').click();
}
