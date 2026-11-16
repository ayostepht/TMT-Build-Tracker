import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { createBuild, ownerWithBuild } from './helpers';
import type { Page } from '@playwright/test';

/**
 * Issue #42: the Now printing card sometimes showed only the manual block (no printer name,
 * progress, camera) until the build was reopened. The live panel must appear and recover
 * after in-app navigation between builds, a dead event stream and a backgrounded page.
 */

let mock: MockSdcp;
test.beforeAll(async () => {
	mock = new MockSdcp();
	await mock.start();
});
test.afterAll(async () => {
	await mock.stop();
});

const FILE = 'resume-a.gcode';

async function addPrinter(page: Page, org: string): Promise<string> {
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Resume Bench',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	return ((await created.json()) as { printer: { id: string } }).printer.id;
}

async function orgOf(page: Page, buildId: string): Promise<string> {
	return (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
}

async function unlinkedJob(page: Page, buildId: string): Promise<string> {
	let id = '';
	await expect
		.poll(
			async () => {
				const r = (await (
					await page.request.get(`/api/builds/${buildId}/printer-jobs`)
				).json()) as {
					jobs: { id: string; fileName: string }[];
				};
				id = r.jobs.find((j) => j.fileName === FILE)?.id ?? '';
				return id;
			},
			{ timeout: 20_000 }
		)
		.not.toBe('');
	return id;
}

async function linkTo(page: Page, jobId: string, buildId: string) {
	const view = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		plates: { number: number }[];
	};
	const r = await page.request.post(`/api/printers/jobs/${jobId}`, {
		data: { action: 'link', buildId, plateNumber: view.plates[0].number }
	});
	expect(r.ok()).toBe(true);
}

/** A client-side navigation (SvelteKit intercepts clicks on same-origin anchors). */
async function spaGoto(page: Page, href: string) {
	await page.evaluate((h) => {
		const a = document.createElement('a');
		a.href = h;
		document.body.appendChild(a);
		a.click();
		a.remove();
	}, href);
}

test('live panel follows the build when navigating from one build to another', async ({ page }) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 390, height: 844 });
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	const { chapterUrl, buildId: first } = await ownerWithBuild(page, 'resume');
	await page.goto(chapterUrl);
	const second = await createBuild(page, 'Second chair');
	const org = await orgOf(page, second);
	await addPrinter(page, org);

	mock.printing(FILE, 48, { ticks: 6 * 3600, totalTicks: 13 * 3600 });
	const jobId = await unlinkedJob(page, second);
	await linkTo(page, jobId, second);

	// 1. Direct load: the panel is there.
	await page.goto(`/builds/${second}`);
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 15_000 });

	// 2. In-app navigation from another build into it (same layout instance).
	await page.goto(`/builds/${first}`);
	await page.waitForLoadState('networkidle');
	await spaGoto(page, `/builds/${second}`);
	await expect(page).toHaveURL(new RegExp(`/builds/${second}$`));
	await expect(page.getByTestId('now-card')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 15_000 });
});

test('live panel appears when the event stream is dead and when the page returns from the background', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 390, height: 844 });
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	// iOS freezes or kills the EventSource in the background: here it never connects at all.
	await page.route('**/api/printers/events**', (r) => r.abort());
	const { buildId } = await ownerWithBuild(page, 'resume2');
	await addPrinter(page, await orgOf(page, buildId));
	// The plate was started by hand (Printing), so its card is already on screen when the job is linked.
	const v = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as {
		plates: { parts: string[] }[];
	};
	const started = await page.request.post(`/api/builds/${buildId}/printing`, {
		data: { action: 'start', slugs: v.plates[0].parts }
	});
	expect(started.ok()).toBe(true);
	await page.goto(`/builds/${buildId}`);
	await expect(page.getByTestId('now-card')).toBeVisible();
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('printer-live')).toHaveCount(0);

	// Hidden page: the job is linked meanwhile (by someone else, or auto-link) and no event arrives.
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	mock.printing(FILE, 48, { ticks: 6 * 3600, totalTicks: 13 * 3600 });
	await linkTo(page, await unlinkedJob(page, buildId), buildId);
	await page.waitForTimeout(1500);
	await expect(page.getByTestId('printer-live')).toHaveCount(0);

	// Back in the foreground: the panel shows at once, not after the next 30 s poll.
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect(page.getByTestId('printer-live')).toBeVisible({ timeout: 5_000 });
});
