/**
 * The OctoEverywhere share-link host IS the secret. Whatever DNS does, no response a member or
 * editor can read may contain it; and the share-host exception is opt-in (Elegoo link paths only).
 * DNS and sockets are stubbed: nothing here leaves the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, runMigrations, type Db } from '../db';
import { member, organization, user } from '../db/schema';
import { SpoolmanClient } from '../spoolman/client';
import { getCameraHub } from './camera';
import { cameraChanged } from './camera-access';
import { resolveCameraSource } from './camera-source';
import { guardedFetch, resolveAllowed, setResolver } from './outbound';
import { createPrinter } from './store';

// Made-up token: never a real link.
const HOST = 'shared-leaktesttoken1234.octoeverywhere.com';
const PUBLIC4 = '93.184.216.34';

let db: Db;
vi.mock('#lib/server/db/index.ts', async (orig) => ({
	...(await orig<typeof import('#lib/server/db/index.ts')>()),
	getDb: () => db
}));
vi.mock('#lib/server/api.ts', async (orig) => ({
	...(await orig<typeof import('#lib/server/api.ts')>()),
	requireUserId: (e: { locals: { user?: { id: string } } }) => e.locals.user!.id
}));

const { GET: snapshotGET } =
	await import('../../../routes/api/printers/[id]/camera/snapshot/+server.ts');
const { GET: streamGET } =
	await import('../../../routes/api/printers/[id]/camera/stream/+server.ts');
const { POST: testPOST } = await import('../../../routes/api/printers/test/+server.ts');
const { POST: cameraTestPOST } =
	await import('../../../routes/api/printers/camera-test/+server.ts');

let printerId = '';
beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	for (const id of ['ed', 'view'])
		db.insert(user)
			.values({ id, name: id, email: `${id}@example.test` })
			.run();
	db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
	for (const [id, role] of [
		['ed', 'editor'],
		['view', 'viewer']
	])
		db.insert(member)
			.values({ id: `m-${id}`, organizationId: 'o', userId: id, role, createdAt: new Date() })
			.run();
	printerId = createPrinter(db, 'o', 'ed', {
		name: 'Linked',
		kind: 'elegoo-sdcp',
		host: 'octoeverywhere',
		secrets: { shareLink: `https://${HOST}` }
	}).id;
});
afterEach(() => {
	cameraChanged(printerId);
	getCameraHub().invalidate(printerId);
	setResolver(null);
	vi.unstubAllGlobals();
});

const ev = (userId: string, extra: Record<string, unknown> = {}) =>
	({
		locals: { user: { id: userId } },
		params: { id: printerId },
		request: new Request('http://localhost/x', {
			method: 'POST',
			body: JSON.stringify({ organizationId: 'o', id: printerId, ...extra })
		}),
		url: new URL('http://localhost/x')
	}) as never;

const clean = (s: string) => {
	expect(s).not.toContain('shared-');
	expect(s).not.toContain('octoeverywhere.com');
	expect(s).not.toContain('leaktesttoken');
};

const scenarios: [string, () => Promise<string[]>][] = [
	[
		'DNS failure',
		async () => (
			setResolver(async () => {
				throw new Error(`ENOTFOUND ${HOST}`);
			}),
			[]
		)
	],
	['an empty answer', async () => (setResolver(async () => []), [])],
	[
		'a DNS timeout',
		async () => (
			setResolver(async () => {
				throw new Error('dns timeout');
			}),
			[]
		)
	],
	[
		'all answers private',
		async () => (setResolver(async () => ['10.0.0.1', '169.254.169.254']), [])
	]
];

describe.each(scenarios)('share-link host never leaves in an error: %s', (_n, arrange) => {
	it('camera snapshot and stream (any member, incl. viewers)', async () => {
		await arrange();
		for (const who of ['view', 'ed']) {
			const snap = await snapshotGET(ev(who));
			expect(snap.ok).toBe(false);
			clean(await snap.text());
			const st = await streamGET(ev(who));
			if (!st.ok) clean(await st.text());
			else {
				// A stream that opened reports problems in-band; read nothing that could leak.
				await st.body?.cancel();
			}
			cameraChanged(printerId);
		}
	}, 30_000);

	it('both editor test routes', async () => {
		await arrange();
		const a = await testPOST(ev('ed'));
		clean(await a.text());
		const b = await cameraTestPOST(ev('ed'));
		clean(await b.text());
	});
});

describe('the share-host exception is opt-in', () => {
	it('resolveAllowed / guardedFetch refuse a share host without allowShareLink', async () => {
		const dns = async () => [PUBLIC4];
		setResolver(dns);
		await expect(resolveAllowed(HOST, dns)).rejects.toMatchObject({ kind: 'address' });
		await expect(resolveAllowed(HOST, dns)).rejects.toThrow(
			/not on your local network|not allowed/
		);
		await expect(resolveAllowed(HOST, dns, { allowShareLink: false })).rejects.toThrow();
		await expect(guardedFetch(`https://${HOST}/video`)).rejects.toThrow();
		await expect(resolveAllowed(HOST, dns, { allowShareLink: true })).resolves.toMatchObject({
			shareLink: true
		});
		try {
			await resolveAllowed(HOST, dns);
		} catch (e) {
			clean((e as Error).message);
		}
	});

	it('Spoolman on a share host is refused', async () => {
		setResolver(async () => [PUBLIC4]);
		const c = new SpoolmanClient(`https://${HOST}`);
		const err = await c.health().then(
			() => null,
			(e: Error) => e
		);
		expect(err).toBeTruthy();
		clean(err!.message);
	});

	it('a custom cameraUrl on a share host for a non-link printer is refused at connect', async () => {
		// Not a link printer: its host is the share host itself (typed by an editor).
		const src = await resolveCameraSource({
			kind: 'moonraker',
			host: HOST,
			port: null,
			cameraUrl: `https://${HOST}/video`,
			cameraEnabled: true,
			secrets: {}
		});
		if (src) {
			expect(src.shareLink).toBeFalsy();
			setResolver(async () => [PUBLIC4]);
			await expect(guardedFetch(src.urls[0])).rejects.toThrow();
		}
	});

	it('the link paths still work: link source is flagged and the status socket dials it', async () => {
		const src = await resolveCameraSource({
			kind: 'elegoo-sdcp',
			host: 'octoeverywhere',
			port: null,
			cameraUrl: null,
			cameraEnabled: true,
			secrets: { shareLink: `https://${HOST}` }
		});
		expect(src).toMatchObject({ host: HOST, shareLink: true });
		await expect(
			resolveAllowed(HOST, async () => [PUBLIC4], { allowShareLink: true })
		).resolves.toMatchObject({ ip: PUBLIC4 });
	});
});
