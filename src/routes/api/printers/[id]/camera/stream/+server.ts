import { json } from '@sveltejs/kit';
import { requireUserId } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { streamResponse } from '#lib/server/printers/camera.ts';
import {
	cameraFail,
	printerForMember,
	sessionFor,
	sourceFor
} from '#lib/server/printers/camera-access.ts';
import type { RequestHandler } from './$types';

/** MJPEG (multipart/x-mixed-replace) passthrough of the shared camera connection (members). */
export const GET: RequestHandler = async (event) => {
	try {
		const db = getDb();
		const { row } = printerForMember(db, event.params.id, requireUserId(event));
		if (!(await sourceFor(db, row.id))) return json({ error: 'No camera' }, { status: 404 });
		const session = sessionFor(db, row.id);
		// Hold the connection while we confirm the camera answers, so a dead camera is a clean 502.
		const release = session.retain();
		try {
			await session.frame(3000, 10_000);
		} catch (e) {
			release();
			throw e;
		}
		const res = streamResponse(session, event.request.signal);
		release(); // the response holds its own watch now
		return res;
	} catch (e) {
		return cameraFail(e);
	}
};
