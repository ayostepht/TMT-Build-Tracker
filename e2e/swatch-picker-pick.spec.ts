import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Regression: on a phone a tap on a swatch must recolor the slot at once and save it, every time
// (twice in a row, from "Recently used", after a palette), and a failed save must show the truth.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openPrimary(page: Page, label: string) {
	const { buildId } = await ownerWithBuild(page, label);
	await page.goto(`/builds/${buildId}/design`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('tab', { name: 'Colors' }).click();
	await page
		.locator('li.slot[data-role="primary"]')
		.getByRole('button', { name: /^Change filament for/ })
		.first()
		.tap();
	const picker = page.getByTestId('swatch-picker');
	await expect(picker).toBeVisible();
	await expect(picker.locator('button.sw').first()).toBeVisible();
	return { buildId, picker };
}

/** The slot's saved hex, read from the server. */
async function savedHex(page: Page, buildId: string, role = 'primary') {
	const r = await page.request.get(`/api/builds/${buildId}/view`);
	const v = await r.json();
	return (v.filaments as { key: string; hex: string }[]).find((f) => f.key === role)?.hex;
}

test('phone: tapping swatches recolors and saves every time, also from Recently used', async ({
	page
}) => {
	const { buildId, picker } = await openPrimary(page, 'pickpick');
	const sw = picker.locator('button.sw');
	const hexOf = async (i: number) =>
		(await sw.nth(i).getAttribute('aria-label'))!.match(/#\w{6}/)![0];
	const tapAndCheck = async (loc: ReturnType<typeof sw.nth>) => {
		const hex = (await loc.getAttribute('aria-label'))!.match(/#\w{6}/)![0];
		await loc.scrollIntoViewIfNeeded();
		await loc.tap();
		await expect(picker.locator('button.sw[aria-pressed="true"]').first()).toHaveAttribute(
			'aria-label',
			new RegExp(hex, 'i')
		);
		await expect.poll(() => savedHex(page, buildId)).toBe(hex.toLowerCase());
	};
	const a = sw.nth(3);
	const b = sw.nth(9);
	expect(await hexOf(3)).not.toBe(await hexOf(9));
	await tapAndCheck(a);
	await tapAndCheck(b);
	// Back to the first one, now listed under "Recently used".
	const recent = picker.getByRole('region', { name: 'Recently used' });
	await expect(recent).toBeVisible();
	await tapAndCheck(recent.locator('button.sw').last());
	await tapAndCheck(recent.locator('button.sw').first());
	// Done only closes; the color stays.
	const hex = await savedHex(page, buildId);
	await picker.getByRole('button', { name: 'Done' }).tap();
	await expect(picker).toHaveCount(0);
	expect(await savedHex(page, buildId)).toBe(hex);
});

test('phone: a failed save puts the slot back and says so', async ({ page }) => {
	const { buildId, picker } = await openPrimary(page, 'pickfail');
	const before = await savedHex(page, buildId);
	await page.route(`**/api/builds/${buildId}/filaments/primary`, (route) =>
		route.fulfill({
			status: 429,
			contentType: 'application/json',
			body: '{"message":"Slow down."}'
		})
	);
	const label = await picker
		.locator('button.sw[aria-pressed="false"]')
		.nth(5)
		.getAttribute('aria-label');
	const target = picker
		.locator('button.sw')
		.and(page.getByLabel(label!, { exact: true }))
		.first();
	await target.scrollIntoViewIfNeeded();
	await target.tap();
	await expect(page.getByRole('alert').filter({ hasText: /\S/ }).first()).toBeVisible();
	// Also next to the picker, where a phone is looking.
	await expect(picker.locator('xpath=..').getByTestId('picker-error')).toBeVisible();
	await expect.poll(() => savedHex(page, buildId)).toBe(before);
	// The failed pick is no longer shown as current.
	await expect(target).toHaveAttribute('aria-pressed', 'false');
	// And the slot can be changed again once saving works.
	await page.unroute(`**/api/builds/${buildId}/filaments/primary`);
	await target.tap();
	await expect(target).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => savedHex(page, buildId)).not.toBe(before);
});

// Screenshots for review: SHOTS_DIR=/some/dir npx playwright test e2e/swatch-picker-pick.spec.ts -g shots
for (const [name, w, h, scheme] of [
	['phone-dark', 390, 844, 'dark'],
	['desktop', 1440, 900, 'light']
] as const) {
	test(`shots: picker after a pick, ${name}`, async ({ page }) => {
		test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR to write screenshots');
		await page.setViewportSize({ width: w, height: h });
		await page.emulateMedia({ colorScheme: scheme });
		const { picker } = await openPrimary(page, `pickshot${w}`);
		const label = await picker
			.locator('button.sw[aria-pressed="false"]')
			.nth(7)
			.getAttribute('aria-label');
		const target = picker
			.locator('button.sw')
			.and(page.getByLabel(label!, { exact: true }))
			.first();
		await target.scrollIntoViewIfNeeded();
		await target.tap();
		await expect(target).toHaveAttribute('aria-pressed', 'true');
		await page.waitForTimeout(800);
		await page.screenshot({ path: `${process.env.SHOTS_DIR}/picker-${name}.png` });
	});
}
