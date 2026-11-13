import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { ownerWithBuild } from './helpers';
import { chooseStatus, confirmWhere } from './status-helpers';
import type { Page } from '@playwright/test';

/**
 * A plate that is printed again after an earlier print of it ended without being logged.
 * Reproduces the "retry" flow from the UI with a mock Elegoo printer: the stale print's log must
 * not take the plate off the printer, and the plate's start time is the running print's own
 * (from the printer), never the earlier print's or the moment of the click.
 */

let mock: MockSdcp;
test.beforeAll(async () => {
	mock = new MockSdcp();
	await mock.start();
});
test.afterAll(async () => {
	await mock.stop();
});

const IDLE = { printStatus: 0, machineStatus: [0], progress: 0, file: '' };

interface JobRow {
	id: string;
	fileName: string;
	plateNumber: number | null;
	status: string;
	startedAt: string | null;
	pendingConfirm: boolean;
}
interface ViewJson {
	plates: { number: number; parts: string[]; perPartRuns: boolean }[];
	state: Record<string, { status: string; startedAt: string | null }>;
	runs: { plateNumber: number | null; result: string }[];
}

async function addPrinter(page: Page, buildId: string, name: string): Promise<string> {
	const jobs = (await (await page.request.get(`/api/builds/${buildId}/printer-jobs`)).json()) as {
		organizationId: string;
	};
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId: jobs.organizationId,
			name,
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	return ((await created.json()) as { printer: { id: string } }).printer.id;
}

async function jobs(page: Page, buildId: string): Promise<JobRow[]> {
	const r = await page.request.get(`/api/builds/${buildId}/printer-jobs`);
	return ((await r.json()) as { jobs: JobRow[] }).jobs;
}

/** The job for `file`, once the server has seen it. */
async function jobFor(page: Page, buildId: string, file: string): Promise<JobRow> {
	await expect
		.poll(async () => (await jobs(page, buildId)).some((j) => j.fileName === file), {
			timeout: 20_000
		})
		.toBe(true);
	return (await jobs(page, buildId)).find((j) => j.fileName === file)!;
}

async function view(page: Page, buildId: string): Promise<ViewJson> {
	return (await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;
}

/** What a datetime-local input shows for an instant: local time to the minute. */
function localInput(page: Page, iso: string): Promise<string> {
	return page.evaluate((s) => {
		const d = new Date(s);
		const z = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
	}, iso);
}

async function removePrinter(page: Page, id: string) {
	await page.request.delete(`/api/printers/${id}`);
}

test('Retry after an unlogged cancelled print: logging the old print keeps the plate printing with the new print start', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	mock.set(IDLE);
	const { buildId } = await ownerWithBuild(page, 'retry');
	const printerId = await addPrinter(page, buildId, 'Retry Bench');
	try {
		const v0 = await view(page, buildId);
		const plate = v0.plates[0];
		expect(plate.perPartRuns, 'the first plate is a single-run plate').toBe(false);

		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');

		// 1. Print A runs and is linked to plate 1 by hand (its file name matches no plate).
		mock.printing('retry-a.gcode', 39, { ticks: 2340, totalTicks: 6000 });
		const unlinkedA = page.getByTestId('unlinked-job').filter({ hasText: 'retry-a.gcode' });
		await expect(unlinkedA).toBeVisible({ timeout: 20_000 });
		await unlinkedA.getByTestId('link-plate').selectOption(String(plate.number));
		await expect(page.getByTestId('now-card')).toContainText(`Plate ${plate.number}`, {
			timeout: 15_000
		});

		// 2. A is cancelled part-way and nobody logs it: parts stay Printing, the log prompt waits.
		mock.set({ printStatus: 8, machineStatus: [0], progress: 39 });
		const prompt = page.getByTestId('confirm-print-log');
		await expect(prompt).toContainText('was stopped', { timeout: 20_000 });
		const jobA = await jobFor(page, buildId, 'retry-a.gcode');
		expect(jobA.pendingConfirm).toBe(true);
		const afterA = await view(page, buildId);
		for (const s of plate.parts) expect(afterA.state[s].status).toBe('Printing');

		// 3. Print B starts on the same printer (90 min in when first seen) and is linked to the same plate.
		mock.printing('retry-b.gcode', 30, { ticks: 5400, totalTicks: 18000 });
		const unlinkedB = page.getByTestId('unlinked-job').filter({ hasText: 'retry-b.gcode' });
		await expect(unlinkedB).toBeVisible({ timeout: 20_000 });
		await unlinkedB.getByTestId('link-plate').selectOption(String(plate.number));
		await expect(unlinkedB).toBeHidden({ timeout: 15_000 });
		const jobB = await jobFor(page, buildId, 'retry-b.gcode');
		expect(jobB.startedAt).toBeTruthy();
		expect(jobA.startedAt).toBeTruthy();
		// the two prints really started at different times (about 50 minutes apart)
		expect(Math.abs(Date.parse(jobB.startedAt!) - Date.parse(jobA.startedAt!))).toBeGreaterThan(
			20 * 60_000
		);

		// 4. Confirm A's log as Failed.
		await expect(prompt).toContainText('retry-a.gcode');
		await prompt.getByTestId('confirm-result').selectOption('Failed');
		await prompt.getByTestId('confirm-log').click();
		await expect(prompt).toBeHidden({ timeout: 15_000 });

		// The plate is still on the printer: in "Now printing", Printing, started when B started.
		const card = page.getByTestId('now-card').filter({ hasText: `Plate ${plate.number}` });
		await expect(card).toBeVisible();
		await expect(card.getByTestId('plate-status')).toHaveAttribute('data-status', 'Printing');
		// The Started field shows the start to the minute; it is B's, not A's and not "now".
		await expect(card.getByLabel('Started')).toHaveValue(await localInput(page, jobB.startedAt!));
		expect(await localInput(page, jobB.startedAt!)).not.toBe(
			await localInput(page, jobA.startedAt!)
		);
		expect(await localInput(page, jobB.startedAt!)).not.toBe(
			await localInput(page, new Date().toISOString())
		);

		// Server state agrees, to the millisecond, and the Failed run is on record.
		const after = await view(page, buildId);
		for (const s of plate.parts) {
			expect(after.state[s].status).toBe('Printing');
			expect(after.state[s].startedAt).toBe(jobB.startedAt);
		}
		expect(
			after.runs.filter((r) => r.plateNumber === plate.number && r.result === 'Failed')
		).toHaveLength(1);
	} finally {
		mock.set(IDLE);
		await removePrinter(page, printerId);
	}
});

test('Choosing Printing on a printer that already runs the print keeps the print start time', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	mock.set(IDLE);
	const { buildId } = await ownerWithBuild(page, 'retry2');
	const printerId = await addPrinter(page, buildId, 'Retry Bench Two');
	try {
		// The printer is already running a print (90 min in) that nobody has linked yet.
		mock.printing('retry-c.gcode', 30, { ticks: 5400, totalTicks: 18000 });
		const job = await jobFor(page, buildId, 'retry-c.gcode');
		expect(job.startedAt).toBeTruthy();

		// The maker marks a plate Printing and says it is on that printer.
		await page.goto(`/builds/${buildId}/print`);
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Group by').selectOption('plate');
		const startable = page
			.locator('.group-head')
			.locator('[data-testid="plate-status"][data-status="To print"]');
		const badge = startable.first();
		await expect(badge).toBeVisible();
		const plateNo = Number(
			/Plate (\d+) status/.exec((await badge.getAttribute('aria-label')) ?? '')![1]
		);
		await chooseStatus(badge, 'Printing');
		await confirmWhere(page, 'first');

		// The job is linked and the plate's start is the printer's, not the moment of the click.
		await expect
			.poll(
				async () => {
					return (await jobs(page, buildId)).find((x) => x.id === job.id)?.plateNumber ?? null;
				},
				{ timeout: 20_000 }
			)
			.toBe(plateNo);
		const v = await view(page, buildId);
		const plate = v.plates.find((p) => p.number === plateNo)!;
		await expect
			.poll(async () => (await view(page, buildId)).state[plate.parts[0]].startedAt, {
				timeout: 15_000
			})
			.toBe(job.startedAt);

		await page.goto(`/builds/${buildId}`);
		const card = page.getByTestId('now-card').filter({ hasText: `Plate ${plateNo}` });
		await expect(card).toBeVisible();
		await expect(card.getByLabel('Started')).toHaveValue(await localInput(page, job.startedAt!));
	} finally {
		mock.set(IDLE);
		await removePrinter(page, printerId);
	}
});

test('Link to plate while an earlier print of that plate is unlogged: the notice shows, opens that log, and goes once it is logged', async ({
	page
}) => {
	test.setTimeout(150_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	mock.set(IDLE);
	const { buildId } = await ownerWithBuild(page, 'retry3');
	const printerId = await addPrinter(page, buildId, 'Retry Bench Three');
	try {
		const plate = (await view(page, buildId)).plates[0];
		await page.goto(`/builds/${buildId}`);
		await page.waitForLoadState('networkidle');

		// A: linked by hand, then cancelled and left unlogged.
		mock.printing('notice-a.gcode', 39, { ticks: 2340, totalTicks: 6000 });
		const unlinkedA = page.getByTestId('unlinked-job').filter({ hasText: 'notice-a.gcode' });
		await expect(unlinkedA).toBeVisible({ timeout: 20_000 });
		await unlinkedA.getByTestId('link-plate').selectOption(String(plate.number));
		await expect(page.getByTestId('now-card')).toContainText(`Plate ${plate.number}`, {
			timeout: 15_000
		});
		// Nothing earlier to warn about yet.
		await expect(page.getByTestId('linked-unlogged')).toHaveCount(0);
		mock.set({ printStatus: 8, machineStatus: [0], progress: 39 });
		const prompt = page.getByTestId('confirm-print-log');
		await expect(prompt).toContainText('notice-a.gcode', { timeout: 20_000 });

		// B: linking it through the dropdown goes through at once and then says A is unlogged.
		mock.printing('notice-b.gcode', 30, { ticks: 5400, totalTicks: 18000 });
		const unlinkedB = page.getByTestId('unlinked-job').filter({ hasText: 'notice-b.gcode' });
		await expect(unlinkedB).toBeVisible({ timeout: 20_000 });
		await unlinkedB.getByTestId('link-plate').selectOption(String(plate.number));
		await expect(unlinkedB).toBeHidden({ timeout: 15_000 });
		const notice = page.getByTestId('linked-unlogged');
		await expect(notice).toBeVisible();
		await expect(notice).toContainText(`Plate ${plate.number} has an unlogged`);
		await expect(page.getByTestId('expected-unlogged')).toHaveCount(0);
		if (process.env.TMT_SHOTS) {
			for (const [w, scheme] of [
				[390, 'light'],
				[390, 'dark'],
				[1440, 'light'],
				[1440, 'dark']
			] as const) {
				await page.emulateMedia({ colorScheme: scheme });
				await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
				await notice.scrollIntoViewIfNeeded();
				await page.screenshot({ path: `data/shots/link-notice-${w}-${scheme}.png` });
			}
			await page.emulateMedia({ colorScheme: null });
			await page.setViewportSize({ width: 1440, height: 900 });
		}

		// "Open print log" takes the user to A's Confirm print log.
		await notice.getByTestId('linked-unlogged-open').click();
		await expect(prompt).toBeFocused();

		// Logging A removes the notice.
		await prompt.getByTestId('confirm-result').selectOption('Failed');
		await prompt.getByTestId('confirm-log').click();
		await expect(prompt).toBeHidden({ timeout: 15_000 });
		await expect(notice).toBeHidden({ timeout: 15_000 });
	} finally {
		mock.set(IDLE);
		await removePrinter(page, printerId);
	}
});
