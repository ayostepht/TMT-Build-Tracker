import { json } from '@sveltejs/kit';
import { getMemberRole } from '#lib/server/access.ts';
import { getDb } from '#lib/server/db/index.ts';
import { subscribePrinterEvents } from '#lib/server/printers/bus.ts';
import type { RequestHandler } from './$types';

/** Team-level server-sent events: live printer status and job changes. */
export const GET: RequestHandler = (event) => {
	if (!event.locals.user) return json({ error: 'Sign in required' }, { status: 401 });
	const org = event.url.searchParams.get('org') ?? '';
	if (!org || !getMemberRole(getDb(), org, event.locals.user.id))
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
			const unsub = subscribePrinterEvents(org, (e) => send(`data: ${JSON.stringify(e)}\n\n`));
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
