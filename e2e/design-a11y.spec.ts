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
	await page.getByRole('tab', { name: 'Colors' }).click();

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
	await page.getByRole('tab', { name: 'Colors' }).click();
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

const openPrimaryPicker = async (page: Page) => {
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	return picker;
};

test('screen reader status: picking a swatch and moving a part are announced', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11yannounce');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	const status = page.getByTestId('design-announce');
	await expect(status).toHaveAttribute('role', 'status');
	await expect(status).toHaveText('');

	const picker = await openPrimaryPicker(page);
	await picker.getByTestId('swatch').first().click();
	await expect(status).toHaveText(/is now .+/);
	await picker.getByRole('button', { name: 'Done' }).click();

	await page.getByRole('tab', { name: 'Parts' }).click();
	await page.locator('[data-testid="part-row"][data-slug="wing-left"]').click();
	const sheet = page.getByTestId('part-sheet');
	const target = sheet.locator('.slotbtn:not(.cur):not([disabled])').first();
	const slotName = (await target.locator('.rl').innerText()).trim();
	await target.click();
	await expect(status).toHaveText(
		new RegExp(`moved to ${slotName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
	);
});

test('touch: swatches, part chips and rows, tabs and picker fields are at least 44px', async ({
	browser
}) => {
	test.setTimeout(90_000);
	const context = await browser.newContext({
		viewport: { width: 1024, height: 900 },
		hasTouch: true
	});
	const page = await context.newPage();
	try {
		const { buildId } = await ownerWithBuild(page, 'a11ytouch');
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

		const tooSmall = (loc: import('@playwright/test').Locator, dim: 'width' | 'height' | 'both') =>
			loc.evaluateAll(
				(els, d) =>
					els
						.map((e) => e.getBoundingClientRect())
						.filter((r) => r.width > 0)
						.filter((r) =>
							d === 'both' ? r.width < 43.5 || r.height < 43.5 : r[d as 'width' | 'height'] < 43.5
						)
						.map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`),
				dim
			);

		for (const name of ['Colors', 'Palettes', 'Parts']) {
			const box = await page.getByRole('tab', { name }).boundingBox();
			expect(box!.height, `${name} tab height`).toBeGreaterThanOrEqual(43.5);
		}

		await page.getByRole('tab', { name: 'Parts' }).click();
		expect(await tooSmall(page.locator('.pchip'), 'height')).toEqual([]);
		expect(await tooSmall(page.locator('.prow'), 'height')).toEqual([]);
		await page.getByRole('tab', { name: 'Colors' }).click();

		const picker = await openPrimaryPicker(page);
		const sw = picker.locator('button.sw');
		expect(await sw.count()).toBeGreaterThan(0);
		expect(await tooSmall(sw, 'both')).toEqual([]);
	} finally {
		await context.close();
	}
});

test('swatch picker: keyboard focus ring is a solid outline', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11yring');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	const picker = await openPrimaryPicker(page);
	// Focus a swatch, then move with an arrow key so :focus-visible applies as for a keyboard user.
	await picker.locator('button.sw').first().focus();
	await page.keyboard.press('ArrowRight');
	await expect(picker.locator('button.sw').nth(1)).toBeFocused();
	const ring = await page.evaluate(() => {
		const cs = getComputedStyle(document.activeElement as Element);
		return {
			style: cs.outlineStyle,
			width: parseFloat(cs.outlineWidth),
			cls: (document.activeElement as Element).className
		};
	});
	expect(ring.cls).toContain('sw');
	expect(ring.style).toBe('solid');
	expect(ring.width).toBeGreaterThanOrEqual(2);
});

test('swatch picker: search and selects are styled 16px, 44px-tall fields on a phone', async ({
	browser
}) => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true
	});
	const page = await context.newPage();
	try {
		const { buildId } = await ownerWithBuild(page, 'a11yfields');
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('tab', { name: 'Colors' }).click();
		const picker = await openPrimaryPicker(page);
		const fields = [
			picker.getByLabel('Search colors'),
			picker.getByLabel('Color family'),
			picker.getByLabel('More brands')
		];
		for (const f of fields) {
			await f.scrollIntoViewIfNeeded();
			const m = await f.evaluate((el) => {
				const cs = getComputedStyle(el);
				return {
					label: el.getAttribute('aria-label'),
					radius: parseFloat(cs.borderTopLeftRadius),
					font: parseFloat(cs.fontSize),
					height: el.getBoundingClientRect().height
				};
			});
			expect(m.radius, `${m.label} radius`).toBeGreaterThan(0);
			expect(m.font, `${m.label} font size`).toBeGreaterThanOrEqual(16);
			expect(m.height, `${m.label} height`).toBeGreaterThanOrEqual(43.5);
		}
	} finally {
		await context.close();
	}
});

test('swatch picker: + Add opens the custom filament form', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11yadd');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	const picker = await openPrimaryPicker(page);
	await picker.getByRole('button', { name: 'Add a filament' }).click();
	await expect(picker.getByRole('heading', { name: 'Add a filament' })).toBeVisible();
	await expect(picker.getByTestId('custom-filament-form')).toBeVisible();
});

test('Find a part field has a border distinct from the card divider', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11yborder');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Parts' }).click();
	const field = page.getByLabel('Find a part');
	await expect(field).toBeVisible();
	const { border, line } = await field.evaluate((el) => {
		const probe = document.createElement('div');
		probe.style.borderTop = '1px solid var(--line)';
		document.body.appendChild(probe);
		const line = getComputedStyle(probe).borderTopColor;
		probe.remove();
		return { border: getComputedStyle(el).borderTopColor, line };
	});
	expect(border).not.toBe(line);
});

test('Colors | Palettes | Parts tabs: arrow keys, Home and End move the selection', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'a11ytabs');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	const tab = (n: string) => page.getByRole('tab', { name: n });
	// A fresh build opens on Options, the first tab.
	await expect(tab('Options')).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tab').first()).toHaveText('Options');
	await tab('Options').focus();
	await page.keyboard.press('ArrowRight');
	await expect(tab('Colors')).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowRight');
	await expect(tab('Palettes')).toHaveAttribute('aria-selected', 'true');
	await expect(tab('Palettes')).toBeFocused();
	await page.keyboard.press('End');
	await expect(tab('Parts')).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowLeft');
	await expect(tab('Palettes')).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Home');
	await expect(tab('Options')).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowLeft');
	await expect(tab('Parts')).toHaveAttribute('aria-selected', 'true');
});

/** The chosen option name of every variant group, read from the open radios. */
async function chosenOptions(page: Page): Promise<string[]> {
	return page
		.getByTestId('design-options')
		.locator('fieldset.vc-group')
		.evaluateAll((groups) =>
			groups.map((g) =>
				(
					g.querySelector('input[type="radio"]:checked')?.closest('label')?.querySelector('b')
						?.textContent ?? ''
				).trim()
			)
		);
}

test('design options: first tab, opens on it for a fresh build, controls update the part list', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'dopts');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');

	const opts = page.getByTestId('design-options');
	const optTab = page.getByTestId('design-tab-options');
	await expect(page.getByRole('tab').first()).toHaveAttribute('data-testid', 'design-tab-options');
	await expect(optTab).toHaveAttribute('aria-selected', 'true');
	await expect(opts).toBeVisible();
	await expect(opts).toHaveAttribute('role', 'tabpanel');
	await expect(page.locator('details[data-testid="design-options"]')).toHaveCount(0);

	const radios = opts.getByRole('radio');
	await expect(radios.first()).toBeVisible();
	const chosen = await chosenOptions(page);
	const groupCount = await opts.locator('fieldset.vc-group').count();
	expect(groupCount).toBeGreaterThan(1);
	expect(chosen).toHaveLength(groupCount);
	expect(chosen.every(Boolean)).toBe(true);

	// Choosing the bucket seat swaps the seat parts in the Parts tab, and announces nothing odd.
	await opts.getByRole('radio', { name: /Foaming TPU bucket seat/ }).check();
	expect(await chosenOptions(page)).toContain('Foaming TPU bucket seat');
	await page.getByRole('tab', { name: 'Parts' }).click();
	await expect(opts).toBeHidden();
	await expect(page.locator('[data-testid="part-row"][data-slug="bucket-seat"]')).toHaveCount(1);
	await expect(page.locator('[data-testid="part-row"][data-slug="cushion-top"]')).toHaveCount(0);

	// After a change the designer no longer opens on Options.
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('tab', { name: 'Colors' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tab').first()).toHaveText('Options');
});

test.describe('design options on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test('the four tabs fit the strip and the page does not scroll sideways', async ({ page }) => {
		const { buildId } = await ownerWithBuild(page, 'dopts-t');
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		const strip = page.getByRole('tablist', { name: 'Design panel' });
		await expect(page.getByRole('tab')).toHaveCount(4);
		const m = await strip.evaluate((el) => ({
			sw: el.scrollWidth,
			cw: el.clientWidth,
			page: document.documentElement.scrollWidth,
			vw: window.innerWidth
		}));
		expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
		expect(m.page).toBeLessThanOrEqual(m.vw);
		for (const t of await page.getByRole('tab').all()) {
			const box = await t.boundingBox();
			expect(box!.height).toBeGreaterThanOrEqual(44 - 0.5);
		}
	});

	test('picker filters wrap inside the panel, none is clipped, and the top is not under the viewer', async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, 'dpick-t');
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('tab', { name: 'Colors' }).click();
		await page
			.locator('li.slot[data-role="primary"]')
			.getByRole('button', { name: /^Change filament for/ })
			.first()
			.click();
		const sheet = page.getByTestId('swatch-picker');
		await expect(sheet).toBeVisible();
		await expect(sheet.getByLabel('Color family')).toBeVisible();
		const r = await sheet.evaluate((el) => {
			const sb = el.getBoundingClientRect();
			const f = el.querySelector('.filters') as HTMLElement;
			const items = [...f.querySelectorAll('select, label, button')].map((n) => {
				const b = n.getBoundingClientRect();
				return { l: b.left, r: b.right, h: b.height };
			});
			const stage = document.querySelector('.stagecol')!.getBoundingClientRect();
			const search = (
				el.querySelector('input[type="search"]') as HTMLElement
			).getBoundingClientRect();
			return {
				left: sb.left,
				right: sb.right,
				items,
				fScroll: f.scrollWidth - f.clientWidth,
				stageBottom: stage.bottom,
				searchTop: search.top,
				page: document.documentElement.scrollWidth,
				vw: window.innerWidth
			};
		});
		expect(r.items.length).toBeGreaterThan(1);
		for (const i of r.items) {
			expect(i.r).toBeLessThanOrEqual(r.right + 0.5);
			expect(i.l).toBeGreaterThanOrEqual(r.left - 0.5);
			expect(i.h).toBeGreaterThanOrEqual(44 - 0.5);
		}
		expect(r.fScroll).toBeLessThanOrEqual(1);
		expect(r.page).toBeLessThanOrEqual(r.vw);
		expect(r.searchTop).toBeGreaterThanOrEqual(r.stageBottom - 0.5);
	});
});
