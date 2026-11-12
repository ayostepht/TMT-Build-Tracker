import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';

const SHOTS = process.env.R48_SHOTS ?? 'data/r48-shots-printers';

let mock: MockSdcp;
test.beforeAll(async () => {
	mock = new MockSdcp();
	await mock.start();
});
test.afterAll(async () => {
	await mock.stop();
});

test('Recent prints lists plate-linked and running jobs; other unlinked prints sit behind a disclosure', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'r48jobs');
	const org = (
		(await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
			organizationId: string;
		}
	).organizationId;
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: org,
			name: 'Bench Printer',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	await page.goto(`${chapterUrl}/printers`);
	await page.waitForLoadState('networkidle');
	// No jobs at all: no list, no disclosure.
	await expect(page.getByTestId('other-jobs')).toHaveCount(0);

	// 1. An unlinked print that ends without ever being linked is not "recent prints".
	mock.printing('scratch-test.gcode', 8);
	await expect(page.getByTestId('job-list')).toContainText('scratch-test.gcode', {
		timeout: 20_000
	});
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	const other = page.getByTestId('other-jobs');
	await expect(other).toBeVisible({ timeout: 20_000 });
	await expect(other.locator('summary')).toHaveText('Other prints on this printer (1)');
	await expect(page.getByTestId('job-list')).toHaveCount(0);
	await expect(page.getByText('scratch-test.gcode')).toBeHidden(); // closed

	// 2. A running unlinked print is shown with its link control and linked by hand.
	mock.printing('vase-test.gcode', 20);
	const live = page.getByTestId('job-list').getByTestId('job-link');
	await expect(live).toBeVisible({ timeout: 20_000 });
	await live.getByTestId('link-plate').selectOption({ index: 1 });
	await expect(page.getByTestId('job-list').getByRole('link', { name: /^Plate \d+/ })).toBeVisible({
		timeout: 15_000
	});
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });

	// 3. A new running unlinked job beside the linked one.
	mock.printing('bracket-test.gcode', 12);
	await expect(page.getByTestId('job-list').getByTestId('job-link')).toBeVisible({
		timeout: 20_000
	});
	await expect(page.getByTestId('job-list')).toContainText('vase-test.gcode');
	await expect(other.locator('summary')).toHaveText('Other prints on this printer (1)');
	await page.screenshot({ path: `${SHOTS}/recent-closed-390-light.png`, fullPage: true });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `${SHOTS}/recent-closed-1440-light.png`, fullPage: true });

	// 4. Opening the disclosure shows the older print, still linkable.
	await other.locator('summary').click();
	await expect(other.getByText('scratch-test.gcode')).toBeVisible();
	await expect(other.getByTestId('link-plate')).toBeVisible({ timeout: 15_000 });
	await page.screenshot({ path: `${SHOTS}/recent-open-1440-light.png`, fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: `${SHOTS}/recent-open-390-light.png`, fullPage: true });

	// 5. The build page never lists the finished unlinked print.
	const view = await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json();
	expect(JSON.stringify(view.jobs)).not.toContain('scratch-test.gcode');
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
});
