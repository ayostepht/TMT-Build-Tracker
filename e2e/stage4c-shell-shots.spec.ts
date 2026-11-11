import { test, newClientContext } from './fixtures';
import { ownerWithBuild, invite, signInAsAdmin } from './helpers';

// Visual guard for the Stage 4 third design-system wave (app shell). Runs only with
// STAGE4C_SHOTS=1; files land in the gitignored .playwright-mcp/stage4c-app-shell/.
const ON = !!process.env.STAGE4C_SHOTS;
const DIR = '.playwright-mcp/stage4c-app-shell';
test.skip(!ON, 'set STAGE4C_SHOTS=1');

const SIZES = [
	{ w: 390, h: 844 },
	{ w: 1440, h: 900 }
];
const PNG_64 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

test('stage 4c shell screenshots', async ({ page }) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId, chapterUrl } = await ownerWithBuild(page, 's4c');
	await page.goto(chapterUrl);
	await invite(page, 'pending-s4c@example.com', 'editor');
	await page.goto(`/builds/${buildId}/finish`);
	await page.waitForLoadState('networkidle');
	await page
		.locator('#photos')
		.getByTestId('photo-input')
		.setInputFiles({ name: 'chair.png', mimeType: 'image/png', buffer: PNG_64 });
	await page.locator('.gallery .thumb').waitFor();

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of SIZES) {
			await page.setViewportSize({ width: w, height: h });
			const shot = async (name: string, full = true) => {
				await page.waitForTimeout(350);
				await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png`, fullPage: full });
			};
			for (const [name, path] of [
				['landing', chapterUrl],
				['members', `${chapterUrl}/members`],
				['team-builds', chapterUrl],
				['builds-list', '/builds'],
				['overview', `/builds/${buildId}`],
				['setup1-template', `/builds/${buildId}/setup?step=1`],
				['assembly', `/builds/${buildId}/finish#assembly`]
			] as const) {
				await page.goto(path);
				await page.waitForLoadState('networkidle');
				await shot(name);
			}
			// guide viewer (opened from the print toolbar)
			await page.goto(`/builds/${buildId}/print`);
			await page.waitForLoadState('networkidle');
			const guide = page.locator('.ptb-guide');
			if (await guide.count()) {
				await guide.first().click();
				await page.getByRole('dialog').waitFor();
				await shot('guide-viewer', false);
				await page.keyboard.press('Escape');
			}
			// photo viewer, then the delete question over it
			await page.goto(`/builds/${buildId}/finish`);
			await page.waitForLoadState('networkidle');
			await page.locator('.gallery .thumb').click();
			await shot('photo-viewer', false);
			await page.getByRole('button', { name: 'Delete' }).click();
			await shot('photo-ask-over-viewer', false);
			await page.keyboard.press('Escape');
			await page.keyboard.press('Escape');
			// member removal dialog
			await page.goto(`${chapterUrl}/members`);
			await page.waitForLoadState('networkidle');
			// account delete dialog
			await page.goto('/account');
			await page.waitForLoadState('networkidle');
			await page.getByTestId('delete-account-open').click();
			await shot('account-delete-dialog', false);
			await page.keyboard.press('Escape');
		}
	}
});

test('stage 4c admin screenshots', async ({ browser }) => {
	test.setTimeout(120_000);
	const context = await newClientContext(browser);
	const page = await context.newPage();
	await signInAsAdmin(page);
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of SIZES) {
			await page.setViewportSize({ width: w, height: h });
			await page.goto('/admin/templates');
			await page.waitForLoadState('networkidle');
			await page.waitForTimeout(350);
			await page.screenshot({ path: `${DIR}/admin-${w}-${scheme}.png`, fullPage: true });
		}
	}
});
