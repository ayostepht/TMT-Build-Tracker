import { MockSdcp } from '../src/lib/server/printers/mock-sdcp';
import { expect, test } from './fixtures';
import { keepPrintedVisible, ownerWithBuild, row } from './helpers';
import { chooseStatus, confirmWhere } from './status-helpers';
import type { Page } from '@playwright/test';

/**
 * "Print some parts…" with a printer connected: confirming a subset asks "Where is it printing?",
 * and the printer's job is then linked to exactly the picked parts.
 */

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
	plates: { number: number; parts: string[]; perPartRuns: boolean; runs: number }[];
	state: Record<string, { status: string }>;
}
interface JobsJson {
	organizationId: string;
	jobs: { fileName: string; plateNumber: number | null; partSlugs: string[] | null }[];
	expected: { plateNumber: number; partSlugs: string[] | null }[];
}

const view = async (page: Page, id: string) =>
	(await (await page.request.get(`/api/builds/${id}/view`)).json()) as ViewJson;
const jobs = async (page: Page, id: string) =>
	(await (await page.request.get(`/api/builds/${id}/printer-jobs`)).json()) as JobsJson;

/** A build in a team with one enabled mock printer, and its biggest single-run plate. */
async function setup(page: Page, label: string) {
	idle();
	const { buildId } = await ownerWithBuild(page, label);
	const { organizationId } = await jobs(page, buildId);
	const created = await page.request.post('/api/printers', {
		data: {
			organizationId,
			name: 'Subset Centauri',
			kind: 'elegoo-sdcp',
			host: '127.0.0.1',
			port: mock.port,
			secrets: { mainboardId: 'ABCDEF' }
		}
	});
	expect(created.ok()).toBe(true);
	const ok = (await view(page, buildId)).plates.filter(
		(p) => !p.perPartRuns && p.runs <= 1 && p.parts.length >= 3
	);
	expect(ok.length).toBeGreaterThan(0);
	const plate = ok.sort((a, b) => b.parts.length - a.parts.length)[0];
	return { buildId, plate };
}

/** Print tab, grouped by plate: pick all but the first part and confirm; returns the picked slugs. */
async function pickSome(page: Page, buildId: string, plate: { number: number; parts: string[] }) {
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
	const head = page.locator('.group-head').filter({
		has: page.locator(`[data-testid="plate-status"][aria-label^="Plate ${plate.number} status"]`)
	});
	await head.getByTestId('plate-print-some').click();
	const dlg = head.getByTestId('part-pick');
	await expect(dlg).toBeVisible();
	await dlg.getByTestId('part-pick-item').first().getByRole('checkbox').uncheck();
	await dlg.getByTestId('part-pick-confirm').click();
	return plate.parts.slice(1);
}

const sorted = (a: string[] | null | undefined) => [...(a ?? [])].sort();

test('Some parts with a printer: Where is it printing, then the job is linked to exactly them', async ({
	page
}) => {
	test.setTimeout(150_000);
	const { buildId, plate } = await setup(page, 'subprinter');
	const picked = await pickSome(page, buildId, plate);
	// The dialog names the parts of a partial start.
	const where = page.getByTestId('where-printing');
	await expect(where).toBeVisible();
	await expect(where.getByTestId('where-parts')).toContainText(
		`${picked.length} of ${plate.parts.length} parts of plate ${plate.number}`
	);
	await confirmWhere(page, 'first');
	for (const s of picked) await expect(row(page, s)).toHaveAttribute('data-s', 'Printing');
	await expect(row(page, plate.parts[0])).toHaveAttribute('data-s', 'To print');

	// The printer starts a job: it is expected for exactly the picked parts.
	mock.printing('benchy.gcode', 10);
	await expect
		.poll(async () => sorted((await jobs(page, buildId)).expected[0]?.partSlugs), {
			timeout: 20_000
		})
		.toEqual(sorted(picked));

	await page.goto(`/builds/${buildId}`);
	const ask = page.getByTestId('expected-confirm');
	await expect(ask).toHaveCount(1, { timeout: 20_000 });
	await expect(ask).toBeVisible();
	await expect(ask).toContainText(`${picked.length} of ${plate.parts.length} parts`);
	await ask.getByTestId('expected-confirm-go').click();
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);
	await expect
		.poll(async () => sorted((await jobs(page, buildId)).jobs[0]?.partSlugs), { timeout: 15_000 })
		.toEqual(sorted(picked));
	expect((await view(page, buildId)).state[plate.parts[0]].status).toBe('To print');

	// Finish: the log prompt covers only the picked parts.
	mock.set({ printStatus: 9, machineStatus: [0], progress: 100 });
	const prompt = page.getByTestId('confirm-print-log');
	await expect(prompt).toBeVisible({ timeout: 20_000 });
	await prompt.getByTestId('confirm-grams').fill('30');
	await prompt.getByTestId('confirm-log').click();
	await expect(prompt).toBeHidden({ timeout: 15_000 });
	await expect
		.poll(async () => {
			const s = (await view(page, buildId)).state;
			return [...picked.map((x) => s[x].status), s[plate.parts[0]].status];
		})
		.toEqual([...picked.map(() => 'Printed'), 'To print']);
	idle();
});

test('A whole-plate start names no parts in the Where dialog', async ({ page }) => {
	const { buildId, plate } = await setup(page, 'subwhole');
	await keepPrintedVisible(page, buildId);
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Group by').selectOption('plate');
	const badge = page.locator(
		`.group-head [data-testid="plate-status"][aria-label^="Plate ${plate.number} status"]`
	);
	await chooseStatus(badge, 'Printing');
	const where = page.getByTestId('where-printing');
	await expect(where).toBeVisible();
	await expect(where.getByTestId('where-parts')).toHaveCount(0);
	await confirmWhere(page, 'none');
});

test('"Not on a connected printer" keeps the direct start for the picked parts', async ({
	page
}) => {
	const { buildId, plate } = await setup(page, 'subnone');
	const picked = await pickSome(page, buildId, plate);
	await confirmWhere(page, 'none');
	await expect(page.locator('.toasts')).toContainText(
		`Started ${picked.length} parts of plate ${plate.number}`
	);
	for (const s of picked) await expect(row(page, s)).toHaveAttribute('data-s', 'Printing');
	await expect(row(page, plate.parts[0])).toHaveAttribute('data-s', 'To print');
	expect((await jobs(page, buildId)).expected).toHaveLength(0);
});

test('A print already running is linked to the picked parts at once, without a confirm', async ({
	page
}) => {
	test.setTimeout(150_000);
	const { buildId, plate } = await setup(page, 'subrunning');
	await page.goto(`/builds/${buildId}`);
	await page.waitForLoadState('networkidle');
	mock.printing('benchy.gcode', 8);
	await expect(page.getByTestId('link-plate')).toBeVisible({ timeout: 20_000 });

	const picked = await pickSome(page, buildId, plate);
	await confirmWhere(page, 'first');
	await expect(page.locator('.toasts').filter({ hasText: `to plate ${plate.number}` })).toBeVisible(
		{ timeout: 15_000 }
	);
	await expect
		.poll(
			async () =>
				sorted(
					(await jobs(page, buildId)).jobs.find((j) => j.fileName === 'benchy.gcode')?.partSlugs
				),
			{ timeout: 15_000 }
		)
		.toEqual(sorted(picked));
	await expect(page.getByTestId('expected-confirm')).toHaveCount(0);
	expect((await view(page, buildId)).state[plate.parts[0]].status).toBe('To print');
	idle();
});
