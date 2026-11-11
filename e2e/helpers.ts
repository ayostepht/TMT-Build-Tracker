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

/** On phones the nav links and menus sit behind the menu button: open it (a no-op on desktop). */
export async function openNav(page: Page) {
	const toggle = page.getByTestId('nav-toggle');
	if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true')
		await toggle.click();
}

/** The MakeGood tuned layout the helpers pick unless a spec asks for another one. */
export const TUNED_LAYOUT = 'Bambu X1 / P1 / A1 (24 plates)';

/**
 * From a workspace page: New build > name > Create build. Lands in the setup wizard; returns the
 * build id. Specs for the wizard itself use this and walk the steps.
 */
export async function startBuild(page: Page, name: string): Promise<string> {
	await settled(page);
	await page.getByTestId('new-build').click();
	await expect(page).toHaveURL(/\/builds\/new/);
	await settled(page);
	await page.getByLabel('Name', { exact: true }).fill(name);
	await page.getByRole('button', { name: 'Create build' }).click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/setup/);
	return new URL(page.url()).pathname.split('/')[2];
}

/**
 * Creates a build from the workspace page and gets past the setup wizard (Skip setup), then picks
 * the MakeGood tuned plates (most specs assume them; `layout` null keeps the template default).
 * Ends on the build's Overview. Returns the build id.
 */
export async function createBuild(
	page: Page,
	name: string,
	layout: string | null = TUNED_LAYOUT
): Promise<string> {
	const id = await startBuild(page, name);
	await settled(page);
	await page.getByTestId('skip-setup').click();
	await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
	if (layout) {
		await page.goto(`/builds/${id}/files`);
		await settled(page);
		await page.getByTestId('plate-layout').selectOption({ label: layout });
		await expect(page.getByTestId('layout-name')).toContainText("MakeGood's");
		await page.goto(`/builds/${id}`);
	}
	return id;
}

/** Owner on a chapter page creates an invite and returns its link. */
export async function invite(page: Page, email: string, role: 'viewer' | 'editor') {
	await page.getByRole('link', { name: 'Members', exact: true }).click();
	await expect(page).toHaveURL(/\/members$/);
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

/**
 * The Print tab hides Printed parts by default once a build is under way. Specs that look at a part
 * after it was printed keep them visible (the choice is stored per build; call before opening Print).
 */
export async function keepPrintedVisible(page: Page, buildId: string) {
	await page.evaluate((id) => {
		const k = `tmt-ui:${id}`;
		const u = JSON.parse(localStorage.getItem(k) ?? '{}');
		u.hide = false;
		localStorage.setItem(k, JSON.stringify(u));
	}, buildId);
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

/** On the Files tab: Arrange for my bed > Pick my printer > Elegoo Centauri Carbon with CANVAS. */
export async function arrangeForCentauri(page: Page) {
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-pick-printer').click();
	await page.getByTestId('printer-brand').selectOption('Elegoo');
	await page.getByTestId('printer-model').selectOption({ label: 'Centauri Carbon' });
	await page.getByTestId('printer-mm').selectOption({ index: 1 });
	await page.getByTestId('arrange-bed').click();
}

/** In the setup wizard: press Continue until `step` is showing (steps 2 to 5). */
export async function toSetupStep(page: Page, step: number) {
	for (let n = 1; n < step; n++) {
		await settled(page);
		await page.getByTestId('wizard-next').click();
		await expect(page).toHaveURL(new RegExp(`step=${n + 1}`));
	}
	await settled(page);
}
