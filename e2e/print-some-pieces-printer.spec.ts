import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild, row } from './helpers';
import { confirmOnPrinter, confirmWhere } from './status-helpers';
import type { Locator, Page } from '@playwright/test';

/**
 * "Print some pieces…" with a printer connected: confirming a subset asks "Where is it printing?",
 * and the printer's job is then linked to exactly the picked pieces of Harness and Straps (slug
 * `harness`, 9 pieces, alone on plate 18 of the tuned layout).
 */

const HARNESS = 'harness';
const N = 9;
const PLATE = 18;
const PICKED = [0, 1, 2];

let mock: MockSdcp;
const idle = () => mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
test.beforeAll(async () => {
	mock = new MockSdcp();
	await mock.start();
});
test.afterAll(async () => {
	idle();
	await mock.stop();
});

interface ViewJson {
	parts: { slug: string; components: { name: string }[] }[];
	runs: {
		plateNumber: number | null;
		partSlug: string | null;
		result: string;
		comps?: number[] | null;
	}[];
	state: Record<
		string,
		{ status: string; comps: Record<string, boolean>; printingComps?: number[] | null }
	>;
}
interface JobsJson {
	organizationId: string;
	jobs: {
		fileName: string;
		plateNumber: number | null;
		partSlugs: string[] | null;
		comps?: number[] | null;
	}[];
	expected: { plateNumber: number; partSlugs: string[] | null; comps?: number[] | null }[];
}

const view = async (page: Page, id: string) =>
	(await (await page.request.get(`/api/builds/${id}/view`)).json()) as ViewJson;
const jobs = async (page: Page, id: string) =>
	(await (await page.request.get(`/api/builds/${id}/printer-jobs`)).json()) as JobsJson;
const ticks = (v: ViewJson) =>
	Object.entries(v.state[HARNESS].comps)
		.filter(([, on]) => on)
		.map(([i]) => Number(i))
		.sort((a, b) => a - b);

/** A build in a team with one enabled mock printer. */
async function setup(page: Page, label: string) {
	idle();
	const { buildId } = await ownerWithBuild(page, label);
	const { organizationId } = await jobs(page, buildId);
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId,
			name: 'Pieces Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	return { buildId };
}

/** Print tab, grouped by plate: returns plate 18's heading. */
async function openPrint(page: Page, buildId: string) {
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
	const h = page.locator('.group-head').filter({
		has: page.locator(`[data-testid="plate-status"][aria-label^="Plate ${PLATE} status"]`)
	});
	await expect(h).toBeVisible();
	return h;
}

/** Picks the first three pieces in the picker and confirms. */
async function pickSome(page: Page, buildId: string): Promise<Locator> {
	const h = await openPrint(page, buildId);
	await h.getByTestId('plate-print-some-pieces').click();
	const dlg = h.getByTestId('piece-pick');
	await expect(dlg).toBeVisible();
	const items = dlg.getByTestId('piece-pick-item');
	for (let i = PICKED.length; i < N; i++) await items.nth(i).getByRole('checkbox').uncheck();
	await expect(dlg.getByTestId('piece-pick-confirm')).toHaveText(
		`Mark ${PICKED.length} of ${N} pieces printing`
	);
	await dlg.getByTestId('piece-pick-confirm').click();
	return h;
}

const sorted = (a: number[] | null | undefined) => [...(a ?? [])].sort((x, y) => x - y);

test('Some pieces with a printer: Where, then the job is linked to exactly them, finished, logged', async ({
	page
}) => {
	test.setTimeout(150_000);
	const { buildId } = await setup(page, 'pcprinter');
	const h = await pickSome(page, buildId);
	const v0 = await view(page, buildId);
	const pieceNames = PICKED.map(
		(i) => v0.parts.find((p) => p.slug === HARNESS)!.components[i].name
	);

	// The dialog names the pieces.
	const where = page.getByTestId('where-printing');
	await expect(where).toBeVisible();
	await expect(where.getByTestId('where-parts')).toContainText(
		`3 of ${N} pieces of Harness and Straps: ${pieceNames.join(', ')}`
	);
	await confirmOnPrinter(page);
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	await expect(row(page, HARNESS).getByTestId('part-pieces')).toHaveText(
		`0/${N} pieces · 3 printing`
	);
	expect((await view(page, buildId)).state[HARNESS].printingComps).toEqual(PICKED);
	await expect(h.getByTestId('plate-print-some-pieces')).toHaveCount(0);

	// The printer starts a job: it is expected for exactly those pieces.
	mock.printing('benchy.gcode', 10);
	await expect
		.poll(async () => sorted((await jobs(page, buildId)).expected[0]?.comps), { timeout: 20_000 })
		.toEqual(PICKED);

	await page.goto(`/builds/${buildId}`);
	const ask = page.getByTestId('expected-confirm');
	await expect(ask).toHaveCount(1, { timeout: 20_000 });
	await expect(ask).toBeVisible();
	await expect(ask).toContainText(`3 of ${N} pieces`);
	await ask.getByTestId('expected-confirm-go').click();
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);
	await expect
		.poll(async () => sorted((await jobs(page, buildId)).jobs[0]?.comps), { timeout: 15_000 })
		.toEqual(PICKED);
	// Nothing is ticked while it prints.
	expect(ticks(await view(page, buildId))).toEqual([]);

	// Finish: the log prompt names the pieces and covers only them.
	mock.set({ printStatus: 9, machineStatus: [0], progress: 100 });
	const prompt = page.getByTestId('confirm-print-log');
	await expect(prompt).toBeVisible({ timeout: 20_000 });
	await expect(prompt).toContainText(`3 of ${N} pieces`);
	await prompt.getByTestId('confirm-grams').fill('30');
	await prompt.getByTestId('confirm-log').click();
	await expect(prompt).toBeHidden({ timeout: 15_000 });
	await expect
		.poll(async () => ticks(await view(page, buildId)), { timeout: 15_000 })
		.toEqual(PICKED);
	const after = await view(page, buildId);
	expect(after.state[HARNESS].status).toBe('To print');
	expect(after.state[HARNESS].printingComps ?? []).toEqual([]);
	const runs = after.runs.filter((r) => r.partSlug === HARNESS);
	expect(runs).toHaveLength(1);
	expect(runs[0]).toMatchObject({ result: 'Success', comps: PICKED });
	idle();
});

test('"Not on a connected printer" keeps the direct start for the picked pieces', async ({
	page
}) => {
	const { buildId } = await setup(page, 'pcnone');
	await pickSome(page, buildId);
	await confirmWhere(page, 'none');
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');
	await expect(row(page, HARNESS).getByTestId('part-pieces')).toHaveText(
		`0/${N} pieces · 3 printing`
	);
	expect((await view(page, buildId)).state[HARNESS].printingComps).toEqual(PICKED);
	expect((await jobs(page, buildId)).expected).toHaveLength(0);
});

test('A stopped job that is not logged leaves the part To print with no piece list', async ({
	page
}) => {
	test.setTimeout(150_000);
	const { buildId } = await setup(page, 'pccancel');
	await pickSome(page, buildId);
	await confirmOnPrinter(page);
	await expect(row(page, HARNESS)).toHaveAttribute('data-s', 'Printing');

	mock.printing('benchy.gcode', 10);
	// The job is expected once the supervisor has seen it: open the Overview only then.
	await expect
		.poll(async () => sorted((await jobs(page, buildId)).expected[0]?.comps), { timeout: 20_000 })
		.toEqual(PICKED);
	await page.goto(`/builds/${buildId}`);
	const ask = page.getByTestId('expected-confirm');
	await expect(ask).toHaveCount(1, { timeout: 20_000 });
	await ask.getByTestId('expected-confirm-go').click();
	await expect
		.poll(async () => sorted((await jobs(page, buildId)).jobs[0]?.comps), { timeout: 15_000 })
		.toEqual(PICKED);

	// Cancelled on the printer: the prompt says so, and "Don't log" ends it.
	mock.set({ printStatus: 8, machineStatus: [0] });
	const prompt = page.getByTestId('confirm-print-log');
	await expect(prompt).toContainText('was stopped', { timeout: 20_000 });
	await expect(prompt).toContainText(`3 of ${N} pieces`);
	await prompt.getByTestId('confirm-dismiss').click();
	await expect(prompt).toBeHidden({ timeout: 15_000 });
	idle();

	await expect
		.poll(async () => (await view(page, buildId)).state[HARNESS].status, { timeout: 15_000 })
		.toBe('To print');
	const v = await view(page, buildId);
	expect(v.state[HARNESS].printingComps ?? []).toEqual([]);
	expect(ticks(v)).toEqual([]);
	expect(v.runs.filter((r) => r.partSlug === HARNESS)).toHaveLength(0);
});
