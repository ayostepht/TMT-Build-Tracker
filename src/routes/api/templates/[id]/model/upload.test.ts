import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '#lib/server/db/index.ts';
import { runMigrations } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { templateSeeds } from '#lib/server/seed/index.ts';
import { seedTemplates } from '#lib/server/seed/run.ts';
import { defaultTemplate } from '#lib/server/templates/fork.ts';
import { importsDir } from '#lib/server/config.ts';
import { POST } from './+server.ts';

let tid: string;

function event(body: BodyInit | null, user_ = { id: 'adm', email: 'adm@x.test' }) {
	return {
		request: new Request('http://x.test/upload', {
			method: 'POST',
			body,
			duplex: 'half'
		} as RequestInit),
		locals: { user: user_ },
		params: { id: tid },
		url: new URL('http://x.test/upload?name=a.zip')
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.stubEnv('DATABASE_URL', join(mkdtempSync(join(tmpdir(), 'tmt-up-')), 'tmt.db'));
	const db = getDb();
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	db.insert(user)
		.values({ id: 'adm', name: 'A', email: 'adm@x.test', createdAt: new Date(1) })
		.onConflictDoNothing()
		.run();
	tid = defaultTemplate(db).id;
});
afterEach(() => vi.unstubAllEnvs());

describe('STEP zip upload route', () => {
	it('507 before creating any file when the disk is full', async () => {
		vi.stubEnv('MIN_FREE_DISK_MB', '999999999');
		const res = await POST(event('PK\x03\x04data'));
		expect(res.status).toBe(507);
		expect((await res.json()).error).toBe('The server is almost out of disk space');
		expect(existsSync(importsDir())).toBe(false);
	});

	it('leaves no partial file for a rejected or aborted upload', async () => {
		const res = await POST(event('not a zip at all'));
		expect(res.status).toBe(400);
		const failing = new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode('PK\x03\x04abc'));
			},
			pull() {
				throw new Error('client went away');
			}
		});
		const res2 = await POST(event(failing as unknown as BodyInit));
		expect(res2.status).toBe(400);
		expect(existsSync(importsDir()) ? readdirSync(importsDir()) : []).toEqual([]);
	});
});
