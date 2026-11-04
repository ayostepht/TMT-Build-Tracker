import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.ts';
import { ApiError } from '#lib/server/access.ts';
import { requireUserId } from '#lib/server/api.ts';
import { exportBuild3mf, parseFlavor, parsePlates } from '#lib/server/threemf-export/index.ts';
import type { RequestHandler } from './$types';

/**
 * 3MF for a slicer: `?flavor=orca|bambu|plain&plates=1,2`. Any team member (viewers too).
 * Streamed; `plain` with several plates is a zip of one 3MF per plate.
 */
export const GET: RequestHandler = (event) => {
	try {
		const q = event.url.searchParams;
		const out = exportBuild3mf(getDb(), event.params.id, requireUserId(event), {
			flavor: parseFlavor(q.get('flavor')),
			plates: parsePlates(q.get('plates'))
		});
		return new Response(out.stream, {
			headers: {
				'content-type': out.contentType,
				'content-disposition': `attachment; filename="${out.filename}"`,
				'cache-control': 'no-store',
				'x-tmt-export-warnings': String(out.warnings.length),
				'x-tmt-export-missing': out.missing.map((m) => m.slug).join(',')
			}
		});
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		console.error('[tmt] export error', e);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
