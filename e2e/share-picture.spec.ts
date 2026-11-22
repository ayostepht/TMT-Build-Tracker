import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createBuild, createChapter, invite, joinViaInvite, signUp, uniqueEmail } from './helpers';

// "Share a picture" (issue #99). The e2e server has no MakeGood kit, so the build has no 3D model and
// the button is hidden. This spec gives the build's template a synthetic one (three boxes, no MakeGood
// data): a `template_models` row plus placements, with the GLB served from the browser side through
// `context.route`. The template-level rows are restored in afterAll.

const DB = 'data/e2e/tmt.db';
const TABLES = ['template_models', 'template_part_placements'] as const;
const SLUGS = ['wing-left', 'wing-right', 'footrest'];
const snapshot: Record<string, unknown[]> = {};
let templateId = '';

/** A GLB with one box mesh per node, each node named by part slug. */
function boxGlb(names: string[]): Buffer {
	const v = [
		[-1, -1, -1],
		[1, -1, -1],
		[1, 1, -1],
		[-1, 1, -1],
		[-1, -1, 1],
		[1, -1, 1],
		[1, 1, 1],
		[-1, 1, 1]
	].map((p) => p.map((x) => x * 40));
	const idx = [
		0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0,
		4, 3, 4, 7
	];
	const pos = Buffer.alloc(v.length * 12);
	v.forEach((p, i) => p.forEach((x, k) => pos.writeFloatLE(x, i * 12 + k * 4)));
	const ind = Buffer.alloc(idx.length * 2);
	idx.forEach((x, i) => ind.writeUInt16LE(x, i * 2));
	const bin = Buffer.concat([pos, ind]);
	const json = {
		asset: { version: '2.0' },
		scene: 0,
		scenes: [{ nodes: names.map((_, i) => i) }],
		nodes: names.map((name) => ({ name, mesh: 0 })),
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
		buffers: [{ byteLength: bin.length }],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
			{ buffer: 0, byteOffset: pos.length, byteLength: ind.length, target: 34963 }
		],
		accessors: [
			{
				bufferView: 0,
				componentType: 5126,
				count: v.length,
				type: 'VEC3',
				min: [-40, -40, -40],
				max: [40, 40, 40]
			},
			{ bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' }
		]
	};
	let j = Buffer.from(JSON.stringify(json));
	j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
	const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
	const head = Buffer.alloc(12);
	head.write('glTF', 0, 'latin1');
	head.writeUInt32LE(2, 4);
	head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
	const ch = (len: number, type: string) => {
		const h = Buffer.alloc(8);
		h.writeUInt32LE(len, 0);
		h.write(type, 4, 'latin1');
		return h;
	};
	return Buffer.concat([head, ch(j.length, 'JSON'), j, ch(b.length, 'BIN\0'), b]);
}
const GLB = boxGlb(SLUGS);

/** Serves the synthetic GLB for any template model URL in this context. */
async function serveModel(context: BrowserContext) {
	await context.route('**/api/templates/*/model.glb*', (route) =>
		route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: GLB })
	);
}

/** Gives the build's template a synthetic 3D model (once per run). */
function seedModel(buildId: string) {
	const db = new Database(DB);
	try {
		const id = (
			db.prepare('select template_id as id from builds where id = ?').get(buildId) as {
				id: string;
			}
		).id;
		if (templateId) return;
		templateId = id;
		for (const t of TABLES)
			snapshot[t] = db.prepare(`select * from ${t} where template_id = ?`).all(id);
		for (const t of TABLES) db.prepare(`delete from ${t} where template_id = ?`).run(id);
		db.prepare(
			'insert into template_models (template_id, glb_path, version, size, slugs, source_note) values (?,?,?,?,?,?)'
		).run(id, 'e2e-synthetic.glb', 'e2e-share', GLB.length, JSON.stringify(SLUGS), 'e2e');
		SLUGS.forEach((slug, i) => {
			const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, (i - 1) * 100, 0, 0, 1];
			db.prepare(
				'insert into template_part_placements (template_id, slug, matrix, instances, placed) values (?,?,?,?,1)'
			).run(id, slug, JSON.stringify(m), '[]');
		});
	} finally {
		db.close();
	}
}

test.afterAll(() => {
	if (!templateId) return;
	const db = new Database(DB);
	try {
		for (const t of TABLES) {
			db.prepare(`delete from ${t} where template_id = ?`).run(templateId);
			for (const row of snapshot[t] ?? []) {
				const cols = Object.keys(row as object);
				db.prepare(
					`insert into ${t} (${cols.join(',')}) values (${cols.map((c) => '@' + c).join(',')})`
				).run(row as object);
			}
		}
	} finally {
		db.close();
	}
});

const BUILD_NAME = 'Zorblax Unique Build';

async function ownerBuild(page: Page, label: string) {
	await serveModel(page.context());
	await signUp(page, 'Olive Owner', uniqueEmail(label));
	const chapter = `Quillfeather ${label} ${Date.now().toString(36)}`;
	await createChapter(page, chapter);
	const chapterUrl = page.url();
	const buildId = await createBuild(page, BUILD_NAME);
	seedModel(buildId);
	return { buildId, chapter, chapterUrl };
}

async function openDialog(page: Page, buildId: string) {
	await page.goto(`/builds/${buildId}/design`);
	await page.getByTestId('open-share-picture').click();
	const dialog = page.getByTestId('share-picture-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('share-picture-preview')).toHaveAttribute('src', /^blob:/);
	await expect(dialog.getByTestId('share-picture-download')).toBeEnabled();
	return dialog;
}

async function download(page: Page) {
	const [dl] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('share-picture-download').click()
	]);
	const buf = await readFile((await dl.path())!);
	return { name: dl.suggestedFilename(), buf };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngSize(buf: Buffer) {
	expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
	expect(buf.subarray(12, 16).toString('latin1')).toBe('IHDR');
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('the button opens the dialog with a preview and neutral default texts', async ({ page }) => {
	const { buildId } = await ownerBuild(page, 'sp-open');
	const dialog = await openDialog(page, buildId);
	await expect(dialog.getByTestId('share-picture-title')).toHaveValue("Your chair's colors");
	const line = await dialog.getByTestId('share-picture-line').inputValue();
	const title = await dialog.getByTestId('share-picture-title').inputValue();
	expect(`${title} ${line}`).not.toMatch(/TMT/);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('share-picture-dialog')).toHaveCount(0);
});

test('the setup wizard does not offer the button', async ({ page }) => {
	await serveModel(page.context());
	await signUp(page, 'Wendy Wizard', uniqueEmail('sp-wiz'));
	await createChapter(page, `Wizard ${Date.now().toString(36)}`);
	// Reach the wizard directly: a new build lands in setup (createBuild would skip it).
	await page.getByTestId('new-build').click();
	await page.getByLabel('Name', { exact: true }).fill('Wizard chair');
	await page.getByRole('button', { name: 'Create build' }).click();
	await expect(page).toHaveURL(/\/builds\/[^/]+\/setup/);
	seedModel(new URL(page.url()).pathname.split('/')[2]);
	await page.reload();
	await expect(page.getByTestId('design-actions').first()).toBeVisible();
	await expect(page.getByTestId('open-share-picture')).toHaveCount(0);
});

test('downloads a family PNG at 1600 x 2000 and a JPEG on request', async ({ page }) => {
	const { buildId } = await ownerBuild(page, 'sp-dl');
	const dialog = await openDialog(page, buildId);
	const png = await download(page);
	expect(png.name).toBe('tmt-chair-family.png');
	expect(pngSize(png.buf)).toEqual({ w: 1600, h: 2000 });

	await dialog.getByTestId('share-picture-format').selectOption('jpeg');
	await expect(dialog.getByTestId('share-picture-download')).toBeEnabled();
	await expect(dialog.getByTestId('share-picture-download')).toContainText('JPEG');
	const jpg = await download(page);
	expect(jpg.name).toMatch(/\.jpg$/);
	expect([...jpg.buf.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
});

test('social pictures come in three sizes with the right pixels and file names', async ({
	page
}) => {
	const { buildId } = await ownerBuild(page, 'sp-sizes');
	const dialog = await openDialog(page, buildId);
	await dialog.getByTestId('share-picture-variant-social').click();
	const sizes = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920] } as const;
	for (const [size, [w, h]] of Object.entries(sizes)) {
		await dialog.getByTestId(`share-picture-size-${size}`).click();
		await expect(dialog.getByTestId(`share-picture-size-${size}`)).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(dialog.getByTestId('share-picture-download')).toBeEnabled();
		const out = await download(page);
		expect(out.name).toBe(`tmt-chair-social-${size}.png`);
		expect(pngSize(out.buf)).toEqual({ w, h });
	}
});

test('text sections follow the size limits and are kept when the size changes', async ({
	page
}) => {
	const { buildId } = await ownerBuild(page, 'sp-sec');
	const dialog = await openDialog(page, buildId);
	await dialog.getByTestId('share-picture-variant-social').click();
	const add = dialog.getByTestId('share-picture-add-section');

	await dialog.getByTestId('share-picture-size-square').click();
	await expect(add).toBeDisabled();

	await dialog.getByTestId('share-picture-size-portrait').click();
	await expect(add).toBeEnabled();
	await add.click();
	await dialog.getByTestId('share-picture-section-0-heading').fill('First');
	await dialog.getByTestId('share-picture-section-0-body').fill('Body one');
	await expect(add).toBeDisabled();

	await dialog.getByTestId('share-picture-size-story').click();
	await expect(add).toBeEnabled();
	await add.click();
	await add.click();
	await expect(add).toBeDisabled();
	await dialog.getByTestId('share-picture-section-1-heading').fill('Second');
	await expect(dialog.getByTestId('share-picture-section-2-off')).toHaveCount(0);

	// Back to portrait: sections 2 and 3 are kept but not drawn.
	await dialog.getByTestId('share-picture-size-portrait').click();
	await expect(dialog.getByTestId('share-picture-section-0-off')).toHaveCount(0);
	await expect(dialog.getByTestId('share-picture-section-1-off')).toContainText(
		'Not in the picture at this size'
	);
	await expect(dialog.getByTestId('share-picture-section-2-off')).toBeVisible();
	await expect(dialog.getByTestId('share-picture-section-0-heading')).toHaveValue('First');

	// Square draws none of them; they are still there.
	await dialog.getByTestId('share-picture-size-square').click();
	await expect(dialog.getByTestId('share-picture-section-0-off')).toBeVisible();

	await dialog.getByTestId('share-picture-size-story').click();
	await expect(dialog.getByTestId('share-picture-section-1-heading')).toHaveValue('Second');
	await dialog.getByTestId('share-picture-section-2-remove').click();
	await dialog.getByTestId('share-picture-section-1-remove').click();
	await expect(dialog.getByTestId('share-picture-section-1-heading')).toHaveCount(0);
	await expect(dialog.getByTestId('share-picture-section-0-heading')).toHaveValue('First');
	await expect(add).toBeEnabled();
});

test('nothing from the build is pre-filled and nothing is sent when downloading', async ({
	page
}) => {
	const { buildId, chapter } = await ownerBuild(page, 'sp-priv');
	await page.goto(`/builds/${buildId}/design`);
	const requests: string[] = [];
	page.on('request', (r) => {
		const u = new URL(r.url());
		if (r.method() !== 'GET' || u.pathname.startsWith('/api/'))
			requests.push(`${r.method()} ${u.pathname}`);
	});
	await page.getByTestId('open-share-picture').click();
	const dialog = page.getByTestId('share-picture-dialog');
	await expect(dialog.getByTestId('share-picture-download')).toBeEnabled();

	const secrets = [BUILD_NAME, chapter, 'Olive Owner'];
	for (const variant of ['family', 'social']) {
		await dialog.getByTestId(`share-picture-variant-${variant}`).click();
		for (const id of ['share-picture-title', 'share-picture-line']) {
			const v = await dialog.getByTestId(id).inputValue();
			for (const s of secrets) expect(v).not.toContain(s);
		}
	}
	for (const s of secrets) {
		await expect(dialog.getByTestId('share-picture-preview')).not.toHaveAttribute('alt', new RegExp(s));
	}
	requests.length = 0; // from here on only the download itself is observed
	await dialog.getByTestId('share-picture-variant-family').click();
	await expect(dialog.getByTestId('share-picture-download')).toBeEnabled();
	await download(page);
	expect(requests).toEqual([]);
});

test('a viewer can open the dialog and download', async ({ page, browser }) => {
	const { buildId, chapterUrl } = await ownerBuild(page, 'sp-view');
	await page.goto(chapterUrl);
	const email = uniqueEmail('sp-viewer');
	const link = await invite(page, email, 'viewer');
	const viewer = await joinViaInvite(browser as Browser, link, 'Vera Viewer', email);
	try {
		await serveModel(viewer.context);
		const dialog = await openDialog(viewer.page, buildId);
		const out = await download(viewer.page);
		expect(out.name).toBe('tmt-chair-family.png');
		expect(pngSize(out.buf)).toEqual({ w: 1600, h: 2000 });
		await expect(dialog).toBeVisible();
	} finally {
		await viewer.context.close();
	}
});

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('the dialog does not overflow sideways with three sections open', async ({ page }) => {
		const { buildId } = await ownerBuild(page, 'sp-phone');
		const dialog = await openDialog(page, buildId);
		await dialog.getByTestId('share-picture-variant-social').click();
		await dialog.getByTestId('share-picture-size-story').click();
		const add = dialog.getByTestId('share-picture-add-section');
		for (let n = 0; n < 3; n++) {
			await add.click();
			await dialog.getByTestId(`share-picture-section-${n}-heading`).fill('A fairly long heading');
		}
		for (const width of [390, 360]) {
			await page.setViewportSize({ width, height: 844 });
			const over = await page.evaluate(() => {
				const d = document.querySelector('[data-testid="share-picture-dialog"]') as HTMLElement;
				const box = d.getBoundingClientRect();
				const wide = [...d.querySelectorAll<HTMLElement>('*')].filter(
					(e) => e.getBoundingClientRect().right > box.right + 1 && !e.closest('.sr-only')
				);
				return {
					page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
					dialog: d.scrollWidth - d.clientWidth,
					wide: wide.map((e) => e.tagName + '.' + e.className).slice(0, 5)
				};
			});
			expect(over.page, `page at ${width}`).toBeLessThanOrEqual(0);
			expect(over.dialog, `dialog at ${width}`).toBeLessThanOrEqual(0);
			expect(over.wide, `children at ${width}`).toEqual([]);
		}
	});
});
