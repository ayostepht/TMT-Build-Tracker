import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

test('swatch picker: opens inside the panel, one tab stop for the swatches, arrow keys, color families', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'pickerpane');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	// Inside the right pane: the slot list is replaced, not covered.
	await expect(page.locator('.panel [data-testid="swatch-picker"]')).toHaveCount(1);
	await expect(page.locator('li.slot').first()).toBeHidden();
	await expect(picker.getByRole('heading', { name: /Primary PETG/ })).toBeVisible();
	// No "My filaments 0" before the user has any.
	await expect(picker.getByTestId('my-filaments')).toHaveCount(0);
	// Neutrals are folded away until asked.
	const neutrals = picker.getByTestId('neutrals-toggle');
	await expect(neutrals).toHaveAttribute('aria-expanded', 'false');
	// The swatch grid is a single tab stop.
	const stops = await picker
		.locator('button.sw')
		.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length);
	expect(stops).toBe(1);
	// Arrow keys move between swatches and the tab stop follows.
	const first = picker.locator('button.sw').first();
	await first.focus();
	await page.keyboard.press('ArrowRight');
	await expect(picker.locator('button.sw').nth(1)).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(picker.locator('button.sw:focus')).toHaveCount(1);
	await page.keyboard.press('Home');
	await expect(first).toBeFocused();
	// The color-family filter narrows the list.
	await picker.getByLabel('Color family').selectOption('red');
	await expect(picker.getByRole('region', { name: 'Reds' })).toBeVisible();
	await expect(picker.getByRole('region', { name: 'Blues' })).toHaveCount(0);
	await picker.getByLabel('Color family').selectOption('');
	await neutrals.click();
	await expect(neutrals).toHaveAttribute('aria-expanded', 'true');
	await expect(picker.getByRole('region', { name: 'Whites, grays and blacks' })).toBeVisible();
	// Done returns to the slot list.
	await picker.getByRole('button', { name: 'Done' }).click();
	await expect(picker).toHaveCount(0);
	await expect(page.locator('li.slot').first()).toBeVisible();
});

test('swatch picker: Schoolhouse colors say they are approximate', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'pickerapprox');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await picker.getByLabel('Search colors').fill('schoolhouse');
	await picker.getByTestId('swatch').first().focus();
	await expect(picker.getByTestId('swatch-approx')).toContainText(/approx/i);
	await picker.getByLabel('Search colors').fill('overture');
	await picker.getByTestId('swatch').first().focus();
	await expect(picker.getByTestId('swatch-approx')).toHaveCount(0);
});

test('swatch picker on a phone sits under the pinned chair', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'pickerphone');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	const box = await picker.boundingBox();
	const stage = await page.locator('.stagebox').boundingBox();
	expect(box!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height - 1);
	// Touch targets are at least 44 px.
	const sw = await picker.locator('button.sw').first().boundingBox();
	expect(sw!.width).toBeGreaterThanOrEqual(44);
	const scroll = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(scroll).toBeLessThanOrEqual(0);
});

for (const [w, scheme] of [
	[390, 'light'],
	[360, 'dark'],
	[390, 'dark']
] as const) {
	test(`phone picker fits its card, one filter row, shorter chair at ${w}px ${scheme}`, async ({
		page
	}) => {
		await page.setViewportSize({ width: w, height: 844 });
		await page.emulateMedia({ colorScheme: scheme });
		const { buildId } = await ownerWithBuild(page, `pickfit${w}${scheme}`);
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('tab', { name: 'Colors' }).click();
		const stageClosed = (await page.locator('.stagebox').boundingBox())!.height;
		await page
			.locator('li.slot[data-role="primary"]')
			.getByRole('button', { name: /^Change filament for/ })
			.first()
			.click();
		const picker = page.getByTestId('swatch-picker');
		await expect(picker).toBeVisible();
		await expect(picker.getByTestId('swatch').first()).toBeVisible();
		await page.waitForTimeout(400);
		const shots = process.env.R48_SHOTS ? 'data/r48-shots-design' : '';
		const shot = (n: string) =>
			shots ? page.screenshot({ path: `${shots}/${n}-${w}-${scheme}.png` }) : Promise.resolve();
		await shot('top');

		// Shorter chair while picking, about 30% of the screen.
		const stageOpen = (await page.locator('.stagebox').boundingBox())!.height;
		expect(stageOpen).toBeLessThan(stageClosed);
		expect(stageOpen).toBeLessThanOrEqual(844 * 0.31);

		// Brand chips are replaced by one select; the filter row is a single line that fits.
		await expect(picker.getByRole('group', { name: 'Brands' })).toBeHidden();
		const row = await picker.getByRole('group', { name: 'Filters' }).evaluate((el) => {
			const r = el.getBoundingClientRect();
			const kids = [...el.children]
				.filter((c) => getComputedStyle(c).display !== 'none')
				.map((c) => c.getBoundingClientRect());
			return {
				right: r.right,
				kids: kids.length,
				top: Math.min(...kids.map((k) => k.top)),
				maxTop: Math.max(...kids.map((k) => k.top)),
				maxRight: Math.max(...kids.map((k) => k.right)),
				minH: Math.min(...kids.map((k) => k.height))
			};
		});
		expect(row.kids).toBeGreaterThanOrEqual(2);
		expect(row.maxTop - row.top).toBeLessThan(2);
		expect(row.maxRight).toBeLessThanOrEqual(row.right + 1);
		expect(row.minH).toBeGreaterThanOrEqual(43.5);

		// At least two swatch rows are visible without scrolling.
		const rowsSeen = await picker.locator('button.sw').evaluateAll((els) => {
			const tops = new Set<number>();
			for (const e of els) {
				const r = e.getBoundingClientRect();
				if (r.top >= 0 && r.bottom <= window.innerHeight) tops.add(Math.round(r.top));
			}
			return tops.size;
		});
		expect(rowsSeen).toBeGreaterThanOrEqual(2);

		// Brand select: popular and more groups; picking one filters.
		const sel = picker.getByLabel('Brand', { exact: true });
		await expect(sel.locator('optgroup')).toHaveCount(2);
		await expect(sel.locator('optgroup').first()).toHaveAttribute('label', 'Popular');

		// Scroll to the end: every descendant lies within the card, the footer is below it.
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(250);
		await shot('end');
		const fit = await picker.evaluate((el) => {
			const c = el.getBoundingClientRect();
			let bad = 0;
			for (const d of el.querySelectorAll('*')) {
				const r = d.getBoundingClientRect();
				if (!r.width && !r.height) continue;
				// The notes line is one clipped line (ellipsis, full text in its title): its spans may run on.
				if (d.parentElement?.closest('.extras')) continue;
				if (r.bottom > c.bottom + 1 || r.top < c.top - 1 || r.right > c.right + 1) bad++;
			}
			const foot = document.querySelector('footer');
			return {
				bad,
				footerAbove: foot ? foot.getBoundingClientRect().top < c.bottom - 1 : false,
				sx: document.documentElement.scrollWidth - document.documentElement.clientWidth
			};
		});
		expect(fit.bad).toBe(0);
		expect(fit.footerAbove).toBe(false);
		expect(fit.sx).toBeLessThanOrEqual(0);

		// Closing brings the chair back to its normal height.
		await picker.getByRole('button', { name: 'Done' }).click();
		await page.waitForTimeout(400);
		expect(
			Math.abs((await page.locator('.stagebox').boundingBox())!.height - stageClosed)
		).toBeLessThan(2);
	});
}

test('desktop picker keeps the brand chips and hides the phone Brand select', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId } = await ownerWithBuild(page, 'pickdesk');
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.click();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker.getByRole('group', { name: 'Brands' })).toBeVisible();
	await expect(picker.getByTestId('brand-select')).toBeHidden();
	if (process.env.R48_SHOTS)
		await page.screenshot({ path: 'data/r48-shots-design/top-1440-light.png' });
});

// Regression: hovering (or focusing) a swatch whose detail row has an extra note line, or that
// shows the "Other brands" disclosure, used to make the row above the grid taller. The grid slid
// out from under the pointer and the mouse click never landed. The row now reserves its height.
// At 390 px there is no hover on a phone, so the preview is driven by keyboard focus (the
// component treats focus without a preceding touch pointerdown as the preview); the final pick
// is still a real mouse click.
for (const width of [1440, 390]) {
	test(`swatch picker: hovering swatches never moves the grid, the click lands (${width}px)`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const { buildId } = await ownerWithBuild(page, `pickerstable${width}`);
		await page.goto(`/builds/${buildId}/design`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('tab', { name: 'Colors' }).click();
		await page.getByRole('button', { name: 'Add a color' }).click();
		await page.getByRole('button', { name: /^TPU/ }).click();
		const picker = page.getByTestId('swatch-picker');
		await expect(picker).toBeVisible();
		const search = picker.getByLabel('Search colors');
		await search.fill('black');

		const swatches = picker.getByTestId('swatch');
		const detail = picker.getByTestId('swatch-detail');
		const top = () =>
			picker.locator('.body').evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
		const preview = async (sw: ReturnType<typeof swatches.first>) => {
			await sw.scrollIntoViewIfNeeded();
			if (width >= 1000) await sw.hover();
			else await sw.focus();
			await expect(detail).not.toContainText('Pick a swatch');
		};

		await expect(swatches.first()).toBeVisible();
		let notUsed = swatches.and(page.locator('[aria-label*="not used by palettes"]'));
		if ((await notUsed.count()) === 0) {
			// Swatches palettes never use are folded away until the Type filter says "all types".
			await picker.getByTestId('type-select').selectOption('all');
			notUsed = swatches.and(page.locator('[aria-label*="not used by palettes"]'));
		}
		const normal = swatches
			.and(page.locator(':not([aria-label*="approximate"]):not([aria-label*="not used"])'))
			.first();
		const approx = swatches.and(page.locator('[aria-label*="approximate"]')).first();
		const skipped = notUsed.first();
		if ((await approx.count()) === 0 || (await skipped.count()) === 0) {
			test.skip(true, 'bundled catalog has no approximate / not-used TPU black swatch');
			return;
		}

		await preview(normal);
		const baseTop = await top();
		const baseHeight = (await detail.boundingBox())!.height;
		for (const sw of [approx, skipped, normal, approx]) {
			await preview(sw);
			expect(await top()).toBe(baseTop);
			expect((await detail.boundingBox())!.height).toBe(baseHeight);
		}
		await expect(detail.getByTestId('swatch-approx')).toBeVisible();

		// A merged swatch with the "Other brands" disclosure reserves its line too.
		await search.fill('');
		const merged = swatches.and(page.locator('[aria-label*="other brand"]')).first();
		if ((await merged.count()) === 0) {
			test.skip(true, 'bundled catalog has no merged "other brands" TPU swatch');
			return;
		}
		// The detail row has one fixed height in every view, so it also equals the first view's.
		await preview(normal);
		const before = await top();
		expect((await detail.boundingBox())!.height).toBe(baseHeight);
		await preview(merged);
		// The disclosure is an overlay over the grid's top (zero-height host), so its summary is what shows.
		await expect(picker.getByTestId('other-brands').locator('summary')).toBeVisible();
		expect(await top()).toBe(before);
		expect((await detail.boundingBox())!.height).toBe(baseHeight);

		// A real mouse click on the approximate swatch lands and closes the picker.
		await search.fill('black');
		await preview(approx);
		const box = (await approx.boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(picker).toHaveCount(0);
	});
}
