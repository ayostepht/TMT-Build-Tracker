import type { Page } from '@playwright/test';
import { MockCamera } from '../src/lib/server/printers/mock-camera';
import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { newClientContext } from './fixtures';
import { ownerWithBuild, signUp, uniqueEmail } from './helpers';

const SHOTS = 'data/shots-camera';
const FILE = 'Plate 1 - Handle Left.gcode';

let sdcp: MockSdcp;
let cam: MockCamera;
let broken: MockCamera;

/** A real, decodable 640x360 JPEG (the mock camera sends these), made by a scratch browser page. */
async function frame(page: Page, label: string, color: string): Promise<Buffer> {
	await page.setViewportSize({ width: 640, height: 360 });
	await page.setContent(
		`<body style="margin:0;background:${color};display:grid;place-items:center;height:360px;font:700 64px sans-serif;color:#fff">${label}</body>`
	);
	return page.screenshot({ type: 'jpeg', quality: 70 });
}

test.beforeAll(async ({ browser }) => {
	sdcp = new MockSdcp();
	await sdcp.start();
	cam = new MockCamera();
	cam.fps = 5;
	const scratch = await browser.newPage();
	cam.frames = [
		await frame(scratch, 'CAM 1', '#1f6f4a'),
		await frame(scratch, 'CAM 2', '#2b3f9e'),
		await frame(scratch, 'CAM 3', '#8a4b12')
	];
	await scratch.close();
	await cam.start();
	broken = new MockCamera();
	broken.mode = 'error';
	await broken.start();
});
test.afterAll(async () => {
	await sdcp.stop();
	await cam.stop();
	await broken.stop();
});

/** The workspace (chapter) a build belongs to. */
async function orgId(page: Page, buildId: string): Promise<string> {
	const r = await page.request.get(`/api/builds/${buildId}/printer-jobs`);
	return ((await r.json()) as { organizationId: string }).organizationId;
}

test('camera tile on Now printing: appears while printing, refreshes, goes live, shows errors, opens large', async ({
	page,
	browser
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'camera');
	const org = await orgId(page, buildId);

	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Cam Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: sdcp.port,
			secrets: { mainboardId: 'ABCDEF' },
			cameraUrl: cam.url('/video')
		}
	});
	expect(created.ok()).toBe(true);
	const printer = (await created.json()).printer as { id: string; cameraUrl: string };
	expect(printer.cameraUrl).toBe(cam.url('/video'));

	// Idle printer: no tile.
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('camera-tile')).toHaveCount(0);

	// Printing: the card goes live and the camera tile appears with a real image.
	sdcp.printing(FILE, 12);
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 20_000 });
	const tile = page.getByTestId('camera-tile');
	await expect(tile).toBeVisible({ timeout: 15_000 });
	const img = tile.getByTestId('camera-img');
	await expect(img).toBeVisible();
	await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(640);
	const box = await tile.locator('.viewport').boundingBox();
	expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.05);
	expect(box!.width).toBeGreaterThan(280); // the card's full width at 390 px
	await tile.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/e2e-tile-390.png` });

	// Snapshot refresh: a new frame URL within ~5 s, and the server answers JPEG + no-store.
	const first = await img.getAttribute('src');
	await expect.poll(() => img.getAttribute('src'), { timeout: 12_000 }).not.toBe(first);
	const snap = await page.request.get(`/api/printers/${printer.id}/camera/snapshot`);
	expect(snap.status()).toBe(200);
	expect(snap.headers()['content-type']).toBe('image/jpeg');
	expect(snap.headers()['cache-control']).toContain('no-store');
	expect((await snap.body())[0]).toBe(0xff);

	// One upstream connection for every viewer: a second browser context watching the stream too.
	const ctx2 = await newClientContext(browser);
	const other = await ctx2.newPage();
	// (a second user is not a member: 404 for the printer's camera)
	await signUp(other, 'Outsider', uniqueEmail('camera-out'));
	for (const p of ['snapshot', 'stream', '']) {
		const r = await other.request.get(`/api/printers/${printer.id}/camera/${p}`.replace(/\/$/, ''));
		expect(r.status()).toBe(404);
	}
	await ctx2.close();

	// Live toggle: the <img> switches to the MJPEG stream.
	await tile.getByTestId('camera-live').click();
	await expect(img).toHaveAttribute('src', new RegExp(`/api/printers/${printer.id}/camera/stream`));
	await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(640);
	await expect(tile.getByTestId('camera-live')).toHaveAttribute('aria-pressed', 'true');
	// Still one connection to the camera for the snapshots and the stream together.
	expect(cam.hits.filter((h) => h === '/video').length).toBe(1);
	expect(cam.maxActive).toBe(1);

	// Collapse: image gone, no camera requests while collapsed, remembered across reload, expand resumes.
	{
		await tile.getByTestId('camera-live').click(); // stream on, to prove it is dropped too
		const toggle = tile.getByTestId('camera-toggle');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(40);
		await tile.scrollIntoViewIfNeeded();
		await page.screenshot({ path: 'data/shots-camera-collapse/e2e-collapse-expanded-390.png' });
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(tile.getByTestId('camera-img')).toHaveCount(0);
		await expect(tile.getByTestId('camera-live')).toHaveCount(0);
		await page.screenshot({ path: 'data/shots-camera-collapse/e2e-collapse-collapsed-390.png' });
		await page.waitForTimeout(500); // let an in-flight request settle
		const reqs: string[] = [];
		const onReq = (r: { url(): string }) => {
			if (r.url().includes(`/api/printers/${printer.id}/camera/`)) reqs.push(r.url());
		};
		page.on('request', onReq);
		await page.waitForTimeout(6000);
		page.off('request', onReq);
		expect(reqs).toEqual([]);
		expect(
			await page.evaluate((k) => localStorage.getItem(k), `tmt-camera-collapsed:${printer.id}`)
		).toBe('1');
		await page.reload();
		await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('camera-toggle')).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByTestId('camera-img')).toHaveCount(0);
		await page.getByTestId('camera-toggle').click();
		await expect(page.getByTestId('camera-img')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('camera-img')).not.toHaveAttribute('src', /camera\/stream/);
		await expect(page.getByTestId('camera-live')).toHaveAttribute('aria-pressed', 'false');
		await page.getByTestId('camera-live').click(); // back to live for the steps below
		await expect(img).toHaveAttribute('src', /camera\/stream/);
	}

	// Enlarge: tap the image.
	await img.click();
	await expect(page.getByTestId('camera-lightbox-img')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/e2e-lightbox-390.png` });
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('camera-lightbox-img')).toBeHidden();

	// Back to snapshots: the stream is dropped from the page.
	await tile.getByTestId('camera-live').click();
	await expect(img).not.toHaveAttribute('src', /camera\/stream/);

	// Error state: point the camera at one that answers 503 -> quiet message, no broken image.
	const bad = await page.request.patch(`/api/printers/${printer.id}`, {
		data: { cameraUrl: broken.url('/video') }
	});
	expect(bad.ok()).toBe(true);
	await expect(tile.getByTestId('camera-error')).toBeVisible({ timeout: 15_000 });
	await expect(tile.getByTestId('camera-error')).toContainText('Camera unavailable');
	await expect(tile.getByTestId('camera-img')).toHaveCount(0);
	await page.screenshot({ path: `${SHOTS}/e2e-error-390.png` });

	// Fixed again + Retry: the picture comes back.
	await page.request.patch(`/api/printers/${printer.id}`, {
		data: { cameraUrl: cam.url('/video') }
	});
	await tile.getByTestId('camera-retry').click();
	await expect(tile.getByTestId('camera-img')).toBeVisible({ timeout: 15_000 });
	await expect(tile.getByTestId('camera-error')).toHaveCount(0);

	// Printing stops: the tile goes away with the live job.
	sdcp.set({ printStatus: 0, machineStatus: [0], file: '', progress: 0 });
	await expect(page.getByTestId('printer-live')).toBeHidden({ timeout: 20_000 });
	await expect(page.getByTestId('camera-tile')).toHaveCount(0);
});

test('printer settings: camera override, auto default placeholder, test preview, SSRF refusal, Bambu note', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'camera-settings');
	const org = await orgId(page, buildId);
	const made = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Settings Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: sdcp.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	const id = ((await made.json()).printer as { id: string }).id;

	// Default (no override): the Elegoo address is what the placeholder shows.
	await page.goto(`${chapterUrl}/printers`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('printer-card')).toBeVisible();
	await page.getByRole('button', { name: 'Edit' }).first().click();
	const url = page.getByTestId('pf-camera-url');
	await expect(url).toHaveAttribute('placeholder', 'http://127.0.0.1:3031/video');
	await expect(url).toHaveValue('');

	// Override + Test: previews one frame.
	await url.fill(cam.url('/snapshot'));
	await page.getByTestId('pf-camera-test').click();
	await expect(page.getByTestId('pf-camera-result').locator('img')).toBeVisible({
		timeout: 15_000
	});
	await expect
		.poll(() =>
			page
				.getByTestId('pf-camera-result')
				.locator('img')
				.evaluate((i: HTMLImageElement) => i.naturalWidth)
		)
		.toBe(640);
	await page.getByTestId('pf-camera').scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/e2e-settings-390.png` });

	// SSRF: another host is refused by Test and by Save, and nothing is stored.
	const before = cam.total;
	await url.fill('http://10.9.9.9:8080/video');
	await page.getByTestId('pf-camera-test').click();
	await expect(page.getByTestId('pf-camera-result')).toContainText('same address as the printer');
	await page.getByTestId('pf-save').click();
	await expect(page.getByRole('alert')).toContainText('same address as the printer');
	let list = await (await page.request.get(`/api/printers?org=${org}`)).json();
	expect(list.printers[0].cameraUrl).toBeNull();
	for (const bad of [
		'http://169.254.169.254/latest',
		'file:///etc/passwd',
		'http://u:p@127.0.0.1/x',
		'ftp://127.0.0.1/x'
	]) {
		const r = await page.request.patch(`/api/printers/${id}`, { data: { cameraUrl: bad } });
		expect(r.status(), bad).toBe(400);
	}
	expect(cam.total).toBe(before); // nothing else was fetched

	// Save the good override.
	await url.fill(cam.url('/snapshot'));
	await page.getByTestId('pf-save').click();
	await expect(page.getByTestId('printer-form')).toBeHidden({ timeout: 10_000 });
	list = await (await page.request.get(`/api/printers?org=${org}`)).json();
	expect(list.printers[0].cameraUrl).toBe(cam.url('/snapshot'));

	// A viewer sees no override (it may carry a token).
	const info = await (await page.request.get(`/api/printers/${id}/camera`)).json();
	expect(info).toMatchObject({ supported: true, enabled: true, available: true, origin: 'custom' });

	// Bambu: not supported, said in the form.
	await page.getByTestId('add-printer').click();
	await page.getByTestId('pf-kind').selectOption('bambu-lan');
	await expect(page.getByTestId('pf-camera-unsupported')).toContainText('not supported');
	await expect(page.getByTestId('pf-camera-url')).toHaveCount(0);
});

test('Elegoo camera is switched on with SDCP Cmd 386 only: not ready -> enable -> frames, throttled, Test button too', async ({
	page
}) => {
	test.setTimeout(120_000);
	const { buildId } = await ownerWithBuild(page, 'camera-enable');
	const org = await orgId(page, buildId);

	// The printer's camera answers 500 "camera not ready" until its SDCP socket got Cmd 386.
	const printer = new MockSdcp();
	await printer.start();
	const camera = new MockCamera();
	camera.fps = 5;
	camera.readyWhen = () => printer.cameraReady();
	camera.frames = [cam.frames[0]];
	await camera.start();
	// A second printer for the settings Test button.
	const printer2 = new MockSdcp();
	await printer2.start();
	const camera2 = new MockCamera();
	camera2.readyWhen = () => printer2.cameraReady();
	camera2.frames = [cam.frames[0]];
	await camera2.start();
	try {
		const make = async (name: string, s: MockSdcp, c: MockCamera) => {
			const r = await page.request.post('/api/printers', {
				data: {
					organizationId: org,
					name,
					kind: 'elegoo-sdcp',
					host: '127.0.0.1',
					port: s.port,
					secrets: { mainboardId: 'ABCDEF' },
					cameraUrl: c.url('/video')
				}
			});
			expect(r.ok()).toBe(true);
			return ((await r.json()).printer as { id: string }).id;
		};
		const id = await make('Enable Centauri', printer, camera);
		await make('Test Centauri', printer2, camera2);
		await expect.poll(() => printer.sockets.size, { timeout: 15_000 }).toBe(1);
		expect(camera.hits).toEqual([]);

		// A snapshot with the camera off: enable goes out, the camera comes ready, a frame arrives.
		const snap = await page.request.get(`/api/printers/${id}/camera/snapshot`);
		expect(snap.status()).toBe(200);
		expect(snap.headers()['content-type']).toBe('image/jpeg');
		expect(printer.cameraEnables).toBe(1);
		// It went over the existing connection: still exactly one client socket.
		expect(printer.sockets.size).toBe(1);

		// Throttle: the printer times the camera out; more requests within 30 s send nothing new.
		printer.cameraOff();
		const again = await page.request.get(`/api/printers/${id}/camera/snapshot`);
		expect([200, 502]).toContain(again.status());
		expect(printer.cameraEnables).toBe(1);

		// Guard: the app never sent anything but status/attributes reads and the one camera-on.
		const sent = printer.received.filter((r) => r.cmd !== 0 && r.cmd !== 1);
		expect(sent).toEqual([{ cmd: 386, data: { Enable: 1 } }]);

		// Settings Test turns the camera on first (temporary socket), then shows a frame.
		await page.setViewportSize({ width: 390, height: 844 });
		const t = await page.request.post('/api/printers/camera-test', {
			data: {
				organizationId: org,
				kind: 'elegoo-sdcp',
				host: '127.0.0.1',
				port: printer2.port,
				secrets: { mainboardId: 'ABCDEF' },
				cameraUrl: camera2.url('/video')
			}
		});
		const res = (await t.json()) as { works: boolean; image?: string; message?: string };
		expect(res.works, res.message).toBe(true);
		expect(res.image).toMatch(/^data:image\/jpeg;base64,/);
		expect(printer2.received.filter((r) => r.cmd === 386)).toEqual([
			{ cmd: 386, data: { Enable: 1 } }
		]);
	} finally {
		await printer.stop();
		await camera.stop();
		await printer2.stop();
		await camera2.stop();
	}
});
