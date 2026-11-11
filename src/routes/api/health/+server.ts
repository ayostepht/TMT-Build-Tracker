import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import { APP_VERSION } from '#lib/version.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	try {
		getDb().run(sql`select 1`);
		return json({ ok: true, version: APP_VERSION });
	} catch {
		return json({ ok: false }, { status: 503 });
	}
};
