import { isObj, type Obj } from '#lib/domain/guards.ts';
/** OctoPrint over REST polling (`/api/job`, `/api/printer`) with an X-Api-Key. Read-only. */
import type { PrinterStatus } from '#lib/printers/status.ts';
import { cleanHost } from '#lib/printers/address.ts';
import {
	guardedFetch,
	ipForUrl,
	OutboundError,
	isRedirect,
	readJsonCapped,
	REDIRECT_MESSAGE,
	safeFileName,
	safeText
} from '../outbound';
import { num, safeError, StatusSubject, type AdapterHandle, type PrinterConfig } from '../types';

export function normalizeOctoprint(job: Obj, printer: Obj | null): PrinterStatus {
	const stateText = typeof job.state === 'string' ? job.state : '';
	const flags =
		isObj(printer?.state) && isObj((printer!.state as Obj).flags)
			? ((printer!.state as Obj).flags as Obj)
			: {};
	const prog = isObj(job.progress) ? job.progress : {};
	const file = isObj(job.job) && isObj((job.job as Obj).file) ? ((job.job as Obj).file as Obj) : {};
	const name = safeFileName(file.name);
	const completion = num(prog.completion);
	const t = isObj(printer?.temperature) ? (printer!.temperature as Obj) : {};
	const actual = (k: string) => (isObj(t[k]) ? num((t[k] as Obj).actual) : undefined);

	let state: PrinterStatus['state'] = 'idle';
	if (flags.error || /error/i.test(stateText)) state = 'error';
	else if (flags.paused || /^paus/i.test(stateText)) state = 'paused';
	else if (flags.printing || /^(printing|starting|cancelling|finishing)/i.test(stateText))
		state = 'printing';
	else if (/offline|closed/i.test(stateText)) state = 'offline';
	else if (name && completion !== undefined && completion >= 99.9) state = 'done';

	const out: PrinterStatus = {
		state,
		progress:
			state === 'idle' || state === 'offline'
				? null
				: completion === undefined
					? null
					: Math.round(completion * 10) / 10,
		fileName: state === 'idle' || state === 'offline' ? undefined : name,
		nozzleC: actual('tool0'),
		bedC: actual('bed'),
		chamberC: actual('chamber')
	};
	if (state === 'printing' || state === 'paused' || state === 'done') {
		out.elapsedSec = num(prog.printTime);
		const left = num(prog.printTimeLeft);
		if (state !== 'done' && left !== undefined) out.remainingSec = left;
	}
	if (state === 'error') out.message = safeText(stateText, 80) || 'OctoPrint error';
	return out;
}

export function connectOctoprint(cfg: PrinterConfig): AdapterHandle {
	const subj = new StatusSubject();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const base = `http://${ipForUrl(cleanHost(cfg.host))}:${cfg.port ?? 80}`; // guardedFetch validates and pins
	const headers = { 'X-Api-Key': cfg.secrets.apiKey ?? '' };

	async function tick() {
		let delay = 3000;
		try {
			const jr = await guardedFetch(`${base}/api/job`, {
				headers,
				signal: AbortSignal.timeout(5000)
			});
			if (isRedirect(jr.status)) {
				subj.emit({ state: 'error', progress: null, message: REDIRECT_MESSAGE });
				delay = 15000;
			} else if (jr.status === 401 || jr.status === 403) {
				subj.emit({ state: 'error', progress: null, message: 'OctoPrint rejected the API key' });
				delay = 15000;
			} else if (!jr.ok) {
				subj.emit({ state: 'offline', progress: null, message: `OctoPrint answered ${jr.status}` });
				delay = 10000;
			} else {
				const job = (await readJsonCapped(jr)) as Obj;
				let printer: Obj | null = null;
				try {
					const pr = await guardedFetch(`${base}/api/printer`, {
						headers,
						signal: AbortSignal.timeout(5000)
					});
					if (pr.ok) printer = (await readJsonCapped(pr)) as Obj; // 409 when the printer is not connected
				} catch {
					/* temperatures are optional */
				}
				const s = normalizeOctoprint(job, printer);
				subj.emit(s);
				if (s.state === 'idle' || s.state === 'offline') delay = 8000;
			}
		} catch (e) {
			subj.emit({
				state: e instanceof OutboundError ? 'error' : 'offline',
				progress: null,
				message: safeError(e)
			});
			delay = e instanceof OutboundError && e.kind === 'public' ? 600000 : 10000;
		}
		if (!subj.closed) timer = setTimeout(() => void tick(), delay);
	}
	void tick();

	return {
		status$: (cb) => subj.subscribe(cb),
		close: () => {
			subj.closed = true;
			clearTimeout(timer);
		}
	};
}
