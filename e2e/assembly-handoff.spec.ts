import { deflateSync } from 'node:zlib';
import { expect, newClientContext, test } from './fixtures';
import {
	invite,
	joinViaInvite,
	ownerWithBuild,
	signInAsAdmin,
	signUp,
	startBuild,
	uniqueEmail
} from './helpers';

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf: Buffer) => {
	let c = 0xffffffff;
	for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
/** A solid-colour RGB PNG, big enough for the browser to decode, downscale and re-encode. */
function makePng(size: number): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const head = Buffer.alloc(4);
		head.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
		const tail = Buffer.alloc(4);
		tail.writeUInt32BE(crc32(body));
		return Buffer.concat([head, body, tail]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // RGB
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x9a)]);
	const raw = Buffer.concat(Array.from({ length: size }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}
const PNG_64 = makePng(64);

/** A tiny hand-written PDF: `n` pages, each with a filled rectangle of a different grey. */
function makePdf(n: number): Buffer {
	const objs: string[] = [];
	const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
	objs.push('<< /Type /Catalog /Pages 2 0 R >>');
	objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
	for (let i = 0; i < n; i++) {
		const content = `${(0.2 + i * 0.25).toFixed(2)} g 40 40 320 220 re f`;
		objs.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents ${4 + i * 2} 0 R /Resources << >> >>`
		);
		objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
	}
	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	objs.forEach((o, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf, 'latin1');
}

// Signs in as the fixed ADMIN_EMAILS account, so the order of specs does not matter.
test('a site admin imports a guide PDF in the browser (Print settings) and maps its pages', async ({
	page,
	browser
}) => {
	await signInAsAdmin(page);
	await page.waitForLoadState('networkidle');
	const href = (await page.locator('a[href^="/admin/templates/"]').first().getAttribute('href'))!;
	const templateId = href.split('/').pop()!;
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const adminBuild = await startBuild(page, 'Guide import build');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('skip-setup').click();
	await page.goto(`/builds/${adminBuild}/files`);
	await page.waitForLoadState('networkidle');
	await page.getByText('Add or replace files').click();

	try {
		const imp = page.getByTestId('kit-import');
		await imp.getByTestId('kit-file-input').setInputFiles({
			name: 'guide.pdf',
			mimeType: 'application/pdf',
			buffer: makePdf(3)
		});
		await imp.getByTestId('kit-start').click();
		await expect(
			imp.getByTestId('kit-progress').getByRole('heading', { name: /^Done/ })
		).toBeVisible({ timeout: 45_000 });
		const card = imp.getByTestId('kit-guide-mapping');
		await expect(card).toHaveJSProperty('open', true);

		// Seed page 8 = PDF page 3 with an offset of 5; page 12 is set by hand to PDF page 1.
		await card.getByLabel('Page offset').fill('5');
		await card.getByRole('button', { name: 'Apply offset' }).click();
		await card.getByLabel('PDF page for guide page 12').fill('1');
		await card.getByRole('button', { name: 'Save mapping' }).click();
		await expect(card.getByText(/Saved\. 2 guide pages/)).toBeVisible();

		const img = await page.request.get(`/api/templates/${templateId}/guide/8.webp`);
		expect(img.status()).toBe(200);
		expect(img.headers()['content-type']).toMatch(/^image\//);
		expect(img.headers()['cache-control']).toContain('no-cache');
		expect((await img.body()).length).toBeGreaterThan(100);
		expect((await page.request.get(`/api/templates/${templateId}/guide/14.webp`)).status()).toBe(
			404
		);

		// Another signed-in user can read the image but not write or list.
		const other = await newClientContext(browser);
		const op = await other.newPage();
		await signUp(op, 'Olga Other', uniqueEmail('other'));
		expect((await op.request.get(`/api/templates/${templateId}/guide/8.webp`)).status()).toBe(200);
		expect(
			(
				await op.request.post(`/api/templates/${templateId}/guide/pages/1`, {
					data: PNG_64,
					headers: { 'content-type': 'image/png' }
				})
			).status()
		).toBe(404);
		expect((await op.request.get(`/api/templates/${templateId}/guide`)).status()).toBe(404);
		expect(
			(await op.request.put(`/api/templates/${templateId}/guide`, { data: { map: {} } })).status()
		).toBe(404);
		await other.close();

		// Non-image uploads are refused even for the admin.
		const bad = await page.request.post(`/api/templates/${templateId}/guide/pages/2`, {
			data: Buffer.from('%PDF-1.4 not an image'),
			headers: { 'content-type': 'application/pdf' }
		});
		expect(bad.status()).toBe(400);
	} finally {
		await page.request.delete(`/api/templates/${templateId}/guide`); // restore: no guide images
	}
});

test('assembly progress and checks update live for a second user', async ({ page, browser }) => {
	const { chapterUrl, buildId } = await ownerWithBuild(page, 'asm');
	const buildUrl = page.url();
	await page.goto(chapterUrl);
	const email = uniqueEmail('editor');
	const link = await invite(page, email, 'editor');
	const editor = await joinViaInvite(browser, link, 'Eddie Editor', email);

	await page.goto(`${buildUrl}/finish`);
	await page.waitForLoadState('networkidle');
	const progress = page.getByTestId('asm-progress');
	await expect(progress).toContainText('0 of');
	await expect(page.locator('.sync')).toContainText('Live');
	await expect(page.getByText("isn't printed yet").first()).toBeVisible();

	await editor.page.goto(`/builds/${buildId}/finish`);
	await editor.page.waitForLoadState('networkidle');
	const step = (p: typeof page) => p.locator('.astep[data-step="frame.handle"]');
	await step(editor.page).getByLabel('Handle front sits flat (no warp gap)').check();
	await step(editor.page).getByRole('button', { name: 'Mark step done' }).click();
	await expect(step(editor.page)).toHaveAttribute('data-done', 'true');

	await expect(progress).toContainText('1 of');
	await expect(step(page)).toHaveAttribute('data-done', 'true');
	await expect(step(page).getByLabel('Handle front sits flat (no warp gap)')).toBeChecked();
	await expect(step(page)).toContainText('Done by Eddie Editor');
	await page.goto(buildUrl);
	await expect(page.locator('.activity')).toContainText(
		'Eddie Editor marked step "Handles onto the frame" done'
	);

	// The step list follows the footrest variant.
	await page.goto(`${buildUrl}/finish`);
	await expect(page.locator('.astep[data-step="frame.footrest-one"]')).toBeVisible();
	await expect(page.locator('.astep[data-step="frame.footrest-two"]')).toHaveCount(0);
	expect(
		(
			await editor.page.request.patch(`/api/builds/${buildId}/assembly`, {
				data: { itemKey: 'nope', done: true }
			})
		).status()
	).toBe(400);
	await editor.context.close();
});

test('photos are downscaled, uploaded, shown in a lightbox and deleted', async ({ page }) => {
	const { buildId } = await ownerWithBuild(page, 'photo');
	await page.goto(`/builds/${buildId}/finish`);
	await page.waitForLoadState('networkidle');
	await page
		.locator('#photos')
		.getByTestId('photo-input')
		.setInputFiles({ name: 'chair.png', mimeType: 'image/png', buffer: PNG_64 });
	const thumb = page.locator('.gallery .thumb img');
	await expect(thumb).toHaveCount(1);
	await thumb.scrollIntoViewIfNeeded(); // lazy-loaded
	await expect
		.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth))
		.toBeGreaterThan(0);

	const view = await (await page.request.get(`/api/builds/${buildId}/view`)).json();
	const photo = (view.view ?? view).photos[0];
	expect(photo.kind).toBe('progress');
	const full = await page.request.get(`/api/builds/${buildId}/photos/${photo.id}`);
	expect(full.status()).toBe(200);
	expect(full.headers()['content-type']).toMatch(/^image\/(webp|jpeg)$/);

	await page.locator('.gallery .thumb').click();
	await expect(page.getByRole('dialog', { name: 'Photo viewer' })).toBeVisible();
	page.once('dialog', (d) => void d.accept());
	await page.getByRole('button', { name: 'Delete' }).click();
	await expect(page.locator('.gallery .thumb')).toHaveCount(0);
	expect((await page.request.get(`/api/builds/${buildId}/photos/${photo.id}`)).status()).toBe(404);

	// Not an image: refused by the server.
	const bad = await page.request.post(`/api/builds/${buildId}/photos`, {
		headers: { origin: new URL(page.url()).origin }, // SvelteKit's CSRF check wants one for form posts
		multipart: {
			kind: 'progress',
			file: { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }
		}
	});
	expect(bad.status()).toBe(400);
});

test('handoff: fill the form, mark handed off, and the summary leaves the contact out', async ({
	page,
	browser
}) => {
	const { buildId, chapterUrl } = await ownerWithBuild(page, 'handoff');
	await page.goto(`/builds/${buildId}/finish#handoff`);
	await page.waitForLoadState('networkidle');

	await page.getByLabel('Recipient name').fill('Sam Rivera');
	await page.getByLabel('Organization or hospital').fill('Riverside Clinic');
	await page.getByLabel(/^Contact/).fill('secret-contact@example.test');
	await page.getByLabel('Handed off on').fill('2026-11-03');
	await page.getByLabel('Location').fill('Front desk');
	await page.getByRole('button', { name: 'Save details' }).click();
	await expect(page.getByText('Saved', { exact: true })).toBeVisible();

	await page
		.locator('.card', { has: page.getByRole('heading', { name: 'Finished chair' }) })
		.getByTestId('photo-input')
		.setInputFiles({ name: 'done.png', mimeType: 'image/png', buffer: PNG_64 });
	await expect(page.locator('.gallery .thumb img')).toHaveCount(1);

	page.once('dialog', (d) => void d.accept()); // unfinished assembly: "hand off anyway?"
	await page.getByRole('button', { name: 'Mark as handed off' }).click();
	await expect(page.getByRole('heading', { name: 'Handed off' })).toBeVisible();
	await expect(page.locator('.phase')).toHaveText('done');
	await page.goto(`/builds/${buildId}`);
	await expect(page.locator('.activity')).toContainText(
		'marked the chair as handed off to Riverside Clinic'
	);

	await page.goto(`/builds/${buildId}/summary`);
	await page.waitForLoadState('networkidle');
	await expect(page.locator('.summary h1')).toHaveText('Test chair');
	await expect(page.locator('.summary')).toContainText('Sam Rivera');
	await expect(page.locator('.summary')).toContainText('Riverside Clinic');
	await expect(page.locator('.summary')).toContainText('2026-11-03');
	await expect(page.locator('.summary')).toContainText('Safety checks');
	await expect(page.getByRole('button', { name: 'Print / Save as PDF' })).toBeVisible();
	await expect(page.locator('.summary img')).toHaveCount(1);
	expect(await page.locator('body').innerText()).not.toContain('secret-contact@example.test');

	// Contact reaches editors but never viewers (page data or API).
	const viewerEmail = uniqueEmail('viewer');
	await page.goto(chapterUrl);
	const vlink = await invite(page, viewerEmail, 'viewer');
	const viewer = await joinViaInvite(browser, vlink, 'Vera Viewer', viewerEmail);
	const own = await page.request.get(`/api/builds/${buildId}/view`);
	expect(await own.text()).toContain('secret-contact@example.test');
	const theirs = await viewer.page.request.get(`/api/builds/${buildId}/view`);
	expect(theirs.status()).toBe(200);
	expect(await theirs.text()).not.toContain('secret-contact@example.test');
	await viewer.page.goto(`/builds/${buildId}/finish#handoff`);
	await viewer.page.waitForLoadState('networkidle');
	expect(await viewer.page.content()).not.toContain('secret-contact@example.test');
	await viewer.context.close();
});
