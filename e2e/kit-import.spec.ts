import { expect, newClientContext, test } from './fixtures';
import { signInAsAdmin, signUp, startBuild, uniqueEmail } from './helpers';
import Database from 'better-sqlite3';
import { strToU8, zipSync } from 'fflate';
import { makeProjectThreeMf } from '../src/lib/server/threemf/fixtures';

// Synthetic files only (no MakeGood data): a cube STEP, boxes in a 3MF, a 3-page PDF.
const DB = 'data/e2e/tmt.db';
const WING_LEFT = '3DTMT C1 WING LEFT REV B.STEP';
const SEAT_CENTER = '3DTMT H SEAT CENTER REV A.STEP';

/** A cube as a STEP AP214 manifold solid (8 vertices, 12 edges, 6 faces). */
function cubeStep(size = 40): string {
	const lines: string[] = [];
	let n = 0;
	const add = (s: string) => (lines.push(`#${++n}=${s};`), n);
	const pt = (c: number[]) => add(`CARTESIAN_POINT('',(${c.map((x) => x.toFixed(1)).join(',')}))`);
	const dir = (c: number[]) => add(`DIRECTION('',(${c.map((x) => x.toFixed(1)).join(',')}))`);
	const corner = (i: number) => [i & 1, (i >> 1) & 1, (i >> 2) & 1].map((b) => b * size);
	const vtx = Array.from({ length: 8 }, (_, i) => add(`VERTEX_POINT('',#${pt(corner(i))})`));
	const edge = new Map<string, { id: number; from: number }>();
	for (let a = 0; a < 8; a++)
		for (let bit = 0; bit < 3; bit++) {
			const b = a | (1 << bit);
			if (b === a) continue;
			const d = [0, 0, 0];
			d[bit] = 1;
			const line = add(
				`LINE('',#${pt(corner(a))},#${add(`VECTOR('',#${dir(d)},${size.toFixed(1)})`)})`
			);
			edge.set(`${a}-${b}`, {
				id: add(`EDGE_CURVE('',#${vtx[a]},#${vtx[b]},#${line},.T.)`),
				from: a
			});
		}
	const faces: number[] = [];
	for (let axis = 0; axis < 3; axis++)
		for (const side of [0, 1]) {
			const u = (axis + 1) % 3;
			const v = (axis + 2) % 3;
			let cyc = [
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 1]
			].map(([a, b]) => (side << axis) | (a << u) | (b << v));
			if (!side) cyc = cyc.reverse();
			const oriented = cyc.map((from, i) => {
				const to = cyc[(i + 1) % 4];
				const key = from < to ? `${from}-${to}` : `${to}-${from}`;
				const e = edge.get(key)!;
				return add(`ORIENTED_EDGE('',*,*,#${e.id},${e.from === from ? '.T.' : '.F.'})`);
			});
			const loop = add(`EDGE_LOOP('',(${oriented.map((o) => `#${o}`).join(',')}))`);
			const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
			const ad = [0, 0, 0];
			ad[axis] = 1;
			const rd = [0, 0, 0];
			rd[u] = 1;
			const org = [0, 0, 0];
			org[axis] = side * size;
			const plane = add(
				`PLANE('',#${add(`AXIS2_PLACEMENT_3D('',#${pt(org)},#${dir(ad)},#${dir(rd)})`)})`
			);
			faces.push(add(`ADVANCED_FACE('',(#${bound}),#${plane},${side ? '.T.' : '.F.'})`));
		}
	const shell = add(`CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(',')}))`);
	const solid = add(`MANIFOLD_SOLID_BREP('cube',#${shell})`);
	// The product structure OCCT needs to find a shape to transfer.
	const app = add(`APPLICATION_CONTEXT('automotive design')`);
	add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`);
	const prod = add(
		`PRODUCT('cube','cube','',(#${add(`MECHANICAL_CONTEXT('none',#${app},'mechanical')`)}))`
	);
	const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
	const pd = add(
		`PRODUCT_DEFINITION('design','',#${pdf},#${add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`)})`
	);
	const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
	const lu = add(`(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))`);
	const au = add(`(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT (.RADIAN.))`);
	const su = add(`(NAMED_UNIT(*) SI_UNIT (.STERADIAN.) SOLID_ANGLE_UNIT())`);
	const unc = add(
		`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),#${lu},'distance_accuracy_value','')`
	);
	const ctx = add(
		`(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lu},#${au},#${su})) REPRESENTATION_CONTEXT('',''))`
	);
	const axis = add(
		`AXIS2_PLACEMENT_3D('',#${pt([0, 0, 0])},#${dir([0, 0, 1])},#${dir([1, 0, 0])})`
	);
	const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${axis},#${solid}),#${ctx})`);
	add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
	return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('synthetic cube'),'2;1');
FILE_NAME('cube.step','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
${lines.join('\n')}
ENDSEC;
END-ISO-10303-21;
`;
}

function boxModel(id: number, sx: number, sy: number, sz: number): string {
	const v = [
		[0, 0, 0],
		[sx, 0, 0],
		[sx, sy, 0],
		[0, sy, 0],
		[0, 0, sz],
		[sx, 0, sz],
		[sx, sy, sz],
		[0, sy, sz]
	];
	const t = [
		[0, 2, 1],
		[0, 3, 2],
		[4, 5, 6],
		[4, 6, 7],
		[0, 1, 5],
		[0, 5, 4],
		[1, 2, 6],
		[1, 6, 5],
		[2, 3, 7],
		[2, 7, 6],
		[3, 0, 4],
		[3, 4, 7]
	];
	return `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="${id}" type="model"><mesh><vertices>${v
		.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
		.join('')}</vertices><triangles>${t
		.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
		.join('')}</triangles></mesh></object></resources><build/></model>`;
}

/** A project 3MF with one part as a box, optionally carrying a guide PDF under Auxiliaries/. */
function profile(partName: string, box: [number, number, number], pdf?: Uint8Array): Uint8Array {
	return makeProjectThreeMf({
		plates: [{ name: 'Part', objects: [{ name: partName }] }],
		extra: {
			'3D/3dmodel.model': strToU8(
				`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><metadata name="Application">BambuStudio-02.06.00.51</metadata><resources><object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 100 100 0" printable="1"/></build></model>`
			),
			'3D/Objects/object_1.model': strToU8(boxModel(1, ...box)),
			...(pdf ? { 'Auxiliaries/Assembly Guide/guide.pdf': pdf } : {})
		}
	});
}

/** A tiny hand-written PDF: `n` pages, each with a filled rectangle of a different grey. */
function makePdf(n: number): Uint8Array {
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
	return Uint8Array.from(Buffer.from(pdf, 'latin1'));
}

/** Smallest GLB the server accepts (it only checks the magic): header + empty JSON chunk. */
function tinyGlb(): Uint8Array {
	const json = Buffer.from('{"asset":{"version":"2.0"}}  ');
	const b = Buffer.alloc(12 + 8 + json.length);
	b.write('glTF', 0, 'latin1');
	b.writeUInt32LE(2, 4);
	b.writeUInt32LE(b.length, 8);
	b.writeUInt32LE(json.length, 12);
	b.write('JSON', 16, 'latin1');
	json.copy(b, 20);
	return Uint8Array.from(b);
}

// Template-level tables the import rewrites; restored in afterAll (the suite shares one database).
const TABLES = ['template_print_geometry', 'template_models', 'template_part_placements'] as const;
const snapshot: Record<string, unknown[]> = {};
let templateId = '';

// Template-level files go back in afterEach (also after a failure); table rows in afterAll.
test.afterEach(async ({ page }) => {
	if (!templateId || !page.url().startsWith('http')) return;
	await page.request.delete(`/api/templates/${templateId}/guide`).catch(() => {});
	await page.request.delete(`/api/templates/${templateId}/model/hardware`).catch(() => {});
});

test.afterAll(async () => {
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

test('add MakeGood files together: plan, one run, retry, checklist, guide mapping', async ({
	page
}) => {
	test.setTimeout(180_000);
	await signInAsAdmin(page);
	await page.waitForLoadState('networkidle');
	const href = (await page.locator('a[href^="/admin/templates/"]').first().getAttribute('href'))!;
	templateId = href.split('/').pop()!;
	const db = new Database(DB, { readonly: true });
	try {
		for (const t of TABLES)
			snapshot[t] = db.prepare(`select * from ${t} where template_id = ?`).all(templateId);
	} finally {
		db.close();
	}
	// The one drop zone for the built-in kit: a build's Print tab, Print settings.
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const buildId = await startBuild(page, 'Kit files build');
	await page.waitForLoadState('networkidle');
	await page.getByTestId('skip-setup').click();
	await page.goto(`/builds/${buildId}/print`);
	await page.waitForLoadState('networkidle');
	await page.getByText('Add or replace files').click();

	const cube = strToU8(cubeStep());
	const files = [
		{
			name: 'chair-steps.zip',
			mimeType: 'application/zip',
			buffer: Buffer.from(
				zipSync({ [`STEP/${WING_LEFT}`]: cube, 'STEP/readme.txt': strToU8('hi') })
			)
		},
		{
			name: SEAT_CENTER,
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(cube)
		},
		{
			name: 'main profile.3mf',
			mimeType: 'model/3mf',
			buffer: Buffer.from(profile(WING_LEFT, [180, 70, 20], makePdf(3)))
		},
		{
			name: 'harness.zip',
			mimeType: 'application/zip',
			buffer: Buffer.from(
				zipSync({ 'seat.3mf': profile(SEAT_CENTER, [150, 90, 25]) }, { level: 0 })
			)
		},
		{ name: 'hardware.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(tinyGlb()) },
		{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a kit file') }
	];
	const root = page.getByTestId('kit-import');
	await root.getByTestId('kit-file-input').setInputFiles(files);

	// The plan: every file says what it will feed; the stray text file is flagged.
	const plan = root.getByTestId('kit-plan');
	await expect(plan.getByText('3D chair (1 STEP file)')).toBeVisible();
	await expect(plan.getByText('3D chair (loose STEP file)')).toBeVisible();
	await expect(plan.getByText('Print geometry (profile with 1 plate)').first()).toBeVisible();
	await expect(plan.getByText('Print geometry (zip of 1 3MF file)')).toBeVisible();
	await expect(plan.getByText('Guide (3-page PDF inside this 3MF)')).toBeVisible();
	await expect(plan.getByText('Hardware model', { exact: true })).toBeVisible();
	await expect(plan.getByTestId('kit-unknown')).toContainText('Not recognised');

	// The first hardware upload fails (network), the user retries.
	let failHardware = true;
	await page.route('**/model/hardware', (route) => {
		if (failHardware && route.request().method() === 'POST') {
			failHardware = false;
			return route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: '{"error":"disk full (test)"}'
			});
		}
		return route.continue();
	});

	const t0 = Date.now();
	await root.getByTestId('kit-start').click();
	const progress = root.getByTestId('kit-progress');
	await expect(progress.getByRole('heading', { name: /Finished with 1 problem/ })).toBeVisible({
		timeout: 150_000
	});
	console.log(`kit import took ${((Date.now() - t0) / 1000).toFixed(1)} s`);

	const hw = progress.getByTestId('kit-step-hardware');
	await expect(hw).toHaveAttribute('data-status', 'error');
	await expect(hw).toContainText('disk full (test)');
	await expect(progress.getByTestId('kit-step-guide')).toHaveAttribute('data-status', 'done');
	await expect(progress.getByTestId('kit-step-print').first()).toHaveAttribute(
		'data-status',
		'done'
	);
	const model = progress.getByTestId('kit-step-model');
	// A synthetic cube is all the converter gets here; the step must at least finish cleanly.
	await expect(model).toHaveAttribute('data-status', 'done');

	await hw.getByRole('button', { name: 'Retry' }).click();
	await expect(hw).toHaveAttribute('data-status', 'done');

	// Guide page mapping is inline, prefilled (3 on a fresh install, else the last saved
	// offset: the shared e2e DB may already hold one from a retry); save it.
	const map = root.getByTestId('kit-guide-mapping');
	await expect(map).toHaveJSProperty('open', true);
	await expect(map.getByLabel('Page offset')).toHaveValue(/^\d+$/);
	await map.getByLabel('Page offset').fill('5');
	await map.getByRole('button', { name: 'Apply offset' }).click();
	await map.getByRole('button', { name: 'Save mapping' }).click();
	await expect(map.getByText(/Saved\. [1-9]\d* guide pages/)).toBeVisible();

	// Kit admin shows the full checklist: hardware ready, print geometry has the two parts, guide imported.
	await page.goto(href);
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('advanced-placement')).toBeVisible();
	const status = page.getByTestId('kit-status');
	await expect(status.getByTestId('kit-row-hardware')).toHaveAttribute('data-state', 'ok');
	await expect(status.getByTestId('kit-row-print')).toContainText('2 of');
	await expect(status.getByTestId('kit-row-print')).toContainText('main profile.3mf');
	await expect(status.getByTestId('kit-row-print')).toHaveAttribute('data-state', 'partial');
	await expect(status.getByTestId('kit-row-print')).toContainText('no print geometry');
	await expect(status.getByTestId('kit-row-guide')).toContainText('3 PDF pages imported');
	await expect(status.getByTestId('kit-row-model')).toContainText('parts rendered');

	const res = await page.request.get(`/api/templates/${templateId}/kit-status`);
	expect(res.status()).toBe(200);
	expect((await res.json()).canImport).toBe(true);
});

test('a member who is not an admin can read the checklist but gets no import rights', async ({
	page,
	browser
}) => {
	await signInAsAdmin(page); // makes sure the admin account exists first, so the member is not "first user"
	const db = new Database(DB, { readonly: true });
	const id = (db.prepare('select id from templates limit 1').get() as { id: string }).id;
	db.close();
	const context = await newClientContext(browser);
	try {
		const member = await context.newPage();
		await signUp(member, 'Mia Member', uniqueEmail('kit-member'));
		const res = await member.request.get(`/api/templates/${id}/kit-status`);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.canImport).toBe(false);
		expect(body.status.guide.pages).toBeGreaterThan(0);
		// Uploading is still admin-only on the server.
		const up = await member.request.post(`/api/templates/${id}/print-geometry?name=x.3mf`, {
			data: Buffer.from('PK\x03\x04')
		});
		expect(up.status()).toBe(404);
	} finally {
		await context.close();
	}
});
