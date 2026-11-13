import { unzipSync, strFromU8 } from 'fflate';
import { expect, test } from './fixtures';
import { arrangeForCentauri, ownerWithBuild } from './helpers';
import {
	registerSyntheticGeometry,
	removeSyntheticGeometry,
	SYNTHETIC
} from './print-geometry-helper';

const SHOTS = 'data/shots-export';

// The e2e DB is shared across specs; don't leave synthetic geometry behind for them.
test.afterAll(() => removeSyntheticGeometry());

test('export for a slicer: no geometry, then a project 3MF per color and a plain zip', async ({
	page
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	const { buildId } = await ownerWithBuild(page, 'export');
	await page.getByRole('link', { name: 'Files', exact: true }).click();
	await expect(page).toHaveURL(/\/files$/);

	// Without a printer the default MakeGood profile stands for its bed: the card works.
	await expect(page.getByTestId('export-no-printer')).toHaveCount(0);
	await expect(page.getByTestId('layout-bed')).toContainText('256 × 256');
	const noPrinter = await page.request.get(`/api/builds/${buildId}/export/preview`);
	expect(noPrinter.status()).toBe(200);

	// Elegoo Centauri Carbon with CANVAS (4 filaments); saving arranges the plates.
	await arrangeForCentauri(page);
	await expect(page.getByTestId('layout-name')).toHaveText('Arranged for Elegoo Centauri Carbon');

	// No print geometry imported yet: a friendly message, no download.
	await expect(page.getByTestId('export-no-geometry')).toBeVisible();
	await expect(page.getByTestId('export-no-geometry')).toContainText('No print geometry yet');
	await page.getByTestId('export-card').scrollIntoViewIfNeeded();
	await page.getByTestId('export-card').screenshot({ path: `${SHOTS}/export-no-geometry-390.png` });
	const noGeo = await page.request.get(`/api/builds/${buildId}/export.3mf?flavor=orca`);
	expect(noGeo.status()).toBe(409);

	// Register synthetic geometry for a few parts and re-arrange so the plates use their sizes.
	registerSyntheticGeometry();
	const re = await page.request.post(`/api/builds/${buildId}/plates/arrange`, {
		data: { convertRuns: true }
	});
	expect(re.ok()).toBe(true);
	await page.reload();
	await expect(page.getByTestId('export-count')).toBeVisible();
	await expect(page.getByTestId('export-filaments')).toBeVisible();
	await expect(page.getByTestId('export-warnings')).toBeVisible(); // the other parts have no geometry
	await expect(page.getByTestId('export-warnings')).toContainText('No print geometry');
	await page.getByTestId('export-card').scrollIntoViewIfNeeded();
	await page.getByTestId('export-card').screenshot({ path: `${SHOTS}/export-390.png` });

	const preview = await (await page.request.get(`/api/builds/${buildId}/export/preview`)).json();
	expect(preview.ready).toBe(true);
	expect(preview.plates.length).toBeGreaterThanOrEqual(2);
	expect(preview.filaments).toHaveLength(4);
	const names: string[] = preview.plates.flatMap((p: { objects: { slug: string }[] }) =>
		p.objects.map((o) => o.slug)
	);
	expect(new Set(names)).toEqual(new Set(Object.keys(SYNTHETIC)));

	// Download: a zip with the project files.
	const href = await page.getByTestId('export-download').getAttribute('href');
	expect(href).toContain('/export.3mf?flavor=orca');
	const res = await page.request.get(href!);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-disposition']).toMatch(
		/attachment; filename="TMT-.*-Elegoo-Centauri-Carbon-orca\.3mf"/
	);
	const z = unzipSync(new Uint8Array(await res.body()));
	expect(Object.keys(z)).toEqual(
		expect.arrayContaining(['3D/3dmodel.model', 'Metadata/model_settings.config'])
	);
	const settings = strFromU8(z['Metadata/model_settings.config']);
	const idOf = (slug: string) => {
		const o = preview.plates
			.flatMap((p: { objects: { slug: string; filamentIndex: number }[] }) => p.objects)
			.find((x: { slug: string }) => x.slug === slug);
		return o.filamentIndex as number;
	};
	const wingBefore = idOf('wing-left');
	expect(settings).toContain('<metadata key="wall_loops" value="4"/>');
	expect(settings).toContain(`<metadata key="extruder" value="${wingBefore}"/>`);

	// Recolor a part: the plates re-arrange and the next download maps it to the new filament slot.
	const wingRole = preview.filaments[wingBefore - 1].key as string;
	const other = wingRole === 'primary' ? 'accent' : 'primary';
	const otherIdx = preview.filaments.findIndex((f: { key: string }) => f.key === other) + 1;
	const patch = await page.request.patch(`/api/builds/${buildId}/design`, {
		data: { partRoles: { 'wing-left': other } }
	});
	expect(await patch.text(), 'design patch').toContain('"ok":true');
	const preview2 = await (await page.request.get(`/api/builds/${buildId}/export/preview`)).json();
	const wing2 = preview2.plates
		.flatMap((p: { objects: { slug: string; filamentIndex: number }[] }) => p.objects)
		.find((o: { slug: string }) => o.slug === 'wing-left');
	expect(wing2.filamentIndex).toBe(otherIdx);

	// The other flavors and a plate selection.
	const plateNo = preview2.plates[0].number;
	const sel = await page.request.get(
		`/api/builds/${buildId}/export.3mf?flavor=bambu&plates=${plateNo}`
	);
	expect(sel.status()).toBe(200);
	expect(Object.keys(unzipSync(new Uint8Array(await sel.body())))).toContain('3D/3dmodel.model');
	const plain = await page.request.get(`/api/builds/${buildId}/export.3mf?flavor=plain`);
	expect(plain.status()).toBe(200);
	expect(plain.headers()['content-disposition']).toMatch(/\.zip"/);
	const pz = unzipSync(new Uint8Array(await plain.body()));
	const inner = Object.keys(pz).filter((n) => n.endsWith('.3mf'));
	expect(inner.length).toBeGreaterThanOrEqual(2);
	expect(Object.keys(unzipSync(pz[inner[0]]))).toContain('3D/3dmodel.model');

	// UI: switch to plain and to a plate selection; layout stays inside the phone width.
	await page.reload();
	await page.getByTestId('export-flavor').selectOption('plain');
	await expect(page.getByTestId('export-download')).toContainText('Download .zip');
	await page.getByTestId('export-scope-some').check();
	await expect(page.getByTestId('export-plates')).toBeVisible();
	await page.getByTestId('export-plates').locator('input').first().check();
	await expect(page.getByTestId('export-download')).toContainText('Download .3mf');
	await page.getByTestId('export-card').scrollIntoViewIfNeeded();
	await page.getByTestId('export-card').screenshot({ path: `${SHOTS}/export-plain-390.png` });
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);

	for (const [w, h, name] of [
		[1440, 900, 'export-1440'],
		[1920, 1080, 'export-1920']
	] as const) {
		await page.setViewportSize({ width: w, height: h });
		await page.getByTestId('export-card').scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${SHOTS}/${name}.png` });
	}
});
