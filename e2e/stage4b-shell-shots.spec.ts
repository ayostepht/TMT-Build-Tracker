import { test, newClientContext } from './fixtures';
import { ownerWithBuild, invite, signInAsAdmin } from './helpers';

// Visual regression guard for the Stage 4 second design-system wave (app shell). Runs only with
// STAGE4_SHOTS=before|after; screenshots land in the gitignored .playwright-mcp/stage4b-app-shell/<phase>/.
const PHASE = process.env.STAGE4_SHOTS;
const DIR = `.playwright-mcp/stage4b-app-shell/${PHASE}`;

test.skip(!PHASE, 'set STAGE4_SHOTS=before|after');

const SIZES = [
	{ w: 390, h: 844 },
	{ w: 1440, h: 900 }
];

test('stage 4b shell screenshots', async ({ page, browser }) => {
	test.setTimeout(300_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const paths: [string, string][] = [];

	// signed-out screens first
	const signedOut = ['login', 'signup', 'reset-password', 'no-such-page'];

	const { buildId, chapterUrl } = await ownerWithBuild(page, 's4b');
	const link = await (async () => {
		await page.goto(chapterUrl);
		return invite(page, 'someone-s4b@example.com', 'editor');
	})();
	const inviteContext = await newClientContext(browser);
	const inv = await inviteContext.newPage();
	const invitePath = new URL(link).pathname;

	const authed: [string, string][] = [
		['landing', chapterUrl],
		['members', `${chapterUrl}/members`],
		['integrations', `${chapterUrl}/integrations`],
		['printers', `${chapterUrl}/printers`],
		['builds', '/builds'],
		['builds-new', '/builds/new'],
		['onboarding', '/onboarding'],
		['account', '/account'],
		['overview', `/builds/${buildId}`],
		['assembly', `/builds/${buildId}/assembly`],
		['finish', `/builds/${buildId}/finish`],
		['summary', `/builds/${buildId}/summary`],
		['settings', `/builds/${buildId}/settings`],
		['setup1', `/builds/${buildId}/setup?step=1`],
		['setup2', `/builds/${buildId}/setup?step=2`],
		['setup3', `/builds/${buildId}/setup?step=3`],
		['setup4', `/builds/${buildId}/setup?step=4`],
		['setup5', `/builds/${buildId}/setup?step=5`],
		['files', `/builds/${buildId}/files`],
		['error404', `/builds/zzz-missing`]
	];
	paths.push(...authed);

	// a draft for draft settings
	await page.goto('/studio');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('new-draft').click();
	await page.getByTestId('create-draft').click();
	await page.waitForURL(/\/builds\/([^/]+)\/design/);
	const draftId = new URL(page.url()).pathname.split('/')[2];
	paths.push(['draft-settings', `/builds/${draftId}/settings`]);

	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await inv.emulateMedia({ colorScheme: scheme });
		for (const { w, h } of SIZES) {
			await page.setViewportSize({ width: w, height: h });
			await inv.setViewportSize({ width: w, height: h });
			const shot = async (p: typeof page, name: string) => {
				await p.waitForTimeout(350);
				await p.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png`, fullPage: true });
			};
			await inv.goto(invitePath);
			await inv.waitForLoadState('networkidle');
			await shot(inv, 'invite');
			for (const s of signedOut) {
				await inv.goto(s === 'no-such-page' ? '/zzz-missing' : `/${s}`);
				await inv.waitForLoadState('networkidle');
				await shot(inv, s);
			}
			for (const [name, path] of paths) {
				await page.goto(path);
				await page.waitForLoadState('networkidle');
				await shot(page, name);
			}
			// inline confirms: settings delete + draft settings
			await page.goto(`/builds/${buildId}/settings`);
			await page.waitForLoadState('networkidle');
			const del = page.getByRole('button', { name: /^Delete/ }).first();
			if (await del.count()) {
				await del.click();
				await shot(page, 'settings-confirm');
			}
		}
	}
});

test('stage 4b admin screenshots', async ({ browser }) => {
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
			const first = page.locator('a[href^="/admin/templates/"]').first();
			if (await first.count()) {
				await first.click();
				await page.waitForLoadState('networkidle');
				await page.waitForTimeout(350);
				await page.screenshot({
					path: `${DIR}/admin-template-${w}-${scheme}.png`,
					fullPage: true
				});
			}
		}
	}
});
