import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import type { Page } from '@playwright/test';

// Stage 4 design-studio accessibility pass: every keyboard stop in the Design tab, the swatch picker
// and the Palettes tab has an accessible name and a visible focus indicator, and Tab order follows
// the visual order (top to bottom within a column).

type Stop = { tag: string; name: string; visible: boolean; top: number; left: number };

async function tabStops(page: Page, scope: string, max = 80): Promise<Stop[]> {
	const stops: Stop[] = [];
	await page
		.locator(scope)
		.first()
		.evaluate((el) => {
			(el as HTMLElement).setAttribute('tabindex', '-1');
			(el as HTMLElement).focus();
		});
	for (let i = 0; i < max; i++) {
		await page.keyboard.press('Tab');
		const s = await page.evaluate((sc) => {
			const el = document.activeElement as HTMLElement | null;
			const root = document.querySelector(sc);
			if (!el || !root || !root.contains(el)) return null;
			const cs = getComputedStyle(el);
			const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
			const shadow = cs.boxShadow !== 'none';
			const label =
				el.getAttribute('aria-label') ||
				(el.getAttribute('aria-labelledby')
					? document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent
					: '') ||
				(el as HTMLInputElement).labels?.[0]?.textContent ||
				el.textContent ||
				el.getAttribute('title') ||
				el.getAttribute('placeholder') ||
				'';
			const r = el.getBoundingClientRect();
			return {
				tag: el.tagName.toLowerCase(),
				name: label.replace(/\s+/g, ' ').trim(),
				visible: outline || shadow,
				top: r.top + window.scrollY,
				left: r.left
			};
		}, scope);
		if (!s) break;
		stops.push(s);
	}
	return stops;
}

function problems(stops: Stop[]): string[] {
	return stops.flatMap((s, i) => [
		...(s.name ? [] : [`stop ${i} <${s.tag}> has no accessible name`]),
		...(s.visible ? [] : [`stop ${i} <${s.tag}> "${s.name}" has no visible focus style`])
	]);
}

test('design tab: every keyboard stop is named, visibly focused and in reading order', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11y');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');

	const colors = await tabStops(page, '[data-testid="design-workspace"]');
	expect(colors.length).toBeGreaterThan(5);
	expect(problems(colors)).toEqual([]);
	// the slot list reads top to bottom
	const change = colors.filter((s) => s.name.startsWith('Change filament for'));
	expect(change.length).toBeGreaterThan(1);
	expect(change.map((s) => s.top)).toEqual([...change.map((s) => s.top)].sort((a, b) => a - b));

	// Swatch picker: opens, one tab stop for the whole swatch grid, everything named.
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	const inPicker = await tabStops(page, '[data-testid="swatch-picker"]', 120);
	expect(problems(inPicker)).toEqual([]);
	await picker.getByRole('button', { name: 'Done' }).click();

	// Palettes tab.
	await page.getByRole('tab', { name: 'Palettes' }).click();
	await page.getByTestId('readymade-toggle').locator('summary').click();
	const pal = await tabStops(page, '[role="tabpanel"]:not([hidden])', 120);
	expect(pal.length).toBeGreaterThan(3);
	expect(problems(pal)).toEqual([]);
});

test('design tab: the part colour is never the only indicator', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'a11yb');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Parts' }).click();
	// each part row names its slot in words next to the swatch
	const row = page.locator('[data-testid="part-row"][data-slug="wing-left"]');
	await expect(row.locator('.slotname')).toHaveText(/\S/);
	// the selected part is announced, not just highlighted
	await row.click();
	await expect(page.locator('[data-testid="part-row"][data-slug="wing-left"]')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
});

test('part chip: non-modal, labelled, Escape closes it and focus returns to the list row', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11yc');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Parts' }).click();
	const row = page.locator('[data-testid="part-row"][data-slug="wing-left"]');
	await row.focus();
	await page.keyboard.press('Enter');
	// Non-modal on purpose: the list stays usable, so focus stays on the row that opened it.
	const sheet = page.getByRole('region', { name: /^Part: / });
	await expect(sheet).toBeVisible();
	await expect(sheet).not.toHaveAttribute('aria-modal', 'true');
	await expect(sheet.getByRole('button', { name: 'Close part details' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(row).toBeFocused();
});

test('3D stage: the part list is a short Tab away (picking in the canvas is mouse/touch only)', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11yd');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Parts' }).click();
	await page.getByTestId('design-workspace').locator('.stage').focus();
	let presses = 0;
	for (; presses < 20; presses++) {
		await page.keyboard.press('Tab');
		const hit = await page.evaluate(
			() => document.activeElement?.getAttribute('data-testid') === 'part-row'
		);
		if (hit) break;
	}
	expect(presses, 'Tab presses from the stage to the first part row').toBeLessThan(15);
});

test('swatch picker: focus moves in, Escape closes it and focus returns to its opener', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11ye');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	const opener = page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first();
	await opener.focus();
	await page.keyboard.press('Enter');
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	await expect(picker).toHaveAttribute('aria-label', /\S/);
	// desktop: ready to type, so focus is already inside the picker
	await expect(picker.getByLabel('Search colors')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(picker).toHaveCount(0);
	await expect(opener).toBeFocused();
});

test('apply-design confirmation: Back is focused first and Escape cancels the confirmation only', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11yf');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('autosave-status')).toContainText('Saved automatically');
	await page.getByTestId('open-share').click();
	const dlg = page.getByTestId('share-dialog');
	await dlg.getByLabel('Design name').fill('A11y Apply');
	await dlg.getByRole('button', { name: 'Save design' }).click();
	await expect(page.getByTestId('design-saved')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dlg).toHaveCount(0);

	await page.getByTestId('open-apply').click();
	await page.getByTestId('apply-design-select').selectOption({ label: 'A11y Apply (mine)' });
	await page.getByRole('button', { name: 'Apply this design…' }).click();
	const confirm = page.getByRole('alertdialog', { name: 'Confirm applying the design' });
	await expect(confirm.getByRole('button', { name: 'Back' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(confirm).toHaveCount(0);
	// the dialog around it is still open
	await expect(page.getByTestId('apply-dialog')).toBeVisible();
});

test('shared dialog: close button is at least 40px and named', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'a11yg');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByTestId('open-share').click();
	const x = page.getByTestId('share-dialog').getByRole('button', { name: 'Close' });
	const box = await x.boundingBox();
	expect(box!.width).toBeGreaterThanOrEqual(40);
	expect(box!.height).toBeGreaterThanOrEqual(40);
});
