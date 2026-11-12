// Retakes the README screenshots (docs/images/screenshot-*.png) from the local preview with
// sample data (`npm run preview:demo`). Invented data only. Light theme, device scale factor 2.
//
//   node scripts/preview/readme-shots.mjs [--base http://localhost:5190] [--out docs/images]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO } from './seed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : fallback;
};
const base = opt('--base', 'http://localhost:5190');
const out = resolve(root, opt('--out', 'docs/images'));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const desktop = {
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	colorScheme: 'light'
};
const phone = {
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 2,
	colorScheme: 'light',
	isMobile: true,
	hasTouch: true
};

async function signedIn(options) {
	const context = await browser.newContext(options);
	const page = await context.newPage();
	await page.goto(`${base}/login`);
	await page.getByLabel(/email/i).fill(DEMO.email);
	await page.getByLabel(/password/i).fill(DEMO.password);
	await page.getByRole('button', { name: /sign in|log in/i }).click();
	await page.waitForURL(/\/teams\//);
	return page;
}

/** The build page URL of "Demo chair A", read from the chapter's build list. */
async function buildUrl(page) {
	await page.getByRole('link', { name: 'Demo chair A' }).first().click();
	await page.waitForURL(/\/builds\/[^/]+$/);
	return page.url();
}

const shot = (page, name, clip) =>
	page.screenshot({ path: join(out, name), clip, fullPage: Boolean(clip) });

try {
	// ---- desktop
	const d = await signedIn(desktop);
	const build = await buildUrl(d);

	// 1. Design tab: wait until the 3D canvas has drawn something.
	await d.goto(`${build}/design`);
	const canvas = d.locator('canvas').first();
	await canvas.waitFor();
	await d.waitForFunction(() => {
		const c = document.querySelector('canvas');
		if (!c || c.width < 50) return false;
		const probe = document.createElement('canvas');
		probe.width = probe.height = 64;
		const g = probe.getContext('2d');
		g.drawImage(c, 0, 0, 64, 64);
		const px = g.getImageData(0, 0, 64, 64).data;
		for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
		return false;
	});
	await d.getByText('Primary PETG').first().waitFor();
	await d.waitForTimeout(2500);
	await shot(d, 'screenshot-color-designer.png', { x: 0, y: 0, width: 1440, height: 900 });

	// 2. Files tab: a plate with two parts laid out on the bed.
	await d.goto(`${build}/files`);
	const plate = d.getByRole('heading', { name: /^Plate 12 ·/ });
	await plate.waitFor();
	await plate.scrollIntoViewIfNeeded();
	await d.waitForTimeout(1500);
	const box = await plate.boundingBox();
	const top = box.y + (await d.evaluate(() => window.scrollY)) - 24;
	await shot(d, 'screenshot-plate-arranger.png', {
		x: 180,
		y: Math.max(0, top),
		width: 1070,
		height: 545
	});

	// 4. Integrations: the printer chooser above the existing printers.
	await d.goto(`${base}/teams/demo-chapter/integrations`);
	await d.getByRole('button', { name: 'Add a printer' }).click();
	await d.getByText('What kind of printer?').waitFor();
	await d.waitForTimeout(500);
	await shot(d, 'screenshot-integrations.png', { x: 0, y: 0, width: 1440, height: 840 });
	await d.context().close();

	// ---- phone
	const m = await signedIn(phone);

	// 3. Overview: the Now printing card with live progress from the simulated printer.
	await m.goto(build);
	await m.getByText('42%').first().waitFor();
	const camera = m.getByRole('button', { name: 'Camera' });
	if (await camera.count()) await camera.first().click();
	await m.waitForTimeout(800);
	await shot(m, 'screenshot-phone-print.png');

	// 5. Print tab: choosing Printing on a plate asks where it is printing.
	await m.goto(`${build}/print`);
	await m
		.getByRole('button', { name: /to print/i })
		.first()
		.click();
	await m
		.getByRole('menuitem', { name: 'Printing' })
		.or(m.getByText('Printing', { exact: true }))
		.last()
		.click();
	await m.getByTestId('where-printing').waitFor();
	await m.waitForTimeout(500);
	await shot(m, 'screenshot-where-printing.png');
	await m.context().close();
} finally {
	await browser.close();
}
console.log(`screenshots written to ${out}`);
