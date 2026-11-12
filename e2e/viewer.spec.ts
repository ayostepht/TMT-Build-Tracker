import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';

test('a viewer sees the build read-only and the API refuses their writes', async ({
	page,
	browser
}) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'viewer');
	await page.goto(chapterUrl);
	const email = uniqueEmail('viewer');
	const link = await invite(page, email, 'viewer');
	const viewer = await joinViaInvite(browser, link, 'Vera Viewer', email);

	const vp = viewer.page;
	// Invited users also get a personal workspace of their own.
	await expect(
		vp.getByRole('combobox', { name: 'Chapter' }).locator('option', { hasText: 'My builds' })
	).toHaveCount(1);
	await vp.goto(`/builds/${buildId}/print`);
	await expect(vp.getByRole('note')).toContainText('view-only access');
	await expect(vp.locator('.sync')).toContainText('read only');

	const first = vp.locator('.row').first();
	const slug = (await first.getAttribute('data-id')) as string;
	const name = (await first.locator('.pbtn').innerText()).trim();
	// A viewer sees the status as a plain badge: no button, no menu.
	const badge = first.getByTestId('part-status');
	await expect(badge).toBeVisible();
	expect(await badge.evaluate((el) => el.tagName)).toBe('SPAN');
	await expect(badge).toHaveAttribute('data-status', /.+/);
	await expect(first.getByTestId('status-menu')).toHaveCount(0);

	await first.getByRole('button', { name: `Details for ${name}` }).click();
	await expect(first.getByText('Print log')).toBeVisible();
	await expect(vp.getByRole('button', { name: 'Log print' })).toHaveCount(0);

	const res = await vp.evaluate(
		async ({ buildId, slug }) => {
			const r = await fetch(`/api/builds/${buildId}/parts/${slug}/status`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status: 'Printing' })
			});
			return r.status;
		},
		{ buildId, slug }
	);
	expect(res).toBe(403);

	// Reads still work.
	const read = await vp.evaluate(
		async (id) => (await fetch(`/api/builds/${id}/view`)).status,
		buildId
	);
	expect(read).toBe(200);

	await viewer.context.close();
});
