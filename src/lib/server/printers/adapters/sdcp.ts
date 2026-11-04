/**
 * Elegoo SDCP (Smart Device Control Protocol v3) over WebSocket, read-only.
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
import { probeMainboardId } from '../discovery';
import {
	backoff,
	num,
	safeError,
	StatusSubject,
	temp,
	type AdapterHandle,
	type PrinterConfig
} from '../types';

const POLL_MS = 4000;
const STALE_MS = 20000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

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
	const fileName = typeof info.Filename === 'string' && info.Filename ? info.Filename : undefined;

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
				if (isObj(x) && ('filament_color' in x || 'FilamentColor' in x || 'color' in x)) {
					const color = (x.filament_color ?? x.FilamentColor ?? x.color) as unknown;
					const type = (x.filament_type ?? x.FilamentType ?? x.type ?? x.filament_name) as unknown;
					out.push({
						slot: `A${out.length + 1}`,
						color: typeof color === 'string' ? color.replace(/^0x/i, '#') : undefined,
						type: typeof type === 'string' ? type : undefined
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
	let mainboardId = cfg.secrets.mainboardId || '';
	let attributes: Obj | undefined;
	let lastStatus: Obj | undefined;

	const url = `ws://${cfg.host}:${cfg.port ?? 3030}/websocket`;

	const send = (cmd: 0 | 1) => {
		if (!ws || ws.readyState !== 1) return;
		const body = {
			Id: mainboardId,
			Topic: `sdcp/request/${mainboardId}`,
			Data: {
				Cmd: cmd,
				Data: {},
				RequestID: randomBytes(8).toString('hex'),
				MainboardID: mainboardId,
				TimeStamp: Date.now(),
				From: 1
			}
		};
		ws.send(JSON.stringify(body));
	};

	const armStale = () => {
		clearTimeout(stale);
		stale = setTimeout(() => {
			subj.emit({ state: 'offline', progress: null, message: 'No data from the printer' });
		}, STALE_MS);
	};

	const scheduleReconnect = () => {
		clearInterval(poll);
		clearTimeout(stale);
		if (subj.closed) return;
		subj.emit({ state: 'offline', progress: null, message: 'Disconnected' });
		clearTimeout(retry);
		retry = setTimeout(() => void open(), backoff(attempt++));
	};

	async function open() {
		if (subj.closed) return;
		if (!mainboardId) {
			mainboardId = (await probeMainboardId(cfg.host)) ?? '';
			if (subj.closed) return;
		}
		try {
			ws = new WebSocket(url);
		} catch (e) {
			subj.emit({ state: 'offline', progress: null, message: safeError(e) });
			retry = setTimeout(() => void open(), backoff(attempt++));
			return;
		}
		const sock = ws;
		sock.onopen = () => {
			attempt = 0;
			armStale();
			send(1);
			send(0);
			clearInterval(poll);
			poll = setInterval(() => send(0), POLL_MS);
		};
		sock.onmessage = (ev) => {
			let msg: unknown;
			try {
				msg = JSON.parse(String(ev.data));
			} catch {
				return;
			}
			if (!isObj(msg)) return;
			const topic = typeof msg.Topic === 'string' ? msg.Topic : '';
			const id = (msg.MainboardID ??
				(isObj(msg.Data) ? msg.Data.MainboardID : undefined)) as unknown;
			if (!mainboardId) {
				if (typeof id === 'string' && id) mainboardId = id;
				else if (topic.includes('/')) mainboardId = topic.split('/').pop() ?? '';
			}
			if (isObj(msg.Attributes)) {
				attributes = msg.Attributes;
				if (!mainboardId && typeof attributes.MainboardID === 'string')
					mainboardId = attributes.MainboardID;
				if (lastStatus) subj.emit(normalizeSdcpStatus(lastStatus, attributes));
				armStale();
			}
			if (isObj(msg.Status)) {
				lastStatus = msg.Status;
				subj.emit(normalizeSdcpStatus(msg.Status, attributes));
				armStale();
			}
		};
		sock.onerror = () => {
			/* close follows */
		};
		sock.onclose = () => {
			if (ws === sock) scheduleReconnect();
		};
	}
	void open();

	return {
		status$: (cb) => subj.subscribe(cb),
		close: () => {
			subj.closed = true;
			clearInterval(poll);
			clearTimeout(retry);
			clearTimeout(stale);
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
