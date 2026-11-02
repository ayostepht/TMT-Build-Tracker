import { json } from '@sveltejs/kit';
import { buildAccess } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { subscribeBuildEvents } from '#lib/server/events.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	if (!event.locals.user) return json({ error: 'Sign in required' }, { status: 401 });
	const buildId = event.params.id;
	if (!buildAccess(getDb(), buildId, event.locals.user.id))
		return json({ error: 'Not found' }, { status: 404 });

	const enc = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (s: string) => {
				try {
					controller.enqueue(enc.encode(s));
				} catch {
					cleanup();
				}
			};
			const unsub = subscribeBuildEvents(buildId, (e) => send(`data: ${JSON.stringify(e)}\n\n`));
			const beat = setInterval(() => send(': keepalive\n\n'), 25_000);
			cleanup = () => {
				clearInterval(beat);
				unsub();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			event.request.signal.addEventListener('abort', cleanup);
			send('retry: 3000\n: connected\n\n');
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
