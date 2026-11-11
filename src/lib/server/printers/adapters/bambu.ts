/**
 * Bambu Lab LAN mode: MQTT over TLS on 8883, user `bblp`, password = LAN access code, topic
 * `device/<serial>/report`. The only message we publish is the `pushall` info request that
 * asks the printer to resend its full state; no print or control commands, ever.
 * Printers use a self-signed certificate, so certificate verification is off for this
 * connection only (the scope of the `rejectUnauthorized` option below).
 */
import mqtt, { type MqttClient } from 'mqtt';
import type { PrinterFilament, PrinterStatus } from '#lib/printers/status.ts';
import { ipForUrl, OutboundError, resolveAllowed } from '../outbound';
import {
	backoff,
	num,
	safeError,
	StatusSubject,
	type AdapterHandle,
	type PrinterConfig
} from '../types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizeBambu(p: Obj): PrinterStatus {
	const g = typeof p.gcode_state === 'string' ? p.gcode_state.toUpperCase() : '';
	const state: PrinterStatus['state'] =
		g === 'RUNNING' || g === 'PREPARE' || g === 'SLICING'
			? 'printing'
			: g === 'PAUSE'
				? 'paused'
				: g === 'FINISH'
					? 'done'
					: g === 'FAILED'
						? 'failed'
						: 'idle';
	const file =
		(typeof p.subtask_name === 'string' && p.subtask_name) ||
		(typeof p.gcode_file === 'string' && p.gcode_file) ||
		undefined;
	const pct = num(p.mc_percent);
	const remainMin = num(p.mc_remaining_time);
	const filaments: PrinterFilament[] = [];
	const ams = isObj(p.ams) && Array.isArray(p.ams.ams) ? (p.ams.ams as unknown[]) : [];
	for (const unit of ams) {
		if (!isObj(unit) || !Array.isArray(unit.tray)) continue;
		for (const t of unit.tray as unknown[]) {
			if (!isObj(t)) continue;
			const color =
				typeof t.tray_color === 'string' && t.tray_color
					? `#${t.tray_color.slice(0, 6)}`
					: undefined;
			filaments.push({
				slot: `${String.fromCharCode(65 + (Number(unit.id) || 0))}${(Number(t.id) || 0) + 1}`,
				color,
				type: typeof t.tray_type === 'string' && t.tray_type ? t.tray_type : undefined
			});
		}
	}
	const out: PrinterStatus = {
		state,
		progress: state === 'idle' ? null : state === 'done' ? 100 : (pct ?? null),
		fileName: state === 'idle' ? undefined : file,
		nozzleC: num(p.nozzle_temper),
		bedC: num(p.bed_temper),
		chamberC: num(p.chamber_temper)
	};
	if (state !== 'idle') {
		out.layer = num(p.layer_num);
		out.totalLayers = num(p.total_layer_num);
		if (remainMin !== undefined && state !== 'done') out.remainingSec = remainMin * 60;
	}
	if (state === 'failed') out.message = 'Print failed';
	if (filaments.length) out.filaments = filaments;
	return out;
}

/** Factory hook so tests can supply a fake client instead of a real broker. */
export type MqttFactory = (url: string, opts: mqtt.IClientOptions) => MqttClient;
let factory: MqttFactory = (url, opts) => mqtt.connect(url, opts);
export function setMqttFactory(f: MqttFactory | null) {
	factory = f ?? ((url, opts) => mqtt.connect(url, opts));
}

export function connectBambu(cfg: PrinterConfig): AdapterHandle {
	const subj = new StatusSubject();
	const serial = cfg.secrets.serial ?? '';
	const acc: Obj = {};
	if (!serial || !cfg.secrets.accessCode) {
		subj.emit({
			state: 'error',
			progress: null,
			message: 'Serial number and access code are required'
		});
		return { status$: (cb) => subj.subscribe(cb), close: () => (subj.closed = true) };
	}
	const report = `device/${serial}/report`;
	let client: MqttClient | null = null;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let attempt = 0;

	const later = (extra = 0) => {
		clearTimeout(retry);
		if (!subj.closed) retry = setTimeout(() => void start(), backoff(attempt++ + extra, 5000));
	};

	/** Resolve and validate on every (re)connect, then dial the validated IP (TLS name kept as SNI). */
	async function start() {
		if (subj.closed) return;
		let t;
		try {
			t = await resolveAllowed(cfg.host);
		} catch (e) {
			if (subj.closed) return;
			subj.emit({ state: 'error', progress: null, message: safeError(e) });
			if (!(e instanceof OutboundError && e.kind === 'public')) later(2);
			return;
		}
		if (subj.closed) return;
		const c = factory(`mqtts://${ipForUrl(t.ip)}:${cfg.port ?? 8883}`, {
			username: 'bblp',
			password: cfg.secrets.accessCode,
			clientId: `tmt-${Math.random().toString(16).slice(2, 10)}`,
			rejectUnauthorized: false,
			...(t.literal ? {} : { servername: t.host }),
			reconnectPeriod: 0, // reconnects go through start(): fresh resolve + validation
			connectTimeout: 8000,
			protocolVersion: 4
		});
		client = c;
		c.on('connect', () => {
			attempt = 0;
			c.subscribe(report, (err) => {
				if (err) return;
				// Info request only: asks the printer to resend its full state.
				c.publish(
					`device/${serial}/request`,
					JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } })
				);
			});
		});
		c.on('message', (_topic, payload) => {
			try {
				const j = JSON.parse(payload.toString()) as Obj;
				if (isObj(j.print)) {
					Object.assign(acc, j.print);
					subj.emit(normalizeBambu(acc));
				}
			} catch {
				/* ignore */
			}
		});
		c.on('error', (e) => {
			subj.emit({ state: 'offline', progress: null, message: safeError(e) });
		});
		c.on('close', () => {
			if (subj.closed || client !== c) return;
			subj.emit({ state: 'offline', progress: null, message: 'Disconnected' });
			try {
				c.end(true);
			} catch {
				/* ignore */
			}
			client = null;
			later();
		});
	}
	void start();
	return {
		status$: (cb) => subj.subscribe(cb),
		close: () => {
			subj.closed = true;
			clearTimeout(retry);
			client?.end(true);
		}
	};
}
