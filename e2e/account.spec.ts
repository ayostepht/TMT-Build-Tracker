import { readFileSync } from 'node:fs';
import { expect, newClientContext, test } from './fixtures';
import {
	PASSWORD,
	createBuild,
	createChapter,
	invite,
	joinViaInvite,
	signInAsAdmin,
	signUp,
	uniqueEmail
} from './helpers';

// Own users only: nothing shared with other specs is touched.
const SHOTS = process.env.ACCOUNT_SHOTS;

// Needs an empty database (the first account is the site admin): run alone with ACCOUNT_FRESH_DB=1.
test('the last site admin cannot delete the account', async ({ page, browser }) => {
	test.skip(!process.env.ACCOUNT_FRESH_DB, 'needs a fresh database');
	const email = uniqueEmail('first');
	await signUp(page, 'Fiona First', email);
	await page.goto('/account');
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('delete-site-block-card')).toContainText('only account');
	const ctx = await newClientContext(browser);
	const other = await ctx.newPage();
	await signUp(other, 'Sam Second', uniqueEmail('second'));
	await ctx.close();
	await page.goto('/account');
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('delete-site-block-card')).toContainText('only site admin');
	await page.getByTestId('delete-account-open').click();
	await expect(page.getByTestId('delete-site-block')).toContainText('only site admin');
	await expect(page.getByTestId('delete-account-confirm')).toHaveCount(0);
	await expect(page.getByTestId('admin-candidates')).toContainText('Sam Second');
	if (SHOTS)
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.screenshot({ path: `${SHOTS}/handover-dialog-${w}.png` });
		}
	// hand over, then the normal confirmation continues in the same dialog
	await page.getByTestId('admin-search').fill('Sam');
	await page.getByTestId('make-admin').click();
	await expect(page.getByTestId('delete-confirm-email')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('site-admins')).toContainText('Sam Second');
	await expect(page.getByTestId('site-admins')).toContainText('Fiona First');
	if (SHOTS)
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.getByTestId('site-admins').screenshot({ path: `${SHOTS}/site-admins-${w}.png` });
		}
	await page.getByTestId('delete-account-open').click();
	await page.getByTestId('delete-confirm-email').fill(email);
	await page.getByTestId('delete-password').fill(PASSWORD);
	await page.getByTestId('delete-account-confirm').click();
	await expect(page).toHaveURL(/\/login\?notice=deleted/);
});

test('export my data, then delete my account', async ({ page, browser }) => {
	const adminCtx = await browser.newContext({
		extraHTTPHeaders: { 'x-forwarded-for': '10.9.9.9' }
	});
	await signInAsAdmin(await adminCtx.newPage());
	await adminCtx.close();
	const email = uniqueEmail('acct');
	await signUp(page, 'Ada Account', email);
	await createBuild(page, 'Throwaway chair', null);

	await page.getByTestId('account-menu').click();
	await page.getByTestId('account-link').click();
	await expect(page).toHaveURL(/\/account$/);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { level: 1, name: 'Ada Account' })).toBeVisible();

	if (SHOTS) {
		for (const [w, h] of [
			[390, 844],
			[1440, 900]
		] as const) {
			await page.setViewportSize({ width: w, height: h });
			await page.screenshot({ path: `${SHOTS}/account-${w}.png`, fullPage: true });
		}
	}

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-data').click()
	]);
	const path = await download.path();
	const data = JSON.parse(readFileSync(path, 'utf8'));
	expect(data.profile.email).toBe(email);
	expect(data.builds).toHaveLength(1);
	expect(data.builds[0].build.name).toBe('Throwaway chair');

	expect((await page.request.get('/api/account/users')).status()).toBe(403);
	await page.getByTestId('delete-account-open').click();
	const dlg = page.getByTestId('delete-account-dialog');
	await expect(dlg).toBeVisible();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/account-dialog.png` });
	const confirm = page.getByTestId('delete-account-confirm');
	await expect(confirm).toBeDisabled();
	await page.getByTestId('delete-confirm-email').fill(email);
	await page.getByTestId('delete-password').fill('wrong-password-here');
	await confirm.click();
	await expect(page.getByTestId('delete-error')).toContainText('not right');
	await page.getByTestId('delete-password').fill(PASSWORD);
	await confirm.click();
	await expect(page).toHaveURL(/\/login\?notice=deleted/);
	await expect(page.getByText('Your account was deleted.')).toBeVisible();

	// the account is gone: signing in fails
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
});

test('the only owner of a chapter with other members cannot delete the account', async ({
	page,
	browser
}) => {
	await signUp(page, 'Olive Owner', uniqueEmail('sole'));
	await createChapter(page, `Sole ${Date.now().toString(36)}`);
	const joinerEmail = uniqueEmail('joiner');
	const link = await invite(page, joinerEmail, 'viewer');
	const joiner = await joinViaInvite(browser, link, 'Jo Joiner', joinerEmail);
	await joiner.context.close();

	await page.goto('/account');
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('delete-blocked')).toContainText('Make someone else an owner of');
	await page.getByTestId('delete-account-open').click();
	await expect(page.getByTestId('delete-account-confirm')).toBeDisabled();
});
