import { buildPrinterJobs, listPrinters } from './api.ts';
import type { PrinterJobView, PrinterPublic, PrinterStatus } from '#lib/printers/status.ts';

/**
 * Printers and jobs of a team, kept live over the team's SSE stream (`/api/printers/events`).
 * `buildId` set: jobs are the build's (active + awaiting confirmation); otherwise the team's recent jobs.
 */
export class PrinterStore {
	printers = $state<PrinterPublic[]>([]);
	jobs = $state<PrinterJobView[]>([]);
	loaded = $state(false);
	error = $state<string | null>(null);
	canEdit = $state(false);
	autoLogPrints = $state(false);
	private es: EventSource | null = null;
	private refs = 0;
	private reloadTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		readonly org: string,
		readonly buildId?: string
	) {}

	async load() {
		try {
			if (this.buildId) {
				const r = await buildPrinterJobs(this.buildId);
				this.printers = r.printers;
				this.jobs = r.jobs;
			} else {
				const r = await listPrinters(this.org);
				this.printers = r.printers;
				this.jobs = r.jobs;
				this.canEdit = r.canEdit;
				this.autoLogPrints = r.autoLogPrints;
			}
			this.error = null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not load printers';
		}
		this.loaded = true;
	}

	status(id: string): PrinterStatus | null {
		return this.printers.find((p) => p.id === id)?.status ?? null;
	}

	/** Start (ref-counted) loading and listening; returns the release function. */
	acquire(): () => void {
		this.refs++;
		if (this.refs === 1) {
			void this.load();
			this.open();
		}
		return () => {
			this.refs--;
			if (this.refs === 0) this.close();
		};
	}

	private open() {
		if (typeof EventSource === 'undefined') return;
		const es = new EventSource(`/api/printers/events?org=${encodeURIComponent(this.org)}`);
		this.es = es;
		es.onmessage = (m) => {
			try {
				const e = JSON.parse(m.data) as {
					type: string;
					printerId: string;
					status?: PrinterStatus;
					lastSeenAt?: string;
				};
				if (e.type === 'status' && e.status) {
					const p = this.printers.find((x) => x.id === e.printerId);
					if (p) {
						p.status = e.status;
						if (e.lastSeenAt) p.lastSeenAt = e.lastSeenAt;
					}
				} else {
					clearTimeout(this.reloadTimer);
					this.reloadTimer = setTimeout(() => void this.load(), 300);
				}
			} catch {
				/* ignore */
			}
		};
	}

	private close() {
		clearTimeout(this.reloadTimer);
		this.es?.close();
		this.es = null;
	}
}

const stores = new WeakMap<object, PrinterStore>();
/** One store per build page (keyed by the build context) so cards share one connection. */
export function printerStoreFor(key: object, org: string, buildId: string): PrinterStore {
	let s = stores.get(key);
	if (!s) {
		s = new PrinterStore(org, buildId);
		stores.set(key, s);
	}
	return s;
}
