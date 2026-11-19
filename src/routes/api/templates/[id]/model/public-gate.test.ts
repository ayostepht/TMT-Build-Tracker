import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, runMigrations } from '#lib/server/db/index.ts';
import { assertModelConversionAllowed } from '#lib/server/models/guard.ts';
import { importsDir } from '#lib/server/config.ts';
import { templateSeeds } from '#lib/server/seed/index.ts';
import { seedTemplates } from '#lib/server/seed/run.ts';
import { defaultTemplate } from '#lib/server/templates/fork.ts';
import { POST } from './+server.ts';

// The caller is an editor of the workspace that owns the template copy.
vi.mock('#lib/server/templates/fork.ts', async (orig) => ({
	...(await orig<object>()),
	canManageTemplate: () => true
}));

let tid: string;
const editor = { id: 'ed', email: 'ed@x.test', emailVerified: true };

const call = (u = editor) =>
	POST({
		request: new Request('http://x.test/u', { method: 'POST', body: 'PK\x03\x04x' }),
		locals: { user: u },
		params: { id: tid },
		url: new URL('http://x.test/u?name=a.zip')
	} as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
	vi.stubEnv('DATABASE_URL', join(mkdtempSync(join(tmpdir(), 'tmt-gate-')), 'tmt.db'));
	vi.stubEnv('ADMIN_EMAILS', 'adm@x.test');
	const db = getDb();
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	tid = defaultTemplate(db).id;
});
afterEach(() => vi.unstubAllEnvs());

describe('3D model conversion in public mode', () => {
	beforeEach(() => {
		vi.stubEnv('TMT_MODE', 'public');
		vi.stubEnv('PUBLIC_URL', 'https://example.test');
	});

	it('is refused for a workspace editor who is not a site admin', () => {
		expect(() => assertModelConversionAllowed(getDb(), editor)).toThrow(
			'Only site admins can convert 3D models on this server.'
		);
		expect(() =>
			assertModelConversionAllowed(getDb(), { ...editor, email: 'adm@x.test' })
		).not.toThrow();
	});

	it('the upload route answers 403 before reading the body', async () => {
		const res = await call();
		expect(res.status).toBe(403);
		expect((await res.json()).error).toMatch(/Only site admins/);
		expect(existsSync(importsDir())).toBe(false);
	});
});

describe('3D model conversion in self-hosted mode', () => {
	it('stays open to workspace editors of their own kit copy', () => {
		vi.stubEnv('TMT_MODE', 'selfhost');
		expect(() => assertModelConversionAllowed(getDb(), editor)).not.toThrow();
	});
});
