import { json } from '@sveltejs/kit';
import { requireUserId } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import {
	cameraFail,
	printerForMember,
	sessionFor,
	sourceFor
} from '#lib/server/printers/camera-access.ts';
import type { RequestHandler } from './$types';

/** Latest JPEG frame from the printer's shared camera connection (members; 404 = no camera). */
export const GET: RequestHandler = async (event) => {
	try {
		const db = getDb();
		const { row } = printerForMember(db, event.params.id, requireUserId(event));
		if (!(await sourceFor(db, row.id))) return json({ error: 'No camera' }, { status: 404 });
		const f = await sessionFor(db, row.id).snapshot();
		return new Response(new Uint8Array(f.data), {
			headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
		});
	} catch (e) {
		return cameraFail(e);
	}
};
