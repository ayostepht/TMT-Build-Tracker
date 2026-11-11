import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

const SHOTS = 'data/shots-use-design';

test('design page: "Use this design" focuses the build name and highlights the card, every click', async ({
	page
}) => {
	const { buildId } = await ownerWithBuild(page, 'usedesign');

	// Save the build's colors as a public design to get a design page.
	await page.goto(`/builds/${buildId}/design`);
	await expect(page.getByTestId('autosave-status')).toContainText('Saved automatically');
	await page.getByTestId('open-share').click();
	const dlg = page.getByTestId('share-dialog');
	await dlg.getByLabel('Design name').fill('Use Me');
	await dlg.getByLabel(/Share publicly/).check();
	await dlg.getByRole('button', { name: 'Save design' }).click();
	await expect(page.getByTestId('design-saved')).toContainText('Saved "Use Me"');
	await page.goto('/designs');
	await page
		.locator('[data-design]', { hasText: 'Use Me' })
		.getByRole('link', { name: 'Use Me' })
		.click();
	await expect(page.getByRole('heading', { level: 1, name: 'Use Me' })).toBeVisible();
	const designUrl = page.url().split('#')[0];

	const card = page.locator('#use');
	const name = page.getByLabel('Build name');
	const btn = page.getByTestId('use-design');
	expect(await btn.evaluate((el) => el.tagName)).toBe('BUTTON');

	async function clickAndCheck() {
		await page.locator('body').click({ position: { x: 1, y: 1 } });
		await btn.click();
		await expect(name).toBeFocused();
		await expect(card).toHaveClass(/flash/);
		await expect(card).toBeInViewport();
		await expect(btn).toBeVisible();
	}

	for (const [w, h, label] of [
		[1440, 900, 'desktop'],
		[390, 844, 'phone']
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
			await page.goto(designUrl);
			await clickAndCheck();
			// Repeat click re-triggers the highlight.
			await expect(card).not.toHaveClass(/flash/, { timeout: 4000 });
			await clickAndCheck();
			await page.waitForTimeout(700); // let the smooth scroll settle, highlight still on
			await page.screenshot({ path: `${SHOTS}/${label}-${scheme}.png` });

			// A URL that already ends in #use: the deep link lands on the card, clicks still respond.
			await page.goto(`${designUrl}#use`);
			await expect(card).toBeInViewport();
			await clickAndCheck();
		}
	}

	// Reduced motion still gives feedback.
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto(`${designUrl}#use`);
	await clickAndCheck();

	// Delete (owner): destructive dialog opens on Cancel, so a stray Enter keeps the design.
	const del = page.getByRole('button', { name: 'Delete design' });
	await del.click();
	const delDlg = page.getByTestId('delete-design-dialog');
	await expect(delDlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(delDlg).toHaveCount(0);
	await expect(del).toBeFocused();
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'Use Me' })).toBeVisible();
});
