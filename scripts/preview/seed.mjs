// Seeds the preview through the app's own HTTP API (sign-up, chapter, builds, runs, printer),
// the way the e2e helpers do it, with invented people and data only. Safe to call on every
// start: it does nothing when the demo account already exists.
import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEMO = {
	// Throwaway, used only by the preview server. Not a real secret.
	secret: 'preview-demo-throwaway-8f3a91c7d2e45b60',
	owner: 'Sam Sample',
	email: 'demo.owner@example.com',
	editor: 'Alex Sample',
	editorEmail: 'demo.editor@example.com',
	password: 'preview-demo-pass',
	chapter: 'Demo Chapter',
	printerName: 'Demo printer',
	activeFile: 'demo-chair-a-plate.gcode.3mf'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny HTTP client with a cookie jar; retries Better Auth's rate limit (429). */
class Client {
	constructor(base) {
		this.base = base;
		this.cookies = new Map();
	}
	async req(method, path, body, { form } = {}) {
		for (let attempt = 0; ; attempt++) {
			const headers = {
				origin: this.base,
				cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
			};
			let payload;
			if (body instanceof FormData) payload = body;
			else if (form) {
				headers['content-type'] = 'application/x-www-form-urlencoded';
				payload = new URLSearchParams(body).toString();
			} else if (body !== undefined) {
				headers['content-type'] = 'application/json';
				payload = JSON.stringify(body);
			}
			const res = await fetch(this.base + path, {
				method,
				headers,
				body: payload,
				redirect: 'manual'
			});
			for (const c of res.headers.getSetCookie()) {
				const [kv] = c.split(';');
				const i = kv.indexOf('=');
				this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
			}
			if (res.status === 429 && attempt < 4) {
				await sleep((Number(res.headers.get('x-retry-after')) || 10) * 1000 + 500);
				continue;
			}
			const text = await res.text();
			let json = null;
			try {
				json = JSON.parse(text);
			} catch {
				/* not JSON */
			}
			return { status: res.status, json, text };
		}
	}
	/** Like req, but throws with the response when it is not 2xx. */
	async ok(method, path, body, opts) {
		const r = await this.req(method, path, body, opts);
		if (r.status < 200 || r.status >= 300)
			throw new Error(`${method} ${path} -> ${r.status} ${r.text.slice(0, 200)}`);
		return r.json;
	}
}

/** A solid-colour PNG made in code (no image files needed). */
function solidPng(w, h, [r, g, b]) {
	const row = Buffer.alloc(1 + w * 3);
	for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
	const raw = Buffer.concat(Array.from({ length: h }, () => row));
	const chunk = (type, data) => {
		const head = Buffer.alloc(8);
		head.writeUInt32BE(data.length, 0);
		head.write(type, 4, 'ascii');
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
		return Buffer.concat([head, data, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const today = (daysAgo = 0) => {
	const d = new Date(Date.now() - daysAgo * 86_400_000);
	return d.toISOString().slice(0, 10);
};

function templateIdFromDb(dataFile) {
	const require = createRequire(join(root, 'package.json'));
	const Database = require('better-sqlite3');
	const db = new Database(dataFile, { readonly: true, fileMustExist: true });
	try {
		const row = db.prepare('select id from templates order by created_at limit 1').get();
		return row?.id;
	} finally {
		db.close();
	}
}

/** Wait until `fn` returns something truthy, or throw. */
async function until(what, fn, ms = 40_000) {
	const end = Date.now() + ms;
	for (;;) {
		const v = await fn();
		if (v) return v;
		if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
		await sleep(500);
	}
}

/**
 * Seeds when the demo account is missing; always makes sure the simulated printer points at the
 * running mock. `mock` is the repo's MockSdcp, `dataFile` the preview database (read once, to find
 * the template id).
 */
export async function seedDemo({ base, mock, kitExpected, dataFile, mockLib, log }) {
	const owner = new Client(base);
	const existing = await owner.req('POST', '/api/auth/sign-in/email', {
		email: DEMO.email,
		password: DEMO.password
	});
	if (existing.status === 200) {
		log('demo account exists: keeping the data, no seeding.');
		return { seeded: false, summary: await resumePrinter(owner, mock, log) };
	}

	const templateId = templateIdFromDb(dataFile);
	if (!templateId) throw new Error('No template in the database (startup seeding did not run).');

	// ---- people, workspaces
	log('creating the demo account and chapter...');
	await owner.ok('POST', '/api/auth/sign-up/email', {
		name: DEMO.owner,
		email: DEMO.email,
		password: DEMO.password
	});
	await owner
		.ok('POST', '/onboarding?/create', { name: DEMO.chapter }, { form: true })
		.catch(async () => {
			/* action replies are not always 2xx JSON; verified below */
		});
	const orgs = await owner.ok('GET', '/api/auth/organization/list');
	const chapter = orgs.find((o) => o.name === DEMO.chapter);
	const personal = orgs.find((o) => (o.metadata ?? '').includes('"personal"'));
	if (!chapter || !personal) throw new Error('Could not find the chapter and personal workspace.');

	const editor = new Client(base);
	await editor.ok('POST', '/api/auth/sign-up/email', {
		name: DEMO.editor,
		email: DEMO.editorEmail,
		password: DEMO.password
	});
	const inv = await owner.ok('POST', '/api/auth/organization/invite-member', {
		email: DEMO.editorEmail,
		role: 'editor',
		organizationId: chapter.id
	});
	await editor.ok('POST', '/api/auth/organization/accept-invitation', { invitationId: inv.id });

	// The kit (3D model, print geometry) installs in the background at first start.
	if (kitExpected) {
		await until('the kit pack to install', async () => {
			const k = await owner.req('GET', `/api/templates/${templateId}/kit-status`);
			return k.status === 200 && !k.json?.status?.installing && !!k.json?.status?.model;
		}).catch(() => log('the kit pack was not reported as installed in time; continuing.'));
	}

	// ---- build B: fresh, nothing chosen yet (first-run states, the setup wizard)
	await owner.ok('POST', '/api/builds', {
		organizationId: chapter.id,
		templateId,
		name: 'Demo chair B',
		setup: true
	});

	// ---- build A: colors, plates, progress
	const buildA = (
		await owner.ok('POST', '/api/builds', {
			organizationId: chapter.id,
			templateId,
			name: 'Demo chair A',
			setup: false
		})
	).id;
	const colors = {
		primary: ['Navy PETG', 'PETG', '#1f3a5f', 5],
		accent: ['Sky PETG', 'PETG', '#4aa3df', 4],
		soft: ['Navy TPU 95A', 'TPU 95A', '#1f3a5f', 1],
		tire: ['Charcoal TPU 95A', 'TPU 95A', '#2b2b30', 2]
	};
	for (const [role, [name, material, hex, spools]] of Object.entries(colors)) {
		await owner.ok('PATCH', `/api/builds/${buildA}/filaments/${role}`, {
			name,
			material,
			hex,
			spools
		});
	}
	await owner.ok('PATCH', `/api/builds/${buildA}`, {
		recipient: 'Sample recipient',
		hospital: 'Sample children’s clinic',
		phase: 'printing'
	});
	const { catalogPrinter, printerFromCatalog, PRINTER_CATALOG } = mockLib;
	const cat =
		PRINTER_CATALOG.find((p) => p.brand === 'Elegoo' && p.model === 'Centauri Carbon') ??
		catalogPrinter(null);
	if (!cat) throw new Error('Elegoo Centauri Carbon is not in the printer catalog.');
	const mmIndex = cat.mm.length ? 0 : null;
	await owner.ok('PATCH', `/api/builds/${buildA}/printer`, {
		printer: printerFromCatalog(cat, mmIndex)
	});

	let arranged = null;
	try {
		arranged = await owner.ok('POST', `/api/builds/${buildA}/plates/arrange`, {});
	} catch (e) {
		log(`could not arrange plates (${e.message}); using the template's plates.`);
	}

	// Progress: log successful runs on the first plates until about a third of the parts are Printed.
	let view = await owner.ok('GET', `/api/builds/${buildA}/view`);
	const total = Object.keys(view.state).length;
	const goal = Math.round(total / 3);
	const printedPlates = [];
	let printed = 0;
	const plates = view.plates;
	let i = 0;
	for (; i < plates.length && printed < goal; i++) {
		const p = plates[i];
		await owner.ok('POST', `/api/builds/${buildA}/runs`, {
			plateNumber: p.number,
			date: today(10 - i),
			result: 'Success',
			grams: 60 + i * 7,
			hours: Math.round(((p.estSeconds ?? 36000) / 3600) * 10) / 10,
			printer: DEMO.printerName,
			note: i === 0 ? 'First plate, looks good.' : ''
		});
		printed += p.parts.length;
		printedPlates.push(p.number);
	}
	// One failed run (the parts show Reprint), a later plate currently Printing.
	const failedPlate = plates[i];
	if (failedPlate) {
		await owner.ok('POST', `/api/builds/${buildA}/runs`, {
			plateNumber: failedPlate.number,
			date: today(1),
			result: 'Failed',
			grams: 22,
			hours: 2.5,
			printer: DEMO.printerName,
			note: 'Spaghetti after layer 40, adhesion on the corner.'
		});
	}
	const printingPlate = plates[i + 1] ?? plates[i];
	if (printingPlate) {
		await owner.ok('POST', `/api/builds/${buildA}/printing`, {
			action: 'start',
			slugs: printingPlate.parts
		});
	}

	// A progress photo (a generated solid-color image).
	let photo = false;
	try {
		const png = solidPng(640, 480, [74, 163, 223]);
		const form = new FormData();
		form.set('file', new Blob([png], { type: 'image/png' }), 'progress.png');
		form.set('kind', 'progress');
		form.set('caption', 'Sample progress photo (generated image)');
		form.set('width', '640');
		form.set('height', '480');
		await owner.ok('POST', `/api/builds/${buildA}/photos`, form);
		photo = true;
	} catch (e) {
		log(`no photo seeded (${e.message}).`);
	}

	// A saved design from build A, for the designs gallery.
	let design = false;
	try {
		await owner.ok('POST', '/api/designs', {
			buildId: buildA,
			name: 'Demo navy and sky',
			isPublic: false
		});
		design = true;
	} catch (e) {
		log(`no design saved (${e.message}).`);
	}

	// An activity entry from the second member.
	try {
		await editor.ok('PATCH', `/api/builds/${buildA}/filaments/primary`, { spools: 6 });
	} catch {
		/* optional */
	}

	// ---- Studio draft (personal workspace)
	let draft = false;
	try {
		const d = await owner.ok('POST', '/api/builds', {
			organizationId: personal.id,
			templateId,
			name: 'Draft 1',
			kind: 'draft'
		});
		await owner.ok('PATCH', `/api/builds/${d.id}/filaments/primary`, {
			name: 'Forest PETG',
			material: 'PETG',
			hex: '#2f6f4f'
		});
		draft = true;
	} catch (e) {
		log(`no Studio draft seeded (${e.message}).`);
	}

	// ---- the simulated printer, an older unlinked job, and a job linked to the printing plate
	const printerNote = await seedPrinter({
		owner,
		mock,
		org: chapter.id,
		buildA,
		printingPlate,
		log
	});

	const summary = [
		`Seeded: owner + chapter "${DEMO.chapter}" with an editor member, a personal workspace`,
		`Build A "Demo chair A": colors, spools, Centauri Carbon plates${arranged ? ` (${arranged.plates})` : ''}, ${printedPlates.length} plate(s) Printed${failedPlate ? ', 1 failed run (Reprint)' : ''}${printingPlate ? `, plate ${printingPlate.number} Printing` : ''}${photo ? ', a photo' : ''}`,
		`Build B "Demo chair B": fresh, in the setup wizard (nothing chosen)`,
		`Studio draft in the personal workspace${draft ? '' : ' (failed)'}${design ? '; a saved design' : ''}`,
		printerNote
	];
	return { seeded: true, summary };
}

async function printersOf(owner, org) {
	return owner.ok('GET', `/api/printers?org=${org}`);
}

async function seedPrinter({ owner, mock, org, buildA, printingPlate, log }) {
	await owner.ok('POST', '/api/printers', {
		organizationId: org,
		name: DEMO.printerName,
		kind: 'elegoo-sdcp',
		host: '127.0.0.1',
		port: mock.port,
		secrets: { mainboardId: 'ABCDEF' }
	});
	// 1. An older print that is not linked to any build (it finishes).
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	mock.printing('demo-bracket-test.gcode.3mf', 35);
	await until('the first print to show up', async () => {
		const v = await printersOf(owner, org);
		return v.jobs.some((j) => /bracket/.test(JSON.stringify(j)));
	});
	mock.set({ printStatus: 9, machineStatus: [0], progress: 100, layer: 400, totalLayer: 400 });
	await sleep(2500);
	mock.set({ printStatus: 0, machineStatus: [0], progress: 0, file: '' });
	await sleep(2500);
	// 2. The print that is running now, linked to the Printing plate of build A.
	mock.printing(DEMO.activeFile, 42);
	const job = await until('the running print to show up', async () => {
		const v = await printersOf(owner, org);
		return v.jobs.find((j) => JSON.stringify(j).includes(DEMO.activeFile) && !j.buildId);
	});
	let linked = false;
	if (printingPlate) {
		try {
			await owner.ok('POST', `/api/printers/jobs/${job.id}`, {
				action: 'link',
				buildId: buildA,
				plateNumber: printingPlate.number,
				partSlugs: printingPlate.parts
			});
			linked = true;
		} catch (e) {
			log(`could not link the job to the plate (${e.message}).`);
		}
	}
	return `Printer "${DEMO.printerName}" (simulated, loopback only): one older unlinked print, one running print${linked ? ` linked to plate ${printingPlate.number}` : ' (not linked)'}`;
}

/** Later runs: the mock restarts idle and on its own port, so point the printer at it again. */
async function resumePrinter(owner, mock, log) {
	try {
		const orgs = await owner.ok('GET', '/api/auth/organization/list');
		const chapter = orgs.find((o) => o.name === DEMO.chapter);
		const v = await printersOf(owner, chapter.id);
		const p = v.printers.find((x) => x.name === DEMO.printerName);
		if (!p) return [];
		const pv0 = v;
		await owner.ok('PATCH', `/api/printers/${p.id}`, { port: mock.port });
		mock.printing(DEMO.activeFile, 42);
		// The mock lost its job when the preview stopped: link the new running job to the plate of
		// build A that is still Printing, as before.
		let linked = '';
		const a = v.builds.find((b) => b.name === 'Demo chair A');
		if (a) {
			const view = await owner.ok('GET', `/api/builds/${a.id}/view`);
			// The plate the earlier job was linked to (a part can sit on several plates).
			const before = pv0.jobs.filter((j) => j.buildId === a.id && j.plateNumber);
			const want = before.length ? before[0].plateNumber : null;
			const plate = view.plates.find((pl) =>
				want
					? pl.number === want
					: pl.parts.length && pl.parts.every((s) => view.state[s]?.status === 'Printing')
			);
			if (plate) {
				const job = await until('the running print to show up', async () => {
					const pv = await printersOf(owner, chapter.id);
					return pv.jobs.find((j) => JSON.stringify(j).includes(DEMO.activeFile) && !j.buildId);
				});
				await owner.ok('POST', `/api/printers/jobs/${job.id}`, {
					action: 'link',
					buildId: a.id,
					plateNumber: plate.number,
					partSlugs: plate.parts
				});
				linked = `, linked to plate ${plate.number}`;
			}
		}
		return [
			`Existing data kept; the simulated printer is printing "${DEMO.activeFile}" again${linked}.`
		];
	} catch (e) {
		log(`could not reconnect the simulated printer (${e.message}).`);
		return [];
	}
}
