import { expect, test } from './fixtures';
import { ownerWithBuild, openNav } from './helpers';
import type { Page } from '@playwright/test';

// Shell accessibility guard (no axe dependency): landmarks, headings, skip link, accessible
// names, top-bar menu behaviour and dialog focus handling, at phone and desktop widths.
const SHOTS = '.playwright-mcp/stage4-app-shell';

/** Roughly the accessible name: aria-label, labelledby, visible text, title, associated label. */
async function unnamed(page: Page, scope: string): Promise<string[]> {
	return page.evaluate((sel) => {
		const out: string[] = [];
		const nameOf = (el: Element): string => {
			const al = el.getAttribute('aria-label');
			if (al?.trim()) return al.trim();
			const by = el.getAttribute('aria-labelledby');
			if (by) {
				const t = by
					.split(/\s+/)
					.map((id) => document.getElementById(id)?.textContent ?? '')
					.join(' ')
					.trim();
				if (t) return t;
			}
			if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
				const l = (el.labels ?? [])[0]?.textContent?.trim();
				if (l) return l;
			}
			const txt = (el as HTMLElement).innerText?.trim() || el.textContent?.trim();
			if (txt) return txt;
			return el.getAttribute('title')?.trim() ?? '';
		};
		for (const root of document.querySelectorAll(sel)) {
			for (const el of root.querySelectorAll('button, a[href], select, input:not([type=hidden])')) {
				if (!nameOf(el)) out.push(`${el.tagName.toLowerCase()}.${el.className}`);
			}
		}
		return out;
	}, scope);
}

for (const [width, height] of [
	[390, 844],
	[1440, 900]
] as const) {
	test.describe(`shell a11y at ${width}px`, () => {
		test.use({ viewport: { width, height } });

		test('landmarks, one h1, skip link, names, menus, dialog', async ({ page }) => {
			test.setTimeout(150_000);
			const { buildId } = await ownerWithBuild(page, 'a11y');

			// One <main> and one <h1> on every main route, with a distinct title.
			const titles = new Map<string, string>();
			for (const path of [
				'/',
				`/builds/${buildId}`,
				`/builds/${buildId}/design`,
				`/builds/${buildId}/print`,
				`/builds/${buildId}/files`,
				`/builds/${buildId}/finish`,
				`/builds/${buildId}/settings`,
				'/builds',
				'/designs',
				'/studio',
				'/account',
				'/onboarding'
			]) {
				await page.goto(path);
				await page.waitForLoadState('networkidle');
				await expect(page.locator('main'), path).toHaveCount(1);
				await expect(page.locator('main#main'), path).toHaveCount(1);
				await expect(page.locator('h1:visible'), path).toHaveCount(1);
				const t = await page.title();
				expect(t, `${path} title`).not.toBe('TMT Build Tracker');
				const clash = titles.get(t);
				// Tabs of one build and its workspace page may share a name; routes must not.
				if (clash) expect(clash, `title ${t} reused by ${path} and ${clash}`).toBe(path);
				titles.set(t, path);
			}

			// Build tab bar: labelled, exactly one aria-current.
			await page.goto(`/builds/${buildId}/files`);
			const tabs = page.getByRole('navigation', { name: 'Build sections' });
			await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
			await expect(tabs.locator('[aria-current="page"]')).toHaveText(/Files/);

			// Names on everything in the top bar and the tab bars.
			await openNav(page);
			expect(await unnamed(page, 'header.topbar, nav')).toEqual([]);

			// Skip link: first focusable, visible on focus, moves focus to main.
			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			await page.keyboard.press('Tab');
			const skip = page.getByRole('link', { name: 'Skip to content' });
			await expect(skip).toBeFocused();
			const box = await skip.boundingBox();
			expect(box && box.y >= 0 && box.y + box.height <= height).toBe(true);
			await page.screenshot({ path: `${SHOTS}/skip-link-${width}.png` });
			await page.keyboard.press('Enter');
			await expect(page.locator('main#main')).toBeFocused();
			// Next Tab lands inside the page content, not the top bar.
			await page.keyboard.press('Tab');
			expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);

			// Tab order of the top bar: skip link, brand, then the rest in DOM order.
			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			await page.keyboard.press('Tab');
			await page.keyboard.press('Tab');
			await expect(page.locator('a.shell-brand')).toBeFocused();

			// Menus: disclosure, Escape closes and returns focus, focus leaving closes.
			await openNav(page);
			const builds = page.getByTestId('builds-menu');
			await builds.click();
			await expect(builds).toHaveAttribute('aria-expanded', 'true');
			await expect(builds).toHaveAttribute('aria-controls', 'menu-builds');
			await expect(page.locator('#menu-builds')).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(builds).toHaveAttribute('aria-expanded', 'false');
			await expect(builds).toBeFocused();
			await builds.click();
			await page.getByTestId('account-menu').focus();
			await expect(builds).toHaveAttribute('aria-expanded', 'false');
			await page.getByTestId('account-menu').click();
			await expect(page.getByTestId('account-menu')).toHaveAttribute('aria-expanded', 'true');
			await page.mouse.click(width - 3, height - 100);
			await expect(page.getByTestId('account-menu')).toHaveAttribute('aria-expanded', 'false');
			if (width < 760) {
				const toggle = page.getByTestId('nav-toggle');
				await openNav(page);
				await page.keyboard.press('Escape');
				await expect(toggle).toHaveAttribute('aria-expanded', 'false');
				await expect(toggle).toBeFocused();
				const box = await toggle.boundingBox();
				expect(box!.width).toBeGreaterThanOrEqual(40);
				expect(box!.height).toBeGreaterThanOrEqual(40);
			}

			// A modal (the shared Dialog): focus moves in, Tab is trapped, Escape closes and
			// focus returns to the trigger.
			await page.goto('/account');
			await page.waitForLoadState('networkidle');
			const open = page.getByTestId('delete-account-open');
			await open.focus();
			await page.keyboard.press('Enter');
			const dlg = page.getByRole('dialog', { name: 'Delete my account' });
			await expect(dlg).toBeVisible();
			expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
			for (let i = 0; i < 12; i++) {
				await page.keyboard.press('Tab');
				expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
			}
			for (let i = 0; i < 12; i++) {
				await page.keyboard.press('Shift+Tab');
				expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
			}
			// The page behind the modal is inert (top bar and the rest of the page), the dialog and
			// the toasts are not; closing the dialog lifts it again.
			await expect(page.locator('header.topbar')).toHaveJSProperty('inert', true);
			// (the dialog sits inside <main>, so it is main's other content that is inert)
			expect(await page.locator('main h1').evaluate((h) => !!h.closest('[inert]'))).toBe(true);
			await expect(dlg).toHaveJSProperty('inert', false);
			expect(await dlg.evaluate((d) => !!d.closest('[inert]'))).toBe(false);
			expect(await page.locator('.toasts').evaluate((d) => !!d.closest('[inert]'))).toBe(false);
			await page.screenshot({ path: `${SHOTS}/dialog-${width}.png` });
			await page.keyboard.press('Escape');
			await expect(dlg).toHaveCount(0);
			await expect(open).toBeFocused();
			await expect(page.locator('[inert]')).toHaveCount(0);

			// Inline confirm (build Settings, delete): Escape cancels and focus returns to the trigger.
			await page.goto(`/builds/${buildId}/settings`);
			await page.waitForLoadState('networkidle');
			const del = page.getByRole('button', { name: 'Delete this build…' });
			await del.click();
			const confirm = page.getByRole('alertdialog');
			await expect(confirm).toBeVisible();
			await expect(confirm.getByLabel('Build name')).toBeFocused();
			await page.keyboard.press('Escape');
			await expect(confirm).toHaveCount(0);
			await expect(del).toBeFocused();
		});
	});
}
