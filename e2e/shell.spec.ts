import { expect, test } from './fixtures';
import {
	createBuild,
	invite,
	joinViaInvite,
	startBuild,
	toSetupStep,
	createChapter,
	openNav,
	ownerWithBuild,
	signUp,
	uniqueEmail
} from './helpers';
import { chooseStatus } from './status-helpers';
import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { gotoIntegrations, openElegooForm } from './integrations-helpers';
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
		await chooseStatus(page.getByTestId('part-status').first(), 'Printed');
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
	const row = page.getByTestId('member-row').filter({ hasText: 'Ed Editor' });
	await row.getByTestId('remove-member').click();
	const dlg = page.getByTestId('remove-member-dialog');
	await expect(dlg).toContainText('Remove Ed Editor?');
	// Destructive dialog: Cancel has focus, so a stray Enter cancels and the member stays.
	await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(dlg).toHaveCount(0);
	await expect(row).toHaveCount(1);
	await expect(row.getByTestId('remove-member')).toBeFocused();
	await row.getByTestId('remove-member').click();
	await page.screenshot({ path: `${SHOTS_B}/remove-member-${page.viewportSize()!.width}.png` });
	await dlg.getByRole('button', { name: 'Cancel' }).click();
	await expect(dlg).toHaveCount(0);
	await expect(row).toHaveCount(1);
	await expect(row.getByTestId('remove-member')).toBeFocused();
	await row.getByTestId('remove-member').click();
	await page.getByTestId('confirm-remove-member').click();
	await expect(page.getByTestId('member-row').filter({ hasText: 'Ed Editor' })).toHaveCount(0);
});

test('wizard: the default MakeGood profile counts as the bed, so Continue works without a printer', async ({
	page
}) => {
	await signUp(page, 'Wanda Wizard', uniqueEmail('wizard-block'));
	await startBuild(page, 'Profile chair');
	await toSetupStep(page, 4);
	await expect(page.getByTestId('layout-name')).toContainText("MakeGood's Bambu X1 / P1 / A1");
	await expect(page.getByTestId('layout-bed')).toContainText('Bambu X1 / P1 / A1 (256 × 256 mm)');
	await expect(page.getByTestId('printer-line')).not.toContainText('No bed chosen yet');
	await expect(page.getByTestId('wizard-blocker')).toHaveCount(0);
	await expect(page.getByTestId('wizard-next')).toBeEnabled();
	await page.screenshot({
		path: `${SHOTS_B}/wizard-profile-bed-${page.viewportSize()!.width}.png`
	});
	// Continue reaches Export, and the wizard can finish.
	await page.getByTestId('wizard-next').click();
	await expect(page.getByTestId('wizard-done')).toBeEnabled();
	await page.getByTestId('wizard-done').click();
	await expect(page.getByTestId('setup-done')).toBeVisible();
	// "Arrange for my bed" still takes a real printer.
	await page.goto(`${page.url().split('?')[0]}?step=4`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('plate-layout').selectOption({ label: 'Arrange for my bed' });
	await page.getByTestId('bed-preset-256x256').click();
	await page.getByTestId('arrange-bed').click();
	await expect(page.getByTestId('layout-name')).toContainText('Arranged for');
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

test('Settings: spools fit their card, colors point to Design', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'settings');
	await page.goto(`/builds/${buildId}/settings`);
	await page.waitForLoadState('networkidle');
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
		await chooseStatus(page.getByTestId('part-status').first(), 'Printed');
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

test('the app mark sits beside the name and the top bar stays one row at 360 px', async ({
	page
}) => {
	test.setTimeout(90_000);
	const { buildId } = await ownerWithBuild(page, 'mark');
	const dir = '.playwright-mcp/stage3-app-shell';
	for (const [w, h] of [
		[360, 844],
		[390, 844],
		[1440, 900]
	] as const) {
		for (const scheme of ['light', 'dark'] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto(`/builds/${buildId}/print`);
			await page.waitForLoadState('networkidle');
			const mark = page.locator('.topbar .app-mark');
			await expect(mark).toBeVisible();
			await expect
				.poll(() => mark.evaluate((i: HTMLImageElement) => i.naturalWidth))
				.toBeGreaterThan(0);
			const m = await page.evaluate(() => {
				const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
				const sel = document.querySelector('.chapter-slot')!.getBoundingClientRect();
				return {
					topbar: r('.topbar').height,
					mark: r('.topbar .app-mark').width,
					brandRight: r('.shell-brand').right,
					slotLeft: sel.left,
					toggleRight: r('.navtoggle').right
				};
			});
			if (w < 760) {
				expect(m.topbar, `one-row top bar at ${w}`).toBeLessThanOrEqual(56);
				expect(m.brandRight).toBeLessThanOrEqual(m.slotLeft + 0.5);
				expect(m.toggleRight).toBeLessThanOrEqual(w);
			}
			expect(m.mark).toBe(w >= 1440 ? 32 : 28);
			const o = await overflow(page);
			expect(o.scroll).toBeLessThanOrEqual(o.client);
			await page.screenshot({
				path: `${dir}/topbar-${w}-${scheme}.png`,
				clip: { x: 0, y: 0, width: w, height: 140 }
			});
		}
	}
});

// r47: footer links and the compact Overview filament list.
test.describe('footer and compact Overview (phone)', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test('footer links resolve and sit above the bottom tab bar', async ({ page }) => {
		const { buildId } = await ownerWithBuild(page, 'footer');
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		const footer = page.getByTestId('app-footer');
		await footer.scrollIntoViewIfNeeded();
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		for (const id of ['footer-help', 'footer-about', 'footer-privacy', 'footer-terms'])
			await expect(page.getByTestId(id)).toBeVisible();
		const m = await page.evaluate(() => ({
			footerBottom: document.querySelector('[data-testid="app-footer"]')!.getBoundingClientRect()
				.bottom,
			barTop: document.querySelector('.tb-in')!.getBoundingClientRect().top,
			linkH: document.querySelector('[data-testid="footer-help"]')!.getBoundingClientRect().height
		}));
		expect(m.footerBottom, 'footer is not under the tab bar').toBeLessThanOrEqual(m.barTop + 0.5);
		expect(m.linkH).toBeGreaterThanOrEqual(44);
		await page.getByTestId('footer-about').click();
		await expect(page).toHaveURL(/\/about$/);
		await page.goBack();
		await page.getByTestId('footer-terms').click();
		await expect(page).toHaveURL(/\/terms$/);
	});

	test('Overview: compact filament rows, spools field opens from the row and saves', async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, 'ovspool');
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');
		const rows = page.getByTestId('filament-tile');
		expect(await rows.count()).toBeGreaterThanOrEqual(2);
		const first = rows.first();
		expect((await first.boundingBox())!.height, 'about two lines').toBeLessThanOrEqual(92);
		const o = await overflow(page);
		expect(o.scroll).toBeLessThanOrEqual(o.client);
		const toggle = first.getByRole('button');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(first.locator('input[type="number"]')).toHaveCount(0);
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		const field = first.locator('input[type="number"]');
		await field.fill('7');
		await field.blur();
		await page.reload();
		await page.waitForLoadState('networkidle');
		await page.getByTestId('filament-tile').first().getByRole('button').click();
		await expect(
			page.getByTestId('filament-tile').first().locator('input[type="number"]')
		).toHaveValue('7');
	});
});

test('Overview on desktop shows the spools field in every filament row', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'ovwide');
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	const rows = page.getByTestId('filament-tile');
	const n = await rows.count();
	expect(n).toBeGreaterThanOrEqual(2);
	for (let i = 0; i < n - 1; i++)
		await expect(rows.nth(i).locator('input[type="number"]')).toBeVisible();
	expect((await rows.first().boundingBox())!.height).toBeLessThanOrEqual(80);
});

test('Help is a top-level item after Printers on phones, 44px tall, current on /help', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await signUp(page, 'Help Nav', uniqueEmail('helpnav390'));
	await openNav(page);
	const labels = await page.locator('nav[aria-label="Main"] > a').allInnerTexts();
	expect(labels.at(-1)).toBe('Help');
	expect(labels.slice(-2, -1)[0]).toMatch(/^Printers/);
	for (const link of await page.locator('nav[aria-label="Main"] .navlink').all())
		expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await expect(page.locator('#menu-account a', { hasText: /^(Help|About)$/ })).toHaveCount(0);
	await page.getByTestId('help-link').click();
	await expect(page).toHaveURL(/\/help$/);
	await openNav(page);
	await expect(page.getByTestId('help-link')).toHaveAttribute('aria-current', 'page');
});

// The bar sits in a max-width container, so the fit follows the bar, not the viewport. A long
// chapter name, a long user name and the live "n printing" indicator must all stay on one row.
test.describe('desktop top bar fit with a printer printing', () => {
	let mock: MockSdcp;
	test.beforeAll(async () => {
		mock = new MockSdcp();
		await mock.start();
	});
	test.afterAll(async () => {
		await mock.stop();
	});

	test('one row at 1024, 1100, 1280, 1440 and 1920 px', async ({ page }) => {
		test.setTimeout(150_000);
		const OUT = 'data/r49-shots-shell';
		await page.setViewportSize({ width: 1440, height: 900 });
		await signUp(page, 'Helpful Maker With Long Name', uniqueEmail('helpfit'));
		await createChapter(page, 'Northern Valley Volunteers Chapter of Makers');
		const chapterPath = new URL(page.url()).pathname.replace(/\/(integrations|printers)$/, '');
		await gotoIntegrations(page, chapterPath);
		await openElegooForm(page);
		await page.getByLabel('Name', { exact: true }).fill('Fit Centauri');
		await page.getByTestId('pf-host').fill('127.0.0.1');
		await page.getByTestId('pf-port').fill(String(mock.port));
		await page.getByTestId('pf-save').click();
		await expect(page.getByTestId('printer-row')).toContainText('Fit Centauri');
		mock.printing('fit.gcode', 30);
		await expect(page.getByTestId('nav-printing')).toBeVisible({ timeout: 20_000 });
		// The indicator keeps its full text in its accessible name at every width.
		await expect(page.getByTestId('nav-printing')).toContainText('1 printing');

		for (const w of [761, 800, 900, 1024, 1100, 1280, 1440, 1920]) {
			await page.setViewportSize({ width: w, height: 800 });
			await page.goto('/help');
			await page.waitForLoadState('networkidle');
			await expect(page.getByTestId('nav-printing')).toBeVisible({ timeout: 20_000 });
			const m = await page.locator('header.topbar').evaluate((el) => {
				const tops: number[] = [];
				for (const c of el.querySelectorAll('.navlink, .shell-brand, .chapter-slot')) {
					const r = c.getBoundingClientRect();
					if (r.width) tops.push(Math.round(r.top));
				}
				return {
					spread: Math.max(...tops) - Math.min(...tops),
					h: el.getBoundingClientRect().height,
					bar: Math.round(el.getBoundingClientRect().width),
					selectW: Math.round(
						el.querySelector('.chapter select')?.getBoundingClientRect().width ?? 0
					),
					sw: document.documentElement.scrollWidth
				};
			});
			if (process.env.R49_SHOTS)
				await page.screenshot({
					path: `${OUT}/topbar-${w}.png`,
					clip: { x: 0, y: 0, width: w, height: 140 }
				});
			if (w >= 1440)
				expect
					.soft(m.selectW, `chapter select uses the spare room at ${w}`)
					.toBeGreaterThanOrEqual(160);
			expect.soft(m.sw, `no sideways scroll at ${w}`).toBeLessThanOrEqual(w);
			expect.soft(m.spread, `one row at ${w} (bar ${m.bar}px)`).toBeLessThanOrEqual(8);
			expect.soft(m.h, `bar height at ${w}`).toBeLessThanOrEqual(64);
		}
		mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	});
});

test('r48 shell shots', async ({ page }) => {
	test.skip(!process.env.R48_SHOTS, 'set R48_SHOTS=1');
	const OUT = 'data/r48-shots-shell';
	await signUp(page, 'Helpful Maker With Long Name', uniqueEmail('r48shots'));
	await createChapter(page, 'Northern Valley Volunteers Chapter of Makers');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/builds');
	await page.waitForLoadState('networkidle');
	await openNav(page);
	await page.screenshot({ path: `${OUT}/phone-menu-390.png` });
	for (const w of [1024, 1280, 1440]) {
		await page.setViewportSize({ width: w, height: 700 });
		await page.goto('/help');
		await page.waitForLoadState('networkidle');
		await page.screenshot({
			path: `${OUT}/topbar-${w}.png`,
			clip: { x: 0, y: 0, width: w, height: 140 }
		});
	}
});

test('r49 Help shots', async ({ page }) => {
	test.skip(!process.env.R49_SHOTS, 'set R49_SHOTS=1');
	await signUp(page, 'Help Shots', uniqueEmail('r49help'));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/help#connect-printer');
	await page.waitForLoadState('networkidle');
	await page.locator('#connect-printer').scrollIntoViewIfNeeded();
	await page.screenshot({ path: 'data/r49-shots-shell/help-connect-390.png', fullPage: false });
	await page
		.locator('#connect-printer')
		.screenshot({ path: 'data/r49-shots-shell/help-connect-section-390.png' });
});
