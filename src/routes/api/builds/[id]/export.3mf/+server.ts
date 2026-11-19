import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { requireUserId, safeErrorText } from '#lib/server/api.ts';
import { acquireExpensiveReadSlot, releaseWhenDone } from '#lib/server/quota.ts';
import { exportBuild3mf, parseFlavor, parsePlates } from '#lib/server/threemf-export/index.ts';
import type { RequestHandler } from './$types';

/**
 * 3MF for a slicer: `?flavor=orca|bambu|plain&plates=1,2`. Any team member (viewers too).
 * Streamed; `plain` with several plates is a zip of one 3MF per plate. Holds one
 * expensive-read slot until the stream ends.
 */
export const GET: RequestHandler = (event) => {
	let release: (() => void) | null = null;
	try {
		const userId = requireUserId(event);
		release = acquireExpensiveReadSlot(getDb(), event.locals.user!);
		const q = event.url.searchParams;
		const out = exportBuild3mf(getDb(), event.params.id, userId, {
			flavor: parseFlavor(q.get('flavor')),
			plates: parsePlates(q.get('plates'))
		});
		const stream = releaseWhenDone(out.stream, release);
		release = null; // now owned by the stream
		return new Response(stream, {
			headers: {
				'content-type': out.contentType,
				'content-disposition': `attachment; filename="${out.filename}"`,
				'cache-control': 'no-store',
				'x-tmt-export-warnings': String(out.warnings.length),
				'x-tmt-export-missing': out.missing.map((m) => m.slug).join(',')
			}
		});
	} catch (e) {
		release?.();
		if (e instanceof ApiError) {
			const code = (e as { code?: unknown }).code;
			return json(
				{ error: e.message, ...(typeof code === 'string' ? { code } : {}) },
				{ status: e.status }
			);
		}
		console.error('[tmt] export error', safeErrorText(e));
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
