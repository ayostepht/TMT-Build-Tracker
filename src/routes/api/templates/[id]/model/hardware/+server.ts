import { unlink } from 'node:fs/promises';
import { respond } from '#lib/server/api.ts';
import { templateHardwarePath } from '#lib/server/config.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { hardwareModelUrl } from '#lib/server/models/hardware.ts';
import { saveUpload } from '#lib/server/models/uploads.ts';
import type { RequestHandler } from './$types';

const MAX_GLB_BYTES = 100 * 1024 * 1024;

/** Site admin: upload the optional neutral hardware GLB (raw GLB as the request body, built with scripts/step-to-glb.mjs). */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		requireAdminForTemplate(event, event.params.id);
		const size = await saveUpload(event.request, templateHardwarePath(event.params.id), {
			maxBytes: MAX_GLB_BYTES,
			magic: 'glTF',
			what: 'GLB file'
		});
		return { size, hardwareUrl: hardwareModelUrl(event.params.id) };
	});

export const DELETE: RequestHandler = (event) =>
	respond(async () => {
		requireAdminForTemplate(event, event.params.id);
		await unlink(templateHardwarePath(event.params.id)).catch(() => {});
		return {};
	});
