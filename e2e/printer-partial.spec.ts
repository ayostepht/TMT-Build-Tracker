import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

/** A stopped print on a multi-part plate is confirmed as Partial: tick the parts that printed OK. */

const SHOTS = process.env.SHOTS_DIR ?? 'data/shots-46-printers';
let mock: MockSdcp;
test.beforeAll(async () => {
	mock = new MockSdcp();
	await mock.start();
});
test.afterAll(async () => {
	await mock.stop();
});

interface ViewJson {
	plates: { number: number; parts: string[]; perPartRuns: boolean; runs: number }[];
	runs: { id: string; plateNumber: number | null; result: string; partSlugs?: string[] | null }[];
}

test('confirm a stopped job as Partial with per-part results', async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'partial');
	const { organizationId } = (await (
		await page.request.get(`/api/builds/${buildId}/printer-jobs`)
	).json()) as { organizationId: string };
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId,
			name: 'Shop Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);

	const v = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;
	const plate = v.plates.find((p) => !p.perPartRuns && p.parts.length >= 2 && p.runs <= 1)!;
	expect(plate).toBeTruthy();

	mock.printing('benchy.gcode', 40);
	await expect
		.poll(
			async () =>
				(
					(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
						jobs: unknown[];
					}
				).jobs.length,
			{ timeout: 20_000 }
		)
		.toBeGreaterThan(0);
	const jobs = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			jobs: { id: string }[];
		}
	).jobs;
	const link = await page.request.post(`/api/printers/jobs/${jobs[0].id}`, {
		data: { action: 'link', buildId, plateNumber: plate.number }
	});
	expect(link.ok()).toBe(true);
	mock.set({ printStatus: 8, machineStatus: [0] }); // stopped

	await page.goto(`/builds/${buildId}`);
	const prompt = page.getByTestId('confirm-print-log');
	await expect(prompt).toContainText('was stopped', { timeout: 20_000 });
	await prompt.getByTestId('confirm-result').selectOption('Partial');
	await expect(prompt.getByTestId('partial-parts')).toBeVisible();
	await expect(prompt.getByTestId('confirm-log')).toBeDisabled();
	await expect(prompt.getByTestId('partial-hint')).toBeVisible();
	await prompt.getByTestId(`partial-part-${plate.parts[0]}`).check();
	await expect(prompt.getByTestId('confirm-log')).toBeEnabled();
	await prompt.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/confirm-partial-390-light.png` });
	await page.setViewportSize({ width: 1440, height: 900 });
	await prompt.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${SHOTS}/confirm-partial-1440-light.png` });

	await prompt.getByTestId('confirm-grams-kept').fill('21');
	await prompt.getByTestId('confirm-grams-lost').fill('4');
	await prompt.getByTestId('confirm-log').click();
	await expect(prompt).toBeHidden({ timeout: 15_000 });

	const after = (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;
	const mine = after.runs.filter((r) => r.plateNumber === plate.number);
	expect(mine.map((r) => r.result).sort()).toEqual(['Failed', 'Success']);
});
