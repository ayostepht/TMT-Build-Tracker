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
	/** Team page, editors: builds a job can be linked to. */
	builds = $state<{ id: string; name: string }[]>([]);
	private leave: (() => void) | null = null;
	private refs = 0;
	private reloadTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * `follow` (build pages): where the store points now. The build layout keeps ONE build context
	 * (and so one store) while the user navigates from build to build, so org and build id are read
	 * again on every `acquire()`; called from a component's `$effect` that also re-runs it when the
	 * build changes, so a store never keeps serving the build it was created for (issue #42).
	 */
	constructor(
		public org: string,
		public buildId?: string,
		private follow?: () => { org: string; buildId?: string }
	) {}

	private seq = 0;

	/** Point at the current build/org; drops what was loaded for the previous one. */
	private retarget() {
		if (!this.follow) return;
		const t = this.follow();
		if (t.org === this.org && t.buildId === this.buildId) return;
		const orgChanged = t.org !== this.org;
		this.org = t.org;
		this.buildId = t.buildId;
		this.seq++; // an in-flight load of the old build must not land
		clearTimeout(this.reloadTimer);
		this.printers = [];
		this.jobs = [];
		this.expected = [];
		this.error = null;
		this.loaded = false;
		if (this.refs > 0) {
			// Other consumers are still mounted: keep listening (on the new org's stream if it changed) and fetch now.
			if (orgChanged) {
				this.leave?.();
				this.leave = joinOrgStream(this.org, this);
			}
			void this.load();
		}
	}

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
				this.builds = r.builds ?? [];
				this.expected = r.expected ?? [];
				this.autoLogPrints = r.autoLogPrints;
			}
			this.error = null;
		} catch (e) {
			if (my !== this.seq) return;
			this.error = e instanceof Error ? e.message : 'Could not load printers';
		}
		this.loaded = true;
	}

	/** Refetch (skipped while the tab is hidden); called by the shared org stream. */
	resync = () => {
		if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
		void this.load();
	};

	status(id: string): PrinterStatus | null {
		return this.printers.find((p) => p.id === id)?.status ?? null;
	}

	/** Start (ref-counted) loading and listening; returns the release function. */
	acquire(): () => void {
		this.retarget();
		this.refs++;
		if (this.refs === 1) {
			void this.load();
			this.leave = joinOrgStream(this.org, this);
		}
		return () => {
			this.refs--;
			if (this.refs === 0) {
				clearTimeout(this.reloadTimer);
				this.leave?.();
				this.leave = null;
			}
		};
	}

	/** One event from the org's stream. */
	handle(e: StreamEvent) {
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
	}
}

type StreamEvent = {
	type: string;
	printerId: string;
	status?: PrinterStatus;
	lastSeenAt?: string;
};

/**
 * ONE EventSource per organization, shared by every store that listens to it (a landing page
 * has one store per build plus the nav's): browsers allow about 6 connections per host on
 * HTTP/1.1 and the server caps streams per user. Closed when the last store leaves. Window
 * listeners and the 30 s poll live here too, so N stores do not each add their own.
 */
class OrgStream {
	private es: EventSource | null = null;
	private subs = new Set<PrinterStore>();
	private pollTimer: ReturnType<typeof setInterval> | undefined;
	private wired = false;

	constructor(readonly org: string) {}

	get size() {
		return this.subs.size;
	}

	private resyncAll = () => {
		for (const s of [...this.subs]) s.resync();
	};

	join(store: PrinterStore): () => void {
		this.subs.add(store);
		if (this.subs.size === 1) this.open();
		return () => {
			this.subs.delete(store);
			if (this.subs.size === 0) this.close();
		};
	}

	private open() {
		// A phone suspends the stream in the background and misses events: refetch when it is back.
		if (typeof document !== 'undefined' && !this.wired) {
			this.wired = true;
			document.addEventListener('visibilitychange', this.resyncAll);
			window.addEventListener('online', this.resyncAll);
			window.addEventListener('focus', this.resyncAll);
			this.pollTimer = setInterval(this.resyncAll, 30_000);
		}
		if (typeof EventSource === 'undefined') return;
		const es = new EventSource(`/api/printers/events?org=${encodeURIComponent(this.org)}`);
		this.es = es;
		es.onopen = () => {
			// Events sent before the stream was open (the page's first load races it) and on a
			// reconnect are missed: every store fetches again once it is open.
			this.resyncAll();
		};
		es.onmessage = (m) => {
			try {
				const e = JSON.parse(m.data) as StreamEvent;
				for (const s of [...this.subs]) s.handle(e);
			} catch {
				/* ignore */
			}
		};
	}

	private close() {
		clearInterval(this.pollTimer);
		if (this.wired && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.resyncAll);
			window.removeEventListener('online', this.resyncAll);
			window.removeEventListener('focus', this.resyncAll);
		}
		this.wired = false;
		this.es?.close();
		this.es = null;
		if (streams.get(this.org) === this) streams.delete(this.org);
	}
}

// A plain registry of connections, never read reactively.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const streams = new Map<string, OrgStream>();

function joinOrgStream(org: string, store: PrinterStore): () => void {
	let st = streams.get(org);
	if (!st) {
		st = new OrgStream(org);
		streams.set(org, st);
	}
	return st.join(store);
}

const stores = new WeakMap<object, PrinterStore>();
/** One store per build page (keyed by the build context) so cards share one connection. */
export function printerStoreFor(key: object, org: string, buildId: string): PrinterStore {
	let s = stores.get(key);
	if (!s) {
		// The key is a build context: its view (replaced on navigation) says which build the page shows now.
		const ctx = key as { view?: { build?: { id: string; organizationId: string } } };
		s = new PrinterStore(
			org,
			buildId,
			ctx.view
				? () => ({
						org: ctx.view?.build?.organizationId ?? org,
						buildId: ctx.view?.build?.id ?? buildId
					})
				: undefined
		);
		stores.set(key, s);
	}
	return s;
}
