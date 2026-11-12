import { isObj, type Obj } from '#lib/domain/guards.ts';
/**
 * Elegoo SDCP (Smart Device Control Protocol v3) over WebSocket, read-only except for one
 * maintainer-approved write: Cmd 386 `{ Enable: 1 }` (camera on; port 3031 answers
 * `camera not ready` until the printer gets it). Every request is built by `sdcpEnvelope`, which
 * refuses any other command (`SDCP_ALLOWED_COMMANDS`).
 *
 * Centauri Carbon (CC1): `ws://<ip>:3030/websocket`, JSON envelopes
 * `{ Id, Topic: 'sdcp/request/<MainboardID>', Data: { Cmd, Data, RequestID, MainboardID, TimeStamp, From } }`.
 * We only ever send Cmd 0 (status refresh) and Cmd 1 (attributes refresh); answers arrive on
 * `sdcp/status/<id>` and `sdcp/attributes/<id>`. Sources: Elegoo's SDCP v3 spec
 * (cbd-tech/SDCP-Smart-Device-Control-Protocol-V3.0.0), OpenCentauri, pycentauri docs and the
 * danielcherubini/elegoo-homeassistant integration. The FDM print-status codes are the
 * Centauri ones (13 printing, 9 complete, 8 stopped...). CC1 allows ~5 concurrent sockets.
 */
import { randomBytes } from 'node:crypto';
import type { PrinterFilament, PrinterStatus } from '#lib/printers/status.ts';
import {
	SHARE_LINK_HOST_PLACEHOLDER,
	shareLinkOf,
	shareLinkSocketUrl
} from '#lib/printers/share-link.ts';
import { probeMainboardId } from '../discovery';
import {
	ipForUrl,
	MAX_REMOTE_MESSAGE_BYTES,
	OutboundError,
	resolveAllowed,
	safeFileName
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

/** Read-only commands: status refresh and attributes refresh. Always sent with empty data. */
export const SDCP_READ_COMMANDS: readonly number[] = [0, 1];
/**
 * The ONLY write commands this app may ever send, each with its one allowed payload. 386 turns
 * the camera on. Never add anything that moves, heats, pauses, stops or starts a print.
 */
export const SDCP_ALLOWED_COMMANDS: readonly number[] = [386];
const SDCP_WRITE_PAYLOADS: Record<number, string> = { 386: JSON.stringify({ Enable: 1 }) };

export class SdcpCommandError extends Error {}

/** The one place an SDCP request is built: throws unless the command (and payload) is allowed. */
export function sdcpEnvelope(cmd: number, data: Obj, mainboardId: string): string {
	const isRead = SDCP_READ_COMMANDS.includes(cmd);
	const isWrite = SDCP_ALLOWED_COMMANDS.includes(cmd);
	if (!isRead && !isWrite) throw new SdcpCommandError(`SDCP command ${cmd} is not allowed`);
	const payload = JSON.stringify(data);
	if (isRead && payload !== '{}') throw new SdcpCommandError(`SDCP command ${cmd} takes no data`);
	if (isWrite && payload !== SDCP_WRITE_PAYLOADS[cmd])
		throw new SdcpCommandError(`SDCP command ${cmd} payload is not allowed`);
	return JSON.stringify({
		Id: mainboardId,
		Topic: `sdcp/request/${mainboardId}`,
		Data: {
			Cmd: cmd,
			Data: data,
			RequestID: randomBytes(8).toString('hex'),
			MainboardID: mainboardId,
			TimeStamp: Date.now(),
			From: 1
		}
	});
}

/** Camera-on request text (Cmd 386 `{ Enable: 1 }`). */
export const cameraOnEnvelope = (mainboardId: string) =>
	sdcpEnvelope(386, { Enable: 1 }, mainboardId);

/**
 * Turn the camera on over a short-lived socket of our own (used when no supervisor socket is
 * open): connect, send Cmd 386, wait briefly for the answer, close. True when it was sent.
 */
export async function enableSdcpCamera(
	cfg: PrinterConfig,
	opts: { timeoutMs?: number; settleMs?: number } = {}
): Promise<boolean> {
	const timeout = opts.timeoutMs ?? 5000;
	const settle = opts.settleMs ?? 1500;
	// Through an OctoEverywhere link the camera needs no Cmd 386 (OctoEverywhere keeps the stream
	// up), so no second socket is opened on the printer's own connection slots.
	if (shareLinkOf(cfg.secrets)) return false;
	if (cfg.host === SHARE_LINK_HOST_PLACEHOLDER) return false; // link missing: never dial the placeholder
	let target;
	try {
		target = await resolveAllowed(cfg.host); // public mode / non-local address: refused here
	} catch {
		return false;
	}
	const id = cfg.secrets.mainboardId || (await probeMainboardId(cfg.host)) || '';
	if (!id) return false;
	return new Promise<boolean>((resolve) => {
		let sock: WebSocket;
		let sent = false;
		let finished = false;
		const done = (ok: boolean) => {
			if (finished) return;
			finished = true;
			clearTimeout(t);
			try {
				sock.close();
			} catch {
				/* ignore */
			}
			resolve(ok);
		};
		const t = setTimeout(() => done(sent), timeout);
		try {
			sock = new WebSocket(`ws://${ipForUrl(target.ip)}:${cfg.port ?? 3030}/websocket`);
		} catch {
			clearTimeout(t);
			return resolve(false);
		}
		sock.onopen = () => {
			try {
				sock.send(cameraOnEnvelope(id));
				sent = true;
				setTimeout(() => done(true), settle);
			} catch {
				done(false);
			}
		};
		sock.onmessage = (ev) => {
			// An oversized or non-text answer ends this short-lived socket at once.
			if (typeof ev.data !== 'string' || ev.data.length > MAX_REMOTE_MESSAGE_BYTES)
				return done(sent);
			if (sent) done(true);
		};
		sock.onerror = () => done(sent);
		sock.onclose = () => done(sent);
	});
}

const POLL_MS = 4000;
const STALE_MS = 20000;

const PREP = new Set([1, 10, 11, 12, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);

/** Map the `Status` object of an SDCP status push to our normalised status. */
export function normalizeSdcpStatus(s: Obj, attributes?: Obj): PrinterStatus {
	const info = isObj(s.PrintInfo) ? s.PrintInfo : {};
	const cur = Array.isArray(s.CurrentStatus)
		? (s.CurrentStatus as unknown[]).map(Number)
		: typeof s.CurrentStatus === 'number'
			? [s.CurrentStatus]
			: [];
	const ps = num(info.Status) ?? 0;
	const err = num(info.ErrorNumber) ?? 0;

	let state: PrinterStatus['state'] = 'idle';
	let cancelled: boolean | undefined;
	if (ps === 14 || err > 0) state = 'error';
	else if (ps === 13 || (PREP.has(ps) && cur.includes(1))) state = 'printing';
	else if (ps === 5 || ps === 6) state = 'paused';
	else if (ps === 9) state = 'done';
	else if (ps === 8 || ps === 7) {
		state = 'failed';
		cancelled = true;
	}

	const layer = num(info.CurrentLayer);
	const totalLayers = num(info.TotalLayer);
	let progress = num(info.Progress) ?? null;
	if (progress === null && layer !== undefined && totalLayers)
		progress = (layer / totalLayers) * 100;
	if (state === 'done') progress = 100;
	if (progress !== null) progress = Math.max(0, Math.min(100, Math.round(progress * 10) / 10));

	// FDM firmware reports ticks in seconds; some resin firmware uses milliseconds.
	let cT = num(info.CurrentTicks);
	let tT = num(info.TotalTicks);
	if (tT !== undefined && tT > 1e6) {
		tT /= 1000;
		if (cT !== undefined) cT /= 1000;
	}
	const active = state === 'printing' || state === 'paused';
	const fileName = safeFileName(info.Filename);

	const out: PrinterStatus = {
		state,
		progress: state === 'idle' ? null : progress,
		fileName: state === 'idle' ? undefined : fileName,
		nozzleC: temp(s.TempOfNozzle),
		bedC: temp(s.TempOfHotbed),
		chamberC: temp(s.TempOfBox)
	};
	if (active || state === 'done') {
		out.layer = layer;
		out.totalLayers = totalLayers;
		out.elapsedSec = cT === undefined ? undefined : Math.round(cT);
		out.remainingSec =
			active && cT !== undefined && tT !== undefined ? Math.max(0, Math.round(tT - cT)) : undefined;
	}
	if (cancelled) out.cancelled = true;
	if (state === 'error') out.message = `Printer reported error ${err || ps}`;
	const fil = extractFilaments(s, attributes);
	if (fil.length) out.filaments = fil;
	out.raw = { printStatus: ps, machineStatus: cur };
	return out;
}

const MAX_FILAMENTS = 16;
const MAX_FILAMENT_STR = 32;
const MAINBOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A MainboardID is echoed back to the device in every request we send, so it must look like an id. */
function cleanMainboardId(v: unknown): string {
	return typeof v === 'string' && MAINBOARD_ID_RE.test(v) ? v : '';
}

/**
 * CANVAS slot info. The Centauri Carbon's public SDCP docs do not define a canvas schema, so
 * this reads any `Canvas*` structure that looks like a list of trays (color + type) and
 * otherwise reports nothing.
 */
export function extractFilaments(...sources: (Obj | undefined)[]): PrinterFilament[] {
	const out: PrinterFilament[] = [];
	const visit = (v: unknown, depth: number) => {
		if (depth > 4) return;
		if (Array.isArray(v)) {
			for (const x of v) {
				if (out.length >= MAX_FILAMENTS) return;
				if (isObj(x) && ('filament_color' in x || 'FilamentColor' in x || 'color' in x)) {
					const color = (x.filament_color ?? x.FilamentColor ?? x.color) as unknown;
					const type = (x.filament_type ?? x.FilamentType ?? x.type ?? x.filament_name) as unknown;
					out.push({
						slot: `A${out.length + 1}`,
						color:
							typeof color === 'string'
								? color.replace(/^0x/i, '#').slice(0, MAX_FILAMENT_STR)
								: undefined,
						type: typeof type === 'string' ? type.slice(0, MAX_FILAMENT_STR) : undefined
					});
				} else visit(x, depth + 1);
			}
		} else if (isObj(v)) for (const x of Object.values(v)) visit(x, depth + 1);
	};
	for (const src of sources) {
		if (!src) continue;
		for (const [k, v] of Object.entries(src)) if (/canvas|tray/i.test(k)) visit(v, 0);
	}
	return out;
}

export function connectSdcp(cfg: PrinterConfig): AdapterHandle {
	const subj = new StatusSubject();
	let ws: WebSocket | null = null;
	let attempt = 0;
	let poll: ReturnType<typeof setInterval> | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let stale: ReturnType<typeof setTimeout> | undefined;
	let connectTimer: ReturnType<typeof setTimeout> | undefined;
	let mainboardId = cleanMainboardId(cfg.secrets.mainboardId);
	const hostile = new HostileGuard();
	let attributes: Obj | undefined;
	let lastStatus: Obj | undefined;

	// OctoEverywhere shared link: the printer keeps its one connection to OctoEverywhere and we
	// ride on it (wss, no port, no UDP discovery, no polling). Otherwise the printer's own socket.
	const link = shareLinkOf(cfg.secrets);
	let askedAttributes = false;

	const send = (cmd: 0 | 1) => {
		if (!ws || ws.readyState !== 1 || (link && !mainboardId)) return;
		ws.send(sdcpEnvelope(cmd, {}, mainboardId));
	};

	/**
	 * Close the socket we hold (it hung, or went silent) and retry on the normal backoff, which
	 * through a link is `linkBackoff`. `ws` is cleared first so the close handler ignores it.
	 */
	const dropSocket = (message: string) => {
		const sock = ws;
		ws = null;
		if (sock) {
			sock.onmessage = null;
			try {
				sock.close();
			} catch {
				/* ignore */
			}
		}
		clearInterval(poll);
		clearTimeout(stale);
		clearTimeout(connectTimer);
		if (subj.closed) return;
		subj.emit({ state: 'offline', progress: null, message });
		clearTimeout(retry);
		retry = setTimeout(() => void open(), delay());
	};
	const armStale = () => {
		clearTimeout(stale);
		stale = setTimeout(() => {
			if (!link) return dropSocket('No data from the printer');
			// Link: report it, but keep the socket until the long silence limit.
			subj.emit({ state: 'offline', progress: null, message: 'No data from the printer' });
			stale = setTimeout(
				() => dropSocket('No data from the printer'),
				LINK_SILENT_CLOSE_MS - STALE_MS
			);
		}, STALE_MS);
	};

	// A relay that accepts the upgrade and hangs up must not be re-dialled every few seconds:
	// `attempt` resets only once a valid Status/Attributes frame arrived (see `gotData`).
	const delay = () => (link ? linkBackoff(attempt++) : backoff(attempt++));
	const gotData = () => {
		attempt = 0;
	};

	const scheduleReconnect = () => {
		clearInterval(poll);
		clearTimeout(stale);
		if (subj.closed) return;
		subj.emit({ state: 'offline', progress: null, message: 'Disconnected' });
		clearTimeout(retry);
		retry = setTimeout(() => void open(), delay());
	};

	async function open() {
		if (subj.closed) return;
		let url: string;
		try {
			// Resolved and validated on every (re)connect. LAN: the socket goes to the validated IP.
			// Link: wss to the link host; the name is validated (all answers public) right before
			// the dial, but the global WebSocket cannot pin the address (see architecture notes).
			if (link) {
				await resolveAllowed(link.host, undefined, { allowShareLink: true });
				url = shareLinkSocketUrl(link.origin);
			} else {
				const t = await resolveAllowed(cfg.host);
				url = `ws://${ipForUrl(t.ip)}:${cfg.port ?? 3030}/websocket`;
			}
		} catch (e) {
			if (subj.closed) return;
			subj.emit({ state: 'error', progress: null, message: safeError(e) });
			// A hosted site never retries; a refused address may be fixed by DNS or an edit.
			if (!(e instanceof OutboundError && e.kind === 'public'))
				retry = setTimeout(() => void open(), link ? delay() : backoff(attempt++ + 3));
			return;
		}
		if (subj.closed) return;
		if (!mainboardId && !link) {
			mainboardId = cleanMainboardId(await probeMainboardId(cfg.host));
			if (subj.closed) return;
		}
		try {
			ws = new WebSocket(url);
		} catch (e) {
			subj.emit({ state: 'offline', progress: null, message: safeError(e) });
			retry = setTimeout(() => void open(), delay());
			return;
		}
		const sock = ws;
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
			clearInterval(poll);
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
			armStale();
			askedAttributes = false;
			if (link) return; // OctoEverywhere pushes status by itself; the MainboardID comes with it
			send(1);
			send(0);
			clearInterval(poll);
			poll = setInterval(() => send(0), POLL_MS);
		};
		sock.onmessage = (ev) => {
			// Event-handler throws are uncaught exceptions: nothing remote-driven may escape.
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
			const msg: unknown = JSON.parse(data);
			if (!isObj(msg)) return;
			hostile.good();
			const topic = typeof msg.Topic === 'string' ? msg.Topic : '';
			const id = (msg.MainboardID ??
				(isObj(msg.Data) ? msg.Data.MainboardID : undefined)) as unknown;
			if (!mainboardId) {
				mainboardId = cleanMainboardId(id);
				if (!mainboardId && topic.includes('/'))
					mainboardId = cleanMainboardId(topic.split('/').pop());
			}
			// Through the link the id is known only once the first push arrives: ask for the
			// attributes (Cmd 1, read-only) once, then rely on the pushed status.
			if (link && mainboardId && !askedAttributes) {
				askedAttributes = true;
				send(1);
			}
			if (isObj(msg.Attributes)) {
				attributes = msg.Attributes;
				if (!mainboardId) mainboardId = cleanMainboardId(attributes.MainboardID);
				gotData();
				if (lastStatus) subj.emit(normalizeSdcpStatus(lastStatus, attributes));
				armStale();
			}
			if (isObj(msg.Status)) {
				lastStatus = msg.Status;
				gotData();
				subj.emit(normalizeSdcpStatus(msg.Status, attributes));
				armStale();
			}
		};
		sock.onerror = () => {
			/* close follows */
		};
		sock.onclose = () => {
			clearTimeout(connectTimer);
			if (ws === sock) scheduleReconnect();
		};
	}
	void open();

	return {
		status$: (cb) => subj.subscribe(cb),
		/** Cmd 386 on our own open socket (the printer limits clients); a temporary one otherwise. */
		enableCamera: async () => {
			if (link) return false; // no Cmd 386 through OctoEverywhere
			if (ws && ws.readyState === 1 && mainboardId) {
				try {
					ws.send(cameraOnEnvelope(mainboardId));
					return true;
				} catch {
					return false;
				}
			}
			return enableSdcpCamera(cfg);
		},
		close: () => {
			subj.closed = true;
			clearInterval(poll);
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
