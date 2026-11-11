import { cameraSupported, checkCameraUrl } from '#lib/printers/camera-url.ts';
import { shareLinkOf } from '#lib/printers/share-link.ts';
import { ApiError, requireEditor } from '#lib/server/access.ts';
import { readJson, requireUserId, respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { CameraError, grabFrame } from '#lib/server/printers/camera.ts';
import { testEnabler } from '#lib/server/printers/camera-access.ts';
import { resolveCameraSource } from '#lib/server/printers/camera-source.ts';
import { resolveAllowed } from '#lib/server/printers/outbound.ts';
import { configFromInput } from '#lib/server/printers/store.ts';
import type { RequestHandler } from './$types';

/**
 * Settings "Test": fetch one frame with the typed (or stored) camera settings and send it back as
 * a data URL for the preview. Editors only; the same-host guard applies to what is typed and the
 * outbound guard to where it connects.
 */
export const POST: RequestHandler = (event) =>
	respond(async () => {
		const db = getDb();
		const userId = requireUserId(event);
		const body = (await readJson(event)) as Record<string, unknown>;
		const org = typeof body?.organizationId === 'string' ? body.organizationId : '';
		if (!org) throw new ApiError(400, 'organizationId is required');
		requireEditor(db, org, userId);
		const cfg = configFromInput(db, org, body);
		// Refused in public mode / for a non-local address, before any request. Through an
		// OctoEverywhere link the destination is the link's host (a validated public address).
		const link = cfg.kind === 'elegoo-sdcp' ? shareLinkOf(cfg.secrets) : null;
		await resolveAllowed(link ? link.host : cfg.host, undefined, { allowShareLink: !!link });
		if (!cameraSupported(cfg.kind))
			return { works: false, message: 'This printer type has no camera support.' };
		// With an OctoEverywhere link the camera address comes from the link; a typed one is ignored.
		const typed = typeof body.cameraUrl === 'string' && !link ? body.cameraUrl.trim() : '';
		if (typed) {
			const c = checkCameraUrl(typed, cfg.host);
			if (!c.ok) throw new ApiError(400, c.error);
		}
		const src = await resolveCameraSource({
			kind: cfg.kind,
			host: cfg.host,
			port: cfg.port,
			cameraUrl: typed || null,
			cameraEnabled: true,
			secrets: cfg.secrets
		});
		if (!src) return { works: false, message: 'No camera found for this printer.' };
		try {
			const jpg = await grabFrame(src, {}, testEnabler(cfg));
			return {
				works: true,
				image: `data:image/jpeg;base64,${jpg.toString('base64')}`,
				origin: src.origin
			};
		} catch (e) {
			return { works: false, message: e instanceof CameraError ? e.message : 'Camera test failed' };
		}
	});
