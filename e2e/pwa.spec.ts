import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

// Plain http on 127.0.0.1 is a secure context, so the worker registers here like it would on https.

test('manifest is valid and every icon is served as an image', async ({ request }) => {
	const res = await request.get('/manifest.webmanifest');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
	expect(res.headers()['cache-control']).toBe('no-cache');
	const m = await res.json();
	expect(m).toMatchObject({
		name: 'TMT Build Tracker',
		display: 'standalone',
		start_url: '/',
		scope: '/',
		id: '/'
	});
	expect(m.short_name).toBeTruthy();
	expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
	expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
	expect(m.categories.length).toBeGreaterThan(0);
	const purposes = (m.icons as { purpose?: string }[]).map((i) => i.purpose);
	expect(purposes).toContain('maskable');
	const urls = [
		...(m.icons as { src: string }[]).map((i) => i.src),
		'/icons/apple-touch-icon.png',
		'/favicon.svg',
		'/favicon.png'
	];
	for (const u of urls) {
		const r = await request.get(u);
		expect(r.status(), u).toBe(200);
		expect(r.headers()['content-type'], u).toMatch(/^image\//);
	}
});

test('service worker script is revalidated and has no lockdown CSP', async ({ request }) => {
	const res = await request.get('/service-worker.js');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toMatch(/javascript/);
	expect(res.headers()['cache-control']).toBe('no-cache');
	expect(res.headers()['content-security-policy']).toBeUndefined();
});

test('pages link the manifest and icons, and load without console errors', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto('/login');
	await page.waitForLoadState('networkidle');
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
		'href',
		'/manifest.webmanifest'
	);
	await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
	await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
	await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
		'content',
		/viewport-fit=cover/
	);
	await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveCount(1);
	expect(errors).toEqual([]);
});

test('worker precaches the shell, never caches API data, and shows the offline page', async ({
	page,
	context
}) => {
	const { buildId } = await ownerWithBuild(page, 'pwa');
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
	// The worker claims clients when it activates; reload to be sure the page is controlled.
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

	const cached = await page.evaluate(async () => {
		const out: string[] = [];
		for (const k of await caches.keys())
			for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
		return out;
	});
	expect(cached).toContain('/offline.html');
	expect(cached.some((p) => p.startsWith('/_app/immutable/'))).toBe(true);
	expect(cached.some((p) => p.startsWith('/api/'))).toBe(false);
	expect(cached.some((p) => p.startsWith('/builds/'))).toBe(false);

	// Online: a build API call hits the network every time.
	const a = await page.evaluate((id) => fetch(`/api/builds/${id}`).then((r) => r.status), buildId);
	expect(a).toBeLessThan(500);

	await context.setOffline(true);
	// API calls fail as they do without a worker: never answered from a cache.
	const health = await page.evaluate(() =>
		fetch('/api/health').then(
			() => 'served',
			() => 'failed'
		)
	);
	expect(health).toBe('failed');
	const build = await page.evaluate(
		(id) =>
			fetch(`/api/builds/${id}`).then(
				() => 'served',
				() => 'failed'
			),
		buildId
	);
	expect(build).toBe('failed');

	await page.goto(`/builds/${buildId}`).catch(() => {});
	await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
	await expect(
		page.getByText('Your changes are not saved until you are back online.')
	).toBeVisible();

	await context.setOffline(false);
	await page.getByRole('button', { name: 'Retry' }).click();
	await expect(page).toHaveURL(new RegExp(`/builds/${buildId}`));
	await expect(page.getByRole('heading', { name: 'You are offline' })).toHaveCount(0);
});

test('sign-out clears the model runtime cache and keeps the app shell precache', async ({
	page
}) => {
	await ownerWithBuild(page, 'pwa-signout');
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

	// No kit model exists in the e2e data, so a stand-in is put into the runtime cache under a
	// versioned model URL (the cache name and rule are covered by the sw-rules unit tests).
	await page.evaluate(async () => {
		const c = await caches.open('tmt-runtime-v1');
		await c.put('/api/templates/standin/model.glb?v=1', new Response('glb'));
	});
	const names = () => page.evaluate(() => caches.keys());
	expect(await names()).toContain('tmt-runtime-v1');
	const shellBefore = (await names()).filter((k) => k.startsWith('tmt-shell-'));
	expect(shellBefore.length).toBeGreaterThan(0);

	await page.getByTestId('account-menu').click();
	await page.getByRole('menuitem', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);

	await expect.poll(names).not.toContain('tmt-runtime-v1');
	expect((await names()).filter((k) => k.startsWith('tmt-shell-'))).toEqual(shellBefore);
	const shellCount = await page.evaluate(async () => {
		const k = (await caches.keys()).find((n) => n.startsWith('tmt-shell-'))!;
		return (await (await caches.open(k)).keys()).length;
	});
	expect(shellCount).toBeGreaterThan(0);
});
