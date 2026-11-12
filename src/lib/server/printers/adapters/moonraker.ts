import { isObj, type Obj } from '#lib/domain/guards.ts';
/** Klipper via Moonraker: WebSocket JSON-RPC with `printer.objects.subscribe`. Read-only. */
import type { PrinterStatus } from '#lib/printers/status.ts';
import { shareLinkFor, shareLinkUrl } from '#lib/printers/share-link.ts';
import {
	guardedFetch,
	ipForUrl,
	isRedirect,
	MAX_REMOTE_MESSAGE_BYTES,
	OutboundError,
	readJsonCapped,
	REDIRECT_MESSAGE,
	resolveAllowed,
	safeFileName,
	safeText
} from '../outbound';
import {
	backoff,
	CONNECT_TIMEOUT_MS,
	FLOODED_MESSAGE,
	HostileGuard,
	linkBackoff,
	LINK_SILENT_CLOSE_MS,
	MessageBudget,
	num,
	OVERSIZED_MESSAGE,
	safeError,
	StatusSubject,
	temp,
	type AdapterHandle,
	type PrinterConfig
} from '../types';

/** Merge a (partial) status update into the accumulated object tree. */
export function mergeStatus(into: Obj, patch: Obj): Obj {
	for (const [k, v] of Object.entries(patch)) {
		// A JSON `__proto__` key would otherwise merge into Object.prototype.
		if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
		if (isObj(v) && isObj(into[k])) mergeStatus(into[k] as Obj, v);
		else into[k] = isObj(v) ? mergeStatus({}, v) : v;
	}
	return into;
}

export function normalizeMoonraker(st: Obj): PrinterStatus {
	const ps = isObj(st.print_stats) ? st.print_stats : {};
	const ds = isObj(st.display_status) ? st.display_status : {};
	const vs = isObj(st.virtual_sdcard) ? st.virtual_sdcard : {};
	const ex = isObj(st.extruder) ? st.extruder : {};
	const hb = isObj(st.heater_bed) ? st.heater_bed : {};
	const info = isObj(ps.info) ? ps.info : {};
	const st0 = typeof ps.state === 'string' ? ps.state : 'standby';
	const state: PrinterStatus['state'] =
		st0 === 'printing'
			? 'printing'
			: st0 === 'paused'
				? 'paused'
				: st0 === 'complete'
					? 'done'
					: st0 === 'cancelled'
						? 'failed'
						: st0 === 'error'
							? 'error'
							: 'idle';
	let frac = num(ds.progress) ?? num(vs.progress);
	if (state === 'done') frac = 1;
	const elapsed = num(ps.print_duration);
	const out: PrinterStatus = {
		state,
		progress: state === 'idle' ? null : frac === undefined ? null : Math.round(frac * 1000) / 10,
		fileName: state !== 'idle' ? safeFileName(ps.filename) : undefined,
		nozzleC: temp(ex.temperature),
		bedC: temp(hb.temperature)
	};
	if (state === 'printing' || state === 'paused' || state === 'done') {
		out.layer = num(info.current_layer);
		out.totalLayers = num(info.total_layer);
		out.elapsedSec = elapsed === undefined ? undefined : Math.round(elapsed);
		if (state !== 'done' && elapsed && frac && frac > 0.01)
			out.remainingSec = Math.max(0, Math.round(elapsed / frac - elapsed));
	}
	if (st0 === 'cancelled') out.cancelled = true;
	if (state === 'error') out.message = safeText(ps.message, 200) || 'Klipper error';
	return out;
}

export function connectMoonraker(cfg: PrinterConfig): AdapterHandle {
	const subj = new StatusSubject();
	let ws: WebSocket | null = null;
	let attempt = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let ping: ReturnType<typeof setInterval> | undefined;
	let stale: ReturnType<typeof setTimeout> | undefined;
	let connectTimer: ReturnType<typeof setTimeout> | undefined;
	let acc: Obj = {};
	const hostile = new HostileGuard();
	// OctoEverywhere shared link: https/wss to the link host (the web interface's own paths), no
	// port. A relay that hangs up must not be re-dialled every few seconds, so `attempt` resets
	// only once a valid message arrived and the delays are the slower `linkBackoff` ones.
	const link = shareLinkFor(cfg.kind, cfg.secrets);
	const delay = (extra = 0) => (link ? linkBackoff(attempt++) : backoff(attempt++ + extra));

	/**
	 * Close the socket we hold (it hung, or went silent) and retry on the normal backoff; through a
	 * link that is `linkBackoff`. The close handler ignores it because `ws` is cleared first.
	 */
	const dropSocket = (message: string) => {
		const s = ws;
		ws = null;
		if (s) {
			s.onmessage = null;
			try {
				s.close();
			} catch {
				/* ignore */
			}
		}
		clearInterval(ping);
		clearTimeout(stale);
		clearTimeout(connectTimer);
		if (subj.closed) return;
		subj.emit({ state: 'offline', progress: null, message });
		clearTimeout(retry);
		retry = setTimeout(() => void open(), delay());
	};
	const armStale = () => {
		clearTimeout(stale);
		const STALE = 45000;
		stale = setTimeout(() => {
			if (!link) return dropSocket('No data from the printer');
			// Link: report it, but keep the socket until the long silence limit.
			subj.emit({ state: 'offline', progress: null, message: 'No data from the printer' });
			stale = setTimeout(
				() => dropSocket('No data from the printer'),
				LINK_SILENT_CLOSE_MS - STALE
			);
		}, STALE);
	};
	const reconnect = () => {
		clearInterval(ping);
		clearTimeout(stale);
		if (subj.closed) return;
		subj.emit({ state: 'offline', progress: null, message: 'Disconnected' });
		clearTimeout(retry);
		retry = setTimeout(() => void open(), delay());
	};

	async function open() {
		if (subj.closed) return;
		let named: string; // http(s) origin the REST calls go to
		let wsBase: string;
		try {
			// Resolved and validated on every (re)connect; both requests go to the validated IP
			// (link: the validated public address; the global WebSocket cannot pin it, so the name is
			// validated right before the dial).
			if (link) {
				await resolveAllowed(link.host, undefined, { allowShareLink: true });
				named = link.origin;
				wsBase = `wss://${link.host}`;
			} else {
				const t = await resolveAllowed(cfg.host);
				named = `http://${ipForUrl(t.host)}:${cfg.port ?? 7125}`; // keeps the Host header; guardedFetch pins the IP
				wsBase = `ws://${ipForUrl(t.ip)}:${cfg.port ?? 7125}`;
			}
		} catch (e) {
			if (subj.closed) return;
			subj.emit({ state: 'error', progress: null, message: safeError(e) });
			if (!(e instanceof OutboundError && e.kind === 'public'))
				retry = setTimeout(() => void open(), delay(3));
			return;
		}
		if (subj.closed) return;
		let query = '';
		if (cfg.secrets.apiKey) {
			// Browsers/WebSocket cannot set headers: trade the API key for a one-shot token.
			try {
				const r = await guardedFetch(shareLinkUrl(named, '/access/oneshot_token'), {
					headers: { 'X-Api-Key': cfg.secrets.apiKey },
					signal: AbortSignal.timeout(5000),
					...(link ? { allowShareLink: true } : {})
				});
				if (isRedirect(r.status)) throw new Error(REDIRECT_MESSAGE);
				const j = (await readJsonCapped(r)) as { result?: string };
				if (j.result) query = `?token=${encodeURIComponent(j.result)}`;
			} catch (e) {
				subj.emit({ state: 'offline', progress: null, message: safeError(e) });
				retry = setTimeout(() => void open(), delay());
				return;
			}
			if (subj.closed) return;
		}
		let sock: WebSocket;
		try {
			sock = new WebSocket(`${wsBase}/websocket${query}`);
		} catch (e) {
			subj.emit({ state: 'offline', progress: null, message: safeError(e) });
			retry = setTimeout(() => void open(), delay());
			return;
		}
		ws = sock;
		const budget = new MessageBudget();
		// A peer that accepts the TCP connection but never finishes the handshake.
		clearTimeout(connectTimer);
		connectTimer = setTimeout(() => {
			if (ws === sock && sock.readyState === 0) dropSocket('Timed out connecting to the printer');
		}, CONNECT_TIMEOUT_MS);
		/** Oversized, non-text or flooding peer: drop the socket and come back on a long backoff. */
		const tooBig = (message = OVERSIZED_MESSAGE) => {
			ws = null; // the close handler below then ignores this socket
			sock.onmessage = null;
			clearInterval(ping);
			clearTimeout(stale);
			try {
				sock.close();
			} catch {
				/* ignore */
			}
			clearTimeout(connectTimer);
			subj.emit({ state: 'error', progress: null, message });
			clearTimeout(retry);
			// Through a link: never faster than the slow link backoff either.
			retry = setTimeout(
				() => void open(),
				Math.max(hostile.trip(), link ? linkBackoff(attempt++) : 0)
			);
		};
		sock.onopen = () => {
			clearTimeout(connectTimer);
			if (!link) attempt = 0;
			acc = {};
			armStale();
			sock.send(
				JSON.stringify({
					jsonrpc: '2.0',
					method: 'printer.objects.subscribe',
					params: {
						objects: {
							print_stats: null,
							display_status: null,
							virtual_sdcard: null,
							extruder: ['temperature', 'target'],
							heater_bed: ['temperature', 'target']
						}
					},
					id: 1
				})
			);
			clearInterval(ping);
			ping = setInterval(() => {
				if (sock.readyState === 1)
					sock.send(JSON.stringify({ jsonrpc: '2.0', method: 'server.info', id: 2 }));
			}, 15000);
		};
		sock.onmessage = (ev) => {
			// Event-handler throws are uncaught exceptions (deep JSON can overflow the stack).
			try {
				handle(ev.data);
			} catch {
				/* hostile or malformed frame: ignore it */
			}
		};
		const handle = (data: unknown) => {
			// Checked before JSON.parse: nothing over the cap, or past the per-second budget, is parsed.
			if (typeof data !== 'string' || data.length > MAX_REMOTE_MESSAGE_BYTES) return tooBig();
			if (!budget.take(data.length)) return tooBig(FLOODED_MESSAGE);
			const m: unknown = JSON.parse(data);
			if (!isObj(m)) return;
			attempt = 0;
			hostile.good();
			armStale();
			if (m.id === 1 && isObj(m.result) && isObj(m.result.status)) {
				acc = mergeStatus({}, m.result.status);
				subj.emit(normalizeMoonraker(acc));
			} else if (
				m.method === 'notify_status_update' &&
				Array.isArray(m.params) &&
				isObj(m.params[0])
			) {
				mergeStatus(acc, m.params[0]);
				subj.emit(normalizeMoonraker(acc));
			} else if (m.id === 2 && subj.current?.state === 'offline') {
				subj.emit(normalizeMoonraker(acc));
			}
		};
		sock.onerror = () => {};
		sock.onclose = () => {
			clearTimeout(connectTimer);
			if (ws === sock) reconnect();
		};
	}
	void open();

	return {
		status$: (cb) => subj.subscribe(cb),
		close: () => {
			subj.closed = true;
			clearInterval(ping);
			clearTimeout(retry);
			clearTimeout(stale);
			clearTimeout(connectTimer);
			const s = ws;
			ws = null;
			try {
				s?.close();
			} catch {
				/* ignore */
			}
		}
	};
}
