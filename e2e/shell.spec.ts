import { expect, test } from './fixtures';
import {
	createBuild,
	invite,
	joinViaInvite,
	signInAsAdmin,
	startBuild,
	toSetupStep,
	createChapter,
	openNav,
	ownerWithBuild,
	signUp,
	uniqueEmail
} from './helpers';
import { newClientContext } from './fixtures';
import type { Page } from '@playwright/test';

// Phone shell (Stage 2): one-row top bar, one-line build header, bottom tab bar, error page,
// "All builds", completed steps folded on Finish. Screenshots go to SHOTS (gitignored).
const SHOTS = '.playwright-mcp/stage2-app-shell';

const overflow = (page: Page) =>
	page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth
	}));

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test('top bar is one row, the build header one line, six tabs sit in a bottom bar', async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, 'shell');
		await page.goto(`/builds/${buildId}/print`);
		await page.waitForLoadState('networkidle');

		const m = await page.evaluate(() => {
			const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
			const bar = r('.tb-in');
			const links = [...document.querySelectorAll('.tb-in a')].map((a) => {
				const b = a.getBoundingClientRect();
				return { l: b.left, r: b.right, w: b.width, h: b.height };
			});
			const first = document.querySelector('.group-head, .group h2')!.getBoundingClientRect();
			const tool = document.querySelector('.toolbar')?.getBoundingClientRect();
			return {
				vh: innerHeight,
				topbar: r('.topbar').height,
				header: r('header.head').height,
				barTop: bar.top,
				barH: bar.height,
				links,
				firstContentTop: Math.round(first.top + scrollY),
				toolbarH: tool ? Math.round(tool.height) : 0
			};
		});
		console.log('PRINT-METRICS', JSON.stringify(m));
		expect(m.topbar, 'one-row top bar').toBeLessThanOrEqual(56);
		expect(m.header, 'one-line build header').toBeLessThanOrEqual(56);
		expect(m.links).toHaveLength(6);
		for (const l of m.links) {
			expect(l.l).toBeGreaterThanOrEqual(0);
			expect(l.r).toBeLessThanOrEqual(390.5);
			expect(l.h).toBeGreaterThanOrEqual(40);
			expect(l.w).toBeGreaterThanOrEqual(40);
		}
		// The bar hugs the bottom edge of the screen.
		expect(Math.round(m.barTop + m.barH)).toBe(m.vh);
		// Content share while scrolled: the bottom bar and the sticky toolbar are the pinned parts.
		const share = (m.vh - m.barH - m.toolbarH) / m.vh;
		console.log('PRINT-CONTENT-SHARE', share.toFixed(3));
		await page.screenshot({ path: `${SHOTS}/print-390-light.png` });
	});

	test('header details open on tap; menu panel reaches every nav item', async ({ page }) => {
		const { buildId } = await ownerWithBuild(page, 'shellmenu');
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('.overall')).toBeHidden();
		await page.getByTestId('header-details').click();
		await expect(page.locator('.overall')).toBeVisible();
		await page.screenshot({ path: `${SHOTS}/overview-details-390-light.png` });
		await page.getByTestId('header-details').click();
		await expect(page.locator('.overall')).toBeHidden();

		await expect(page.getByTestId('nav-studio')).toBeHidden();
		await openNav(page);
		for (const id of ['builds-menu', 'nav-studio', 'nav-designs', 'account-menu'])
			await expect(page.getByTestId(id)).toBeVisible();
		await page.screenshot({ path: `${SHOTS}/menu-390-light.png` });
		// A tap outside closes the panel.
		await page.mouse.click(195, 770);
		await expect(page.getByTestId('nav-studio')).toBeHidden();
	});

	for (const width of [360, 390]) {
		test(`no sideways scroll at ${width}px on Overview, Print, Files, Finish, Settings`, async ({
			page
		}) => {
			const { buildId } = await ownerWithBuild(page, `ov${width}`);
			await page.setViewportSize({ width, height: 844 });
			for (const path of ['', '/print', '/files', '/finish', '/settings']) {
				await page.goto(`/builds/${buildId}${path}`);
				await page.waitForLoadState('networkidle');
				const o = await overflow(page);
				expect(o.scroll, `${path || 'overview'} at ${width}`).toBeLessThanOrEqual(o.client);
				const links = await page.locator('.tb-in a').evaluateAll((els) =>
					els.map((e) => {
						const b = e.getBoundingClientRect();
						return { l: b.left, r: b.right, h: b.height };
					})
				);
				expect(links).toHaveLength(6);
				for (const l of links) {
					expect(l.l).toBeGreaterThanOrEqual(0);
					expect(l.r).toBeLessThanOrEqual(width + 0.5);
					expect(l.h).toBeGreaterThanOrEqual(40);
				}
			}
			await page.screenshot({ path: `${SHOTS}/settings-${width}-light.png` });
		});
	}
});

test('error page: styled 404 inside the app and outside it, no stack trace', async ({
	page,
	browser
}) => {
	await signUp(page, 'Erin Error', uniqueEmail('err'));
	await page.goto('/builds/no-such-build');
	const err = page.getByTestId('error-page');
	await expect(err).toBeVisible();
	await expect(err.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await expect(err.getByTestId('error-home')).toHaveText('Back to builds');
	// The app's top bar stays.
	await expect(
		page.getByRole('banner').getByRole('link', { name: 'TMT Build Tracker' })
	).toBeVisible();
	await expect(err).not.toContainText(/at \w+ \(|\.ts:\d+|Error:/);
	await page.screenshot({ path: `${SHOTS}/error-1440-light.png` });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: `${SHOTS}/error-390-light.png` });
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.screenshot({ path: `${SHOTS}/error-390-dark.png` });
	await err.getByTestId('error-home').click();
	await expect(page).toHaveURL(/\/teams\//);

	// Signed out, on a URL no route matches: the same page, with a way to sign in.
	const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.8.8.8' } });
	const anon = await ctx.newPage();
	const res = await anon.goto('/no/such/page');
	expect(res?.status()).toBe(404);
	await expect(anon.getByTestId('error-page')).toBeVisible();
	await expect(anon.getByTestId('error-login')).toBeVisible();
	await ctx.close();
});

test('All builds lists every chapter and My builds, grouped; Designs is in the nav', async ({
	page
}) => {
	await signUp(page, 'Gale Groups', uniqueEmail('groups'));
	await createBuild(page, 'Solo chair', null);
	await createChapter(page, 'Group chapter');
	await createBuild(page, 'Shared chair', null);

	await page.goto('/builds');
	await page.waitForLoadState('networkidle');
	const groups = page.getByTestId('builds-group');
	await expect(groups).toHaveCount(2);
	await expect(groups.nth(0)).toContainText('Group chapter');
	await expect(groups.nth(0)).toContainText('Shared chair');
	await expect(groups.nth(1)).toContainText('My builds');
	await expect(groups.nth(1)).toContainText('Solo chair');
	await page.screenshot({ path: `${SHOTS}/all-builds-1440-light.png` });

	await page.getByTestId('builds-menu').click();
	await page.getByTestId('all-builds').click();
	await expect(page).toHaveURL(/\/builds$/);
	await expect(page.getByTestId('builds-menu')).toHaveClass(/\bon\b/);
	await page.getByTestId('nav-designs').click();
	await expect(page).toHaveURL(/\/designs/);
	await expect(page.getByTestId('nav-designs')).toHaveAttribute('aria-current', 'page');
});

test('Finish folds steps that were done when the page opened', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'fold');
	await page.goto(`/builds/${buildId}/finish`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('toggle-done-steps')).toHaveCount(0);
	const step = page.locator('.astep').first();
	const key = await step.getAttribute('data-step');
	await step.getByRole('button', { name: 'Mark step done' }).click();
	// Still there right after the tap, so the tap visibly worked.
	await expect(step).toHaveAttribute('data-done', 'true');
	await page.reload();
	await page.waitForLoadState('networkidle');
	const toggle = page.getByTestId('toggle-done-steps');
	await expect(toggle).toHaveText('Show 1 completed step');
	await expect(page.locator(`.astep[data-step="${key}"]`)).toHaveCount(0);
	await toggle.click();
	await expect(toggle).toHaveText('Hide completed steps');
	await expect(page.locator(`.astep[data-step="${key}"]`)).toBeVisible();
});

// Screenshots of the shell across sizes and themes: SHELL_SHOTS=1 npx playwright test shell
test('screenshots: builds list, Overview, Print, error, toast', async ({ page }) => {
	test.skip(!process.env.SHELL_SHOTS, 'set SHELL_SHOTS=1 to take screenshots');
	test.setTimeout(240_000);
	const { buildId, chapterUrl } = await ownerWithBuild(page, 'shots');
	const sizes: [number, number][] = [
		[390, 844],
		[360, 800],
		[1440, 900],
		[1920, 1080],
		[2560, 1440]
	];
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const [w, h] of sizes) {
			if (scheme === 'dark' && w === 360) continue;
			await page.setViewportSize({ width: w, height: h });
			const tag = `${w}-${scheme}`;
			for (const [name, url] of [
				['builds', chapterUrl],
				['all-builds', '/builds'],
				['overview', `/builds/${buildId}`],
				['print', `/builds/${buildId}/print`],
				['finish', `/builds/${buildId}/finish`],
				['error', '/builds/nope']
			]) {
				await page.goto(url);
				await page.waitForLoadState('networkidle');
				await page.screenshot({ path: `${SHOTS}/${name}-${tag}.png` });
			}
		}
	}
	// A toast on Print (phone and desktop).
	for (const [w, h] of [
		[390, 844],
		[1440, 900]
	]) {
		await page.setViewportSize({ width: w, height: h });
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto(`/builds/${buildId}/print`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Printed', exact: true }).first().click();
		await expect(page.locator('.toast').first()).toBeVisible();
		await page.screenshot({ path: `${SHOTS}/toast-${w}-light.png` });
		await page.locator('.toast-x').first().click();
	}
});

// ---- Stage 2 wave B ----
const SHOTS_B = '.playwright-mcp/stage2b-app-shell';

test('invites default to editor, copy the link, and removing a member asks first', async ({
	page,
	browser,
	context
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
	const { chapterUrl } = await ownerWithBuild(page, 'invites');
	await page.goto(chapterUrl);
	await page.getByRole('link', { name: 'Members', exact: true }).click();
	await page.waitForLoadState('networkidle');
	await expect(page.locator('form[action="?/invite"]').getByLabel('Role')).toHaveValue('editor');
	await page.screenshot({ path: `${SHOTS_B}/invite-form-${page.viewportSize()!.width}.png` });

	const email = uniqueEmail('invitee');
	const link = await invite(page, email, 'editor');
	await page.getByTestId('copy-invite').click();
	await expect(page.getByTestId('copy-invite')).toHaveText('Copied');
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
	await page.screenshot({ path: `${SHOTS_B}/invite-copied-${page.viewportSize()!.width}.png` });

	const joined = await joinViaInvite(browser, link, 'Ed Editor', email);
	await joined.context.close();
	await page.reload();
	const row = page.locator('li.tpl', { hasText: 'Ed Editor' });
	await row.getByTestId('remove-member').click();
	const dlg = page.getByTestId('remove-member-dialog');
	await expect(dlg).toContainText('Remove Ed Editor?');
	await page.screenshot({ path: `${SHOTS_B}/remove-member-${page.viewportSize()!.width}.png` });
	await dlg.getByRole('button', { name: 'Cancel' }).click();
	await expect(dlg).toHaveCount(0);
	await expect(row).toHaveCount(1);
	await row.getByTestId('remove-member').click();
	await page.getByTestId('confirm-remove-member').click();
	await expect(page.locator('li.tpl', { hasText: 'Ed Editor' })).toHaveCount(0);
});

test('wizard: Continue is blocked on Files until a printer is chosen', async ({ page }) => {
	await signUp(page, 'Wanda Wizard', uniqueEmail('wizard-block'));
	await startBuild(page, 'Blocked chair');
	await toSetupStep(page, 4);
	await expect(page.getByTestId('wizard-next')).toBeDisabled();
	await expect(page.getByTestId('wizard-blocker')).toContainText('Choose your printer');
	await expect(page.getByTestId('setup-step-5')).toBeDisabled();
	// Asking for the Export step by URL lands on Files.
	await page.goto(page.url().replace(/step=4/, 'step=5'));
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('wizard-blocker')).toBeVisible();
	await page.screenshot({ path: `${SHOTS_B}/wizard-blocked-${page.viewportSize()!.width}.png` });
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-preset-256x256').click();
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toContainText('Arranged for');
	await expect(page.getByTestId('wizard-blocker')).toHaveCount(0);
	await expect(page.getByTestId('wizard-next')).toBeEnabled();
});

test('a build started from a design goes through the setup wizard', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'design-wizard');
	const saved = await page.request.post('/api/designs', {
		data: { buildId, name: `Wizard design ${Date.now().toString(36)}` }
	});
	expect(saved.ok()).toBe(true);
	const { id: designId } = (await saved.json()) as { id: string };
	const view0 = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		build: { organizationId: string; templateId: string };
	};
	const res = await page.request.post('/api/builds', {
		data: {
			organizationId: view0.build.organizationId,
			templateId: view0.build.templateId,
			designId,
			name: 'From a design'
		}
	});
	expect(res.ok()).toBe(true);
	const { id } = (await res.json()) as { id: string };
	const view = (await (await page.request.get(`/api/builds/${id}/view`)).json()) as {
		build: { setupStep: number | null };
	};
	// Colors come from the design, so the wizard starts at Options or Files, not Template.
	expect([2, 4]).toContain(view.build.setupStep);
	await page.goto(`/builds/${id}/setup`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('setup-wizard')).toBeVisible();
	await expect(page.getByTestId('setup-step-1')).toHaveClass(/done/);
});

test('Settings: spools fit their card, colors point to Design, the prototype import is admin-only', async ({
	page,
	browser
}) => {
	const adminCtx = await newClientContext(browser);
	const adminPage = await adminCtx.newPage();
	await signInAsAdmin(adminPage);
	await adminCtx.close();

	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'settings');
	await page.goto(`/builds/${buildId}/settings`);
	await page.waitForLoadState('networkidle');
	await expect(
		page.getByRole('heading', { name: 'Import from the original prototype' })
	).toHaveCount(0);
	await expect(page.getByTestId('change-colors')).toBeVisible();
	const bad = await page.evaluate(() => {
		const card = document
			.querySelector('[data-testid="settings-filament"]')!
			.getBoundingClientRect();
		return [...document.querySelectorAll('[data-testid="settings-filament"] input')].filter(
			(i) => i.getBoundingClientRect().right > card.right + 0.5
		).length;
	});
	expect(bad).toBe(0);
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await page.screenshot({ path: `${SHOTS_B}/settings-1440-${scheme}.png`, fullPage: true });
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: `${SHOTS_B}/settings-390-dark.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.screenshot({ path: `${SHOTS_B}/settings-390-light.png`, fullPage: true });
});

test.describe('toast on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test('sits just above the bottom bar, never over it or the build header', async ({ page }) => {
		const { buildId } = await ownerWithBuild(page, 'toast');
		await page.goto(`/builds/${buildId}/print`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Printed', exact: true }).first().click();
		const toast = page.locator('.toast').first();
		await expect(toast).toBeVisible();
		const m = await page.evaluate(() => {
			const t = document.querySelector('.toast')!.getBoundingClientRect();
			const bar = document.querySelector('nav.tabs[data-bottom] .tb-in')!.getBoundingClientRect();
			const head = document.querySelector('header.head')!.getBoundingClientRect();
			return { toastTop: t.top, toastBottom: t.bottom, barTop: bar.top, headBottom: head.bottom };
		});
		expect(m.toastBottom).toBeLessThanOrEqual(m.barTop);
		expect(m.toastBottom).toBeGreaterThan(m.barTop - 24);
		expect(m.toastTop).toBeGreaterThan(m.headBottom);
		await page.screenshot({ path: `${SHOTS_B}/toast-390-light.png` });
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.screenshot({ path: `${SHOTS_B}/toast-390-dark.png` });
	});
});
