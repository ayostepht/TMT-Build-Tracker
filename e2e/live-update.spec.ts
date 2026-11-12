import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail, row } from './helpers';
import { chooseStatus } from './status-helpers';

test('an editor change shows up on the owner page without a reload', async ({ page, browser }) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'live');
	const buildUrl = page.url();

	await page.goto(chapterUrl);
	const email = uniqueEmail('editor');
	const link = await invite(page, email, 'editor');
	const editor = await joinViaInvite(browser, link, 'Eddie Editor', email);

	await page.goto(buildUrl);
	const header = page.locator('.overall-top');
	await expect(header).toContainText('0 printing');
	await expect(page.locator('.sync')).toContainText('Live');
	// Tag the page so a reload would be noticed.
	await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));

	await editor.page.goto(`/builds/${buildId}/print`);
	const first = editor.page.locator('.row').first();
	const slug = (await first.getAttribute('data-id')) as string;
	await chooseStatus(row(editor.page, slug).getByTestId('part-status'), 'Printing');
	await expect(row(editor.page, slug)).toHaveAttribute('data-s', 'Printing');

	await expect(header).toContainText('1 printing');
	await expect(page.locator('.activity')).toContainText('Eddie Editor set');
	expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);

	await editor.context.close();
});
