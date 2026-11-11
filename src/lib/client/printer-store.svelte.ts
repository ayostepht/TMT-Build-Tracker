import { buildPrinterJobs, listPrinters } from './api.ts';
import type {
	PrinterExpectedView,
	PrinterJobView,
	PrinterPublic,
	PrinterStatus
} from '#lib/printers/status.ts';

/**
 * Printers and jobs of a team, kept live over the team's SSE stream (`/api/printers/events`).
 * `buildId` set: jobs are the build's (active + awaiting confirmation); otherwise the team's recent jobs.
 */
export class PrinterStore {
	printers = $state<PrinterPublic[]>([]);
	jobs = $state<PrinterJobView[]>([]);
	/** "Start on <printer>" suggestions for this build awaiting the user's confirmation. */
	expected = $state<PrinterExpectedView[]>([]);
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

	private seq = 0;
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private wired = false;

	async load() {
		// Overlapping loads (first load + an SSE-triggered reload) can finish out of order: only the newest counts.
		const my = ++this.seq;
		try {
			if (this.buildId) {
				const r = await buildPrinterJobs(this.buildId);
				if (my !== this.seq) return;
				this.printers = r.printers;
				this.jobs = r.jobs;
				this.expected = r.expected ?? [];
			} else {
				const r = await listPrinters(this.org);
				if (my !== this.seq) return;
				this.printers = r.printers;
				this.jobs = r.jobs;
				this.canEdit = r.canEdit;
				this.autoLogPrints = r.autoLogPrints;
			}
			this.error = null;
		} catch (e) {
			if (my !== this.seq) return;
			this.error = e instanceof Error ? e.message : 'Could not load printers';
		}
		this.loaded = true;
	}

	private resync = () => {
		if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
		void this.load();
	};

	status(id: string): PrinterStatus | null {
		return this.printers.find((p) => p.id === id)?.status ?? null;
	}

	/** Start (ref-counted) loading and listening; returns the release function. */
	acquire(): () => void {
		this.refs++;
		if (this.refs === 1) {
			void this.load();
			this.open();
			// A phone suspends the stream in the background and misses events: refetch when it is back.
			if (typeof document !== 'undefined' && !this.wired) {
				this.wired = true;
				document.addEventListener('visibilitychange', this.resync);
				window.addEventListener('online', this.resync);
				window.addEventListener('focus', this.resync);
				this.pollTimer = setInterval(this.resync, 30_000);
			}
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
		es.onopen = () => {
			// Events sent before the stream was open (the page's first load races it) and on a
			// reconnect are missed: fetch again once it is open.
			this.resync();
		};
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
		clearInterval(this.pollTimer);
		if (this.wired && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.resync);
			window.removeEventListener('online', this.resync);
			window.removeEventListener('focus', this.resync);
		}
		this.wired = false;
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
