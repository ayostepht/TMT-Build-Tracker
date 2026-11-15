import { expect, test } from './fixtures';
import { invite, joinViaInvite, ownerWithBuild, uniqueEmail } from './helpers';
import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * #46: spool adds. A color's stock is its starting spools plus the spools added later with + on
 * the Overview, each with a date, who and an optional note; editors add and remove, viewers read.
 */

const origin = (page: Page) => ({ origin: new URL(page.url()).origin });

interface ViewJson {
	filaments: {
		key: string;
		spools: number;
		spoolAdds?: { id: string; kg: number; note?: string }[];
	}[];
}
const viewOf = async (page: Page, buildId: string) =>
	(await (await page.request.get(`/api/builds/${buildId}/view`)).json()) as ViewJson;

/** An owner with a build, an editor and a viewer in the same chapter (each in its own context). */
async function team(page: Page, browser: Browser) {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'spoolstock');
	const contexts: BrowserContext[] = [];
	const join = async (role: 'editor' | 'viewer', name: string) => {
		await page.goto(chapterUrl);
		const email = uniqueEmail(role);
		const link = await invite(page, email, role);
		const joined = await joinViaInvite(browser, link, name, email);
		contexts.push(joined.context);
		return joined.page;
	};
	const editor = await join('editor', 'Eddie Editor');
	const viewer = await join('viewer', 'Vera Viewer');
	return { buildId, editor, viewer, contexts };
}

const tileOf = (page: Page) => page.getByTestId('filament-tile').first();
const kgOf = async (tile: ReturnType<typeof tileOf>) =>
	Number(
		(await tile.getByTestId('spool-total').locator('.ft-total-n').innerText()).replace(' kg', '')
	);
/** Spare grams of a tile: negative when the badge says "short". */
const spareOf = async (tile: ReturnType<typeof tileOf>) => {
	const t = (await tile.getByTestId('filament-spare').innerText()).replace(/,/g, '');
	const n = Number(/(\d+)/.exec(t)![1]);
	return /short/.test(t) ? -n : n;
};

test('an editor adds spools with a note, sees the history, and removes one; a viewer only reads', async ({
	page,
	browser
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { buildId, editor, viewer, contexts } = await team(page, browser);
	try {
		const e = editor;
		await e.goto(`/builds/${buildId}`);
		await e.waitForLoadState('networkidle');
		const tile = tileOf(e);
		const role = (await tile.getAttribute('data-role')) as string;
		const kg0 = await kgOf(tile);
		const spare0 = await spareOf(tile);

		// + opens the form; Cancel closes it without adding anything.
		await tile.getByTestId('spool-add').click();
		await expect(tile.getByTestId('spool-form')).toBeVisible();
		await tile.getByTestId('spool-cancel').click();
		await expect(tile.getByTestId('spool-form')).toHaveCount(0);
		await expect(tile.getByTestId('spool-history')).toHaveCount(0);

		// Add 2 kg with a note: total and Spare go up by that much, the history opens.
		await tile.getByTestId('spool-add').click();
		await tile.getByTestId('spool-kg').fill('2');
		await tile.getByTestId('spool-note').fill('bought a roll');
		await tile.getByTestId('spool-save').click();
		await expect(tile.getByTestId('spool-form')).toHaveCount(0);
		await expect.poll(() => kgOf(tile)).toBeCloseTo(kg0 + 2, 2);
		await expect.poll(() => spareOf(tile)).toBeGreaterThanOrEqual(spare0 + 1999);
		expect(await spareOf(tile)).toBeLessThanOrEqual(spare0 + 2001);

		const history = tile.getByTestId('spool-history');
		await expect(history).toBeVisible();
		await expect(tile.getByTestId('spool-start')).toContainText('Starting spools');
		await expect(tile.getByTestId('spool-start')).toContainText(`${kg0} kg`);
		const rows = tile.getByTestId('spool-add-row');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('Added 2 kg');
		await expect(rows.first()).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
		await expect(rows.first()).toContainText('Eddie Editor');
		await expect(rows.first()).toContainText('bought a roll');

		// A second add without a note.
		await tile.getByTestId('spool-add').click();
		await tile.getByTestId('spool-kg').fill('0.5');
		await tile.getByTestId('spool-save').click();
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(1)).toContainText('Added 0.5 kg');
		await expect(rows.nth(1)).not.toContainText('bought a roll');
		await expect.poll(() => kgOf(tile)).toBeCloseTo(kg0 + 2.5, 2);

		// Remove asks inline first; No keeps it, Yes removes it.
		await rows.nth(1).getByTestId('spool-remove').click();
		await expect(rows.nth(1)).toContainText('Remove?');
		await rows.nth(1).getByTestId('spool-remove-no').click();
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(1).getByTestId('spool-remove')).toBeVisible();
		await rows.nth(1).getByTestId('spool-remove').click();
		await rows.nth(1).getByTestId('spool-remove-yes').click();
		await expect(rows).toHaveCount(1);
		await expect.poll(() => kgOf(tile)).toBeCloseTo(kg0 + 2, 2);
		const stored = (await viewOf(e, buildId)).filaments.find((f) => f.key === role)!;
		expect(stored.spoolAdds?.map((a) => a.kg)).toEqual([2]);

		// Activity: an add and a removal sentence.
		await e.getByRole('link', { name: 'Activity', exact: true }).click();
		await expect(e).toHaveURL(/\/activity$/);
		const feed = e.locator('.activity li');
		await expect(feed.filter({ hasText: /added 2 kg of .*\(bought a roll\)/ })).toHaveCount(1);
		await expect(feed.filter({ hasText: /added 0\.5 kg of / })).toHaveCount(1);
		await expect(feed.filter({ hasText: /removed an added spool of .*\(0\.5 kg\)/ })).toHaveCount(
			1
		);

		// A viewer sees the stock and the history, but no + and no Remove.
		await viewer.setViewportSize({ width: 1440, height: 900 });
		await viewer.goto(`/builds/${buildId}`);
		await viewer.waitForLoadState('networkidle');
		const vt = tileOf(viewer);
		await expect(vt.getByTestId('spool-total')).toBeVisible();
		await expect(vt.getByTestId('spool-add')).toHaveCount(0);
		await vt.getByTestId('spool-total').click();
		await expect(vt.getByTestId('spool-history')).toBeVisible();
		await expect(vt.getByTestId('spool-add-row')).toHaveCount(1);
		await expect(vt.getByTestId('spool-add-row')).toContainText('Added 2 kg');
		await expect(vt.getByTestId('spool-add-row')).toContainText('Eddie Editor');
		await expect(vt.getByTestId('spool-remove')).toHaveCount(0);
		await expect(vt.getByRole('link', { name: 'Change in Settings' })).toHaveCount(0);
		// The editor also gets the link to the starting spools.
		await e.goto(`/builds/${buildId}`);
		await e.waitForLoadState('networkidle');
		await tileOf(e).getByTestId('spool-total').click();
		await expect(tileOf(e).getByRole('link', { name: 'Change in Settings' })).toBeVisible();
	} finally {
		for (const c of contexts) await c.close();
	}
});

test('API: viewers are refused, bad weights and notes get 400, drafts refuse, the cap holds', async ({
	page,
	browser
}) => {
	test.setTimeout(150_000);
	const { buildId, editor, viewer, contexts } = await team(page, browser);
	try {
		const role = (await viewOf(editor, buildId)).filaments[0].key;
		const base = `/api/builds/${buildId}/filaments/${role}/stock`;
		const post = (p: Page, data: unknown, path = base) =>
			p.request.post(path, { data, headers: origin(editor) });

		// Viewer: 403 for both, nothing stored.
		expect((await post(viewer, { kg: 1 })).status()).toBe(403);
		expect(
			(await viewer.request.delete(`${base}/nope`, { headers: origin(editor) })).status()
		).toBe(403);

		// Weights: 0.01 to 99 kg; the note at most 200 characters.
		for (const kg of [0, 0.004, -1, 99.5, 100, 'abc', null])
			expect((await post(editor, { kg })).status(), `kg ${String(kg)}`).toBe(400);
		expect((await post(editor, {})).status()).toBe(400);
		expect((await post(editor, { kg: 1, note: 'x'.repeat(201) })).status()).toBe(400);
		expect(
			(await post(editor, { kg: 1 }, `/api/builds/${buildId}/filaments/nope/stock`)).status()
		).toBe(404);
		expect((await viewOf(editor, buildId)).filaments[0].spoolAdds ?? []).toHaveLength(0);

		// A valid add keeps two decimals and returns its id; removing it needs that id.
		const ok = await post(editor, { kg: 1.234, note: 'x'.repeat(200) });
		expect(ok.ok()).toBe(true);
		const { id } = (await ok.json()) as { id: string };
		expect(id).toBeTruthy();
		const adds = (await viewOf(editor, buildId)).filaments[0].spoolAdds!;
		expect(adds.map((a) => a.kg)).toEqual([1.23]);
		expect(
			(await editor.request.delete(`${base}/not-an-id`, { headers: origin(editor) })).status()
		).toBe(404);
		expect((await editor.request.delete(`${base}/${id}`, { headers: origin(editor) })).ok()).toBe(
			true
		);
		expect((await viewOf(editor, buildId)).filaments[0].spoolAdds ?? []).toHaveLength(0);

		// 100 adds per color at most.
		for (let i = 0; i < 100; i++)
			expect((await post(editor, { kg: 0.01 })).ok(), `add ${i + 1}`).toBe(true);
		expect((await post(editor, { kg: 0.01 })).status()).toBe(400);
		expect((await viewOf(editor, buildId)).filaments[0].spoolAdds).toHaveLength(100);

		// A Studio draft has no stock: the API refuses and the tracking pages bounce to Design.
		await page.goto('/studio');
		await page.waitForLoadState('networkidle');
		await page.getByTestId('new-draft').click();
		await page.getByTestId('create-draft').click();
		await expect(page).toHaveURL(/\/builds\/[^/]+\/design/);
		const draftId = new URL(page.url()).pathname.split('/')[2];
		const draftRole = (await viewOf(page, draftId)).filaments[0].key;
		const refused = await page.request.post(`/api/builds/${draftId}/filaments/${draftRole}/stock`, {
			data: { kg: 1 },
			headers: origin(page)
		});
		expect(refused.status()).toBe(400);
		await page.goto(`/builds/${draftId}`);
		await expect(page).toHaveURL(new RegExp(`/builds/${draftId}/design`));
		await expect(page.getByTestId('spool-add')).toHaveCount(0);
		await expect(page.getByTestId('filament-tiles')).toHaveCount(0);
	} finally {
		for (const c of contexts) await c.close();
	}
});

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test('spools on the Overview fit at 390 and 360 px: form, history and confirm, no sideways scroll', async ({
		page
	}) => {
		const { buildId } = await ownerWithBuild(page, 'spoolphone');
		const noScroll = () =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
			);
		const longNote = 'Bought a spare roll from the shop next door because the old one ran out';

		for (const width of [390, 360]) {
			await page.setViewportSize({ width, height: 844 });
			await page.goto(`/builds/${buildId}`);
			await page.waitForLoadState('networkidle');
			const tile = tileOf(page);
			// The spool controls sit behind the row on phones; open it first.
			const head = tile.locator('.ft-head');
			await expect(tile.getByTestId('spool-add')).toHaveCount(0);
			await expect(async () => {
				if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
				await expect(head).toHaveAttribute('aria-expanded', 'true', { timeout: 1500 });
			}).toPass();
			const plus = tile.getByTestId('spool-add');
			await expect(plus).toBeVisible();
			for (const loc of [plus, tile.getByTestId('spool-total')])
				expect((await loc.boundingBox())!.height).toBeGreaterThanOrEqual(44);
			expect(await noScroll(), `rows at ${width}`).toBe(true);

			await plus.click();
			await expect(tile.getByTestId('spool-form')).toBeVisible();
			await tile.getByTestId('spool-kg').fill('1.25');
			await tile.getByTestId('spool-note').fill(longNote);
			expect(await noScroll(), `form at ${width}`).toBe(true);
			await tile.getByTestId('spool-save').click();
			await expect(tile.getByTestId('spool-form')).toHaveCount(0);

			const added = tile.getByTestId('spool-add-row');
			await expect(added.last()).toContainText(longNote);
			await expect(added.last()).toContainText('Olive Owner');
			expect(await noScroll(), `history at ${width}`).toBe(true);

			// The inline remove confirmation fits too; then remove this width's add.
			const count = await added.count();
			await added.last().getByTestId('spool-remove').click();
			await expect(added.last().getByTestId('spool-remove-yes')).toBeVisible();
			expect(await noScroll(), `confirm at ${width}`).toBe(true);
			await added.last().getByTestId('spool-remove-yes').click();
			await expect(added).toHaveCount(count - 1);
			expect(await noScroll(), `after remove at ${width}`).toBe(true);
		}
	});
});
