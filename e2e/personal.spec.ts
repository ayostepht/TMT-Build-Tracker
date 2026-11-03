import { expect, test } from './fixtures';
import { createBuild, createChapter, signUp, uniqueEmail } from './helpers';

test('sign up lands on My builds, then a build moves to a new chapter', async ({ page }) => {
	await signUp(page, 'Pia Personal', uniqueEmail('personal'));

	// No onboarding: straight to the personal workspace.
	await expect(page).toHaveURL(/\/teams\//);
	await expect(page.getByRole('heading', { level: 1, name: 'My builds' })).toBeVisible();
	await expect(page.getByText('Chapter (owner)')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Invite', exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Want to build with others?' })).toBeVisible();
	// A single workspace and no invitations: no switcher, just a small link.
	await expect(page.getByRole('combobox', { name: 'Workspace' })).toHaveCount(0);
	await expect(
		page.getByRole('banner').getByRole('link', { name: 'Create a chapter' })
	).toBeVisible();

	const buildId = await createBuild(page, 'Solo chair');
	await expect(page.locator('.overall-top')).toContainText('of 33');

	// Settings offers no target yet.
	await page.goto(`/builds/${buildId}/settings`);
	await expect(page.getByRole('heading', { name: 'Move to chapter' })).toBeVisible();
	await expect(page.getByText('You are not part of a chapter yet.')).toBeVisible();

	// Create a chapter from the account menu link; the switcher appears.
	await page.getByRole('banner').getByRole('link', { name: 'Create a chapter' }).click();
	const chapterName = `Pia chapter ${Date.now().toString(36)}`;
	await createChapter(page, chapterName);
	await expect(page.getByRole('combobox', { name: 'Workspace' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();

	// Move the build.
	await page.goto(`/builds/${buildId}/settings`);
	await page.waitForLoadState('networkidle');
	await page
		.locator('section', { hasText: 'Move to chapter' })
		.getByRole('combobox')
		.selectOption({ label: chapterName });
	await page.getByRole('button', { name: 'Move to chapter…' }).click();
	await page.getByRole('button', { name: 'Move build' }).click();
	await expect(page).toHaveURL(/\/teams\//);
	await expect(page.getByRole('heading', { level: 1, name: chapterName })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Solo chair' })).toBeVisible();

	// It is gone from My builds, and the activity log notes the move.
	await page.waitForLoadState('networkidle');
	await page.getByRole('combobox', { name: 'Workspace' }).selectOption({ label: 'My builds' });
	await expect(page.getByRole('heading', { level: 1, name: 'My builds' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Solo chair' })).toHaveCount(0);
	await page.goto(`/builds/${buildId}`);
	await expect(page.locator('.activity')).toContainText(`moved this build to ${chapterName}`);
});
