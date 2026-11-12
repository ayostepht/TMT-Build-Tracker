import { MockCamera } from '../src/lib/server/printers/mock-camera';
import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { createBuild, ownerWithBuild } from './helpers';
import { chooseStatus } from './status-helpers';

// Visual guard for the Stage 4 second wave (printer components). Runs only with
// STAGE4_SHOTS=before|after; files land in the gitignored .playwright-mcp/stage4b-printers/.
const PHASE = process.env.STAGE4_SHOTS;
const DIR = `.playwright-mcp/${process.env.STAGE4_SHOTS_DIR ?? 'stage4b-printers'}/${PHASE}`;
test.skip(!PHASE, 'set STAGE4_SHOTS=before|after');

test('stage 4b printers screenshots', async ({ page, browser }) => {
	test.setTimeout(300_000);
	const sdcp = new MockSdcp();
	await sdcp.start();
	const cam = new MockCamera();
	cam.fps = 5;
	const scratch = await browser.newPage();
	await scratch.setViewportSize({ width: 640, height: 360 });
	await scratch.setContent(
		'<body style="margin:0;background:#2b3f9e;display:grid;place-items:center;height:360px;font:700 64px sans-serif;color:#fff">CAM</body>'
	);
	cam.frames = [await scratch.screenshot({ type: 'jpeg', quality: 70 })];
	await scratch.close();
	await cam.start();
	try {
		await page.setViewportSize({ width: 1440, height: 900 });
		const { buildId, chapterUrl } = await ownerWithBuild(page, 's4bp');
		const org = (
			(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
				organizationId: string;
			}
		).organizationId;
		const created = await page.request.post('/api/printers', {
			data: {
				organizationId: org,
				name: 'Shot Centauri',
				kind: 'elegoo-sdcp',
				host: '127.0.0.1',
				port: sdcp.port,
				secrets: { mainboardId: 'ABCDEF' },
				cameraUrl: cam.url('/video')
			}
		});
		expect(created.ok()).toBe(true);
		const slug = chapterUrl.split('/teams/')[1].split('/')[0];

		const idle = () => sdcp.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
		idle();
		let round = 0;
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			for (const { w, h } of [
				{ w: 390, h: 844 },
				{ w: 1440, h: 900 }
			]) {
				await page.setViewportSize({ width: w, height: h });
				const shot = async (name: string, full = true) => {
					await page.waitForTimeout(400);
					await page.screenshot({ path: `${DIR}/${name}-${w}-${scheme}.png`, fullPage: full });
				};
				// A fresh build per round so "Start on <printer>" is offered again.
				const id =
					round++ === 0
						? buildId
						: (await page.goto(chapterUrl), await createBuild(page, `Round ${round}`));
				idle();
				await page.goto(`/builds/${id}/print`);
				await page.waitForLoadState('networkidle');
				const sent = page.waitForResponse(
					(r) => /\/api\/printers\/[^/]+\/expect$/.test(r.url()) && r.request().method() === 'POST'
				);
				await chooseStatus(
					page.locator('.group-head').getByTestId('plate-status').first(),
					'Printing'
				);
				await page.getByTestId('where-confirm').click();
				expect((await sent).ok()).toBe(true);
				await page.goto(`/builds/${id}`);
				await page.waitForLoadState('networkidle');
				sdcp.printing('ECC_0.4_tmt_4691_Overture PETG HF_0.2_11h1m.gcode', 37);
				await expect(page.getByTestId('expected-confirm')).toBeVisible({ timeout: 20_000 });
				await shot('overview-confirm');
				await page.getByTestId('expected-confirm-go').click();
				await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 15_000 });
				await expect(page.getByTestId('camera-img')).toBeVisible({ timeout: 15_000 });
				await shot('overview-live');
				await page.getByTestId('camera-img').click();
				await expect(page.getByTestId('camera-lightbox-img')).toBeVisible();
				await shot('lightbox', false);
				await page.keyboard.press('Escape');
				await page.getByTestId('camera-toggle').click();
				await shot('overview-camera-collapsed');
				await page.getByTestId('camera-toggle').click();
				await chooseStatus(
					page.getByTestId('now-card').getByTestId('plate-status').first(),
					'To print'
				);
				await expect(page.getByTestId('link-plate')).toBeVisible({ timeout: 15_000 });
				await shot('overview-unlinked');

				// Printers page: status cards and recent prints only
				await page.goto(`/teams/${slug}/printers`);
				await expect(page.getByTestId('printer-card')).toBeVisible();
				await expect(page.getByTestId('job-list')).toBeVisible({ timeout: 15_000 });
				await shot('printers');

				// Integrations: rows, chooser, edit form, remove confirm
				await page.goto(`/teams/${slug}/integrations`);
				await page.waitForLoadState('networkidle');
				await expect(page.getByTestId('printer-row')).toBeVisible();
				await shot('integrations');
				await page.getByRole('button', { name: 'Add a printer' }).click();
				await shot('printers-add');
				await page.getByRole('button', { name: 'Cancel' }).click();
				await page.getByRole('button', { name: 'Edit', exact: true }).click();
				await shot('printers-edit');
				await page.getByRole('button', { name: 'Cancel' }).click();
				await page.getByRole('button', { name: 'Remove…' }).click();
				await shot('printers-remove-confirm');
				await page.getByTestId('ask-cancel').click();
				idle();
			}
		}
	} finally {
		sdcp.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
		await sdcp.stop();
		await cam.stop();
	}
});
