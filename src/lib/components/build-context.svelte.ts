import { getContext, setContext } from 'svelte';
import { SvelteDate } from 'svelte/reactivity';
import type { BuildView, FilamentRole, PartPatch, PartStatus } from '#lib/domain/types.ts';
import { getView, printing, setPartStatus as apiSetPartStatus } from '#lib/client/api.ts';
import { applyPatches, setStatus, startPrinting, stopPrinting } from '#lib/domain/actions.ts';
import { snapshotParts, type PartSnapshot } from '#lib/domain/logrun.ts';
import { filamentLabel } from '#lib/domain/labels.ts';
import { toasts } from './toast.svelte.ts';

/** How long the Undo toast for a build action stays (ms). Long enough to notice a slip. */
export const UNDO_MS = 15000;

export type SyncState = 'connecting' | 'on' | 'off';

const KEY = Symbol('build-ctx');

/**
 * Client-side holder for the build the page is showing. The build layout creates one,
 * child pages read it. Every mutation goes through `act`, which refreshes the view
 * afterwards; the SSE subscription calls `refresh` too.
 */
export class BuildCtx {
	view = $state<BuildView>() as BuildView;
	sync = $state<SyncState>('connecting');
	error = $state<string | null>(null);
	/** ms timestamp, ticked every 30 s so elapsed/remaining timers move. */
	now = $state(Date.now());
	/** Guide viewer: null = closed; slug null = whole guide. */
	guide = $state<{ slug: string | null; page?: number } | null>(null);

	/** A sliced project handed over by the kit drop zone; the plates panel picks it up and opens its upload. */
	slicedFile = $state<File | null>(null);

	constructor(view: BuildView) {
		this.view = view;
	}

	get id() {
		return this.view.build.id;
	}
	get canEdit() {
		return this.view.canEdit;
	}

	filament(role: string): FilamentRole | undefined {
		return this.view.filaments.find((f) => f.key === role);
	}

	async refresh() {
		try {
			this.view = await getView(this.id);
		} catch {
			/* keep the last good copy; the sync dot shows connection trouble */
		}
	}

	/**
	 * Run a mutation, surface its error, then refresh. Returns true on success.
	 *
	 * `opts.patches` makes it optimistic: the part state is updated at once with patches the pure
	 * domain rules predicted (`#lib/domain/actions.ts`), the server call follows, and a failure puts
	 * the touched parts back before showing the server's sentence. The server stays the authority:
	 * the re-fetched view always replaces the optimistic one.
	 */
	async act(fn: () => Promise<unknown>, opts: { patches?: PartPatch[] } = {}): Promise<boolean> {
		this.error = null;
		const rollback = opts.patches?.length ? this.#applyOptimistic(opts.patches) : null;
		try {
			await fn();
			await this.refresh();
			return true;
		} catch (e) {
			rollback?.();
			this.error = e instanceof Error ? e.message : 'That did not save.';
			await this.refresh();
			return false;
		}
	}

	#applyOptimistic(patches: PartPatch[]): () => void {
		const before = Object.fromEntries(
			patches.filter((p) => this.view.state[p.slug]).map((p) => [p.slug, this.view.state[p.slug]])
		);
		this.view = applyPatches(this.view, patches);
		return () => {
			this.view = { ...this.view, state: { ...this.view.state, ...before } };
		};
	}

	#nameOf(slugs: string[]): string {
		const n = slugs.map((s) => this.view.parts.find((p) => p.slug === s)?.name ?? s);
		return n.length > 2 ? `${n.length} parts` : n.join(' + ');
	}

	/** Offer Undo for a status change: puts the parts back as `before` (status, start time, estimate). */
	#offerUndo(text: string, before: PartSnapshot[]) {
		toasts.push(
			text,
			{
				label: 'Undo',
				run: async () => {
					if (await this.restoreParts(before)) toasts.push('Undone', undefined, 4000);
				}
			},
			UNDO_MS
		);
	}

	/** Put parts back to a snapshot taken before a status change. Optimistic, like the change itself. */
	restoreParts(before: PartSnapshot[]): Promise<boolean> {
		const patches: PartPatch[] = before.map((s) => ({
			slug: s.slug,
			status: s.status,
			startedAt: s.startedAt,
			printedOn: s.printedOn,
			runEstSeconds: s.runEstSeconds
		}));
		return this.act(
			async () => {
				for (const s of before) {
					await apiSetPartStatus(this.id, s.slug, s.status);
					if (s.status === 'Printing') {
						if (s.startedAt)
							await printing(this.id, { action: 'setStart', slugs: [s.slug], when: s.startedAt });
						if (s.runEstSeconds)
							await printing(this.id, {
								action: 'setEstimate',
								slugs: [s.slug],
								seconds: s.runEstSeconds
							});
					}
				}
			},
			{ patches }
		);
	}

	/** Set one part's status (the per-part control): optimistic, with an Undo toast. */
	async setPartStatus(slug: string, status: PartStatus): Promise<boolean> {
		const patches = setStatus(this.view, slug, status, new SvelteDate());
		if (!patches.length) return true;
		const before = snapshotParts(this.view, [slug]);
		const name = this.#nameOf([slug]);
		const ok = await this.act(() => apiSetPartStatus(this.id, slug, status), { patches });
		if (ok) this.#offerUndo(`${name} · ${status}`, before);
		return ok;
	}

	/** "Start printing": mark these parts Printing (optimistic, Undo toast). */
	async startParts(slugs: string[], label = this.#nameOf(slugs)): Promise<boolean> {
		const patches = startPrinting(this.view, slugs, new SvelteDate());
		if (!patches.length) return true;
		const before = snapshotParts(this.view, slugs);
		const ok = await this.act(() => printing(this.id, { action: 'start', slugs }), { patches });
		if (ok) this.#offerUndo(`Started ${label}`, before);
		return ok;
	}

	/** "Take off printer": the parts stop printing without a log (optimistic, Undo toast). */
	async takeOffParts(slugs: string[], label = this.#nameOf(slugs)): Promise<boolean> {
		const patches = stopPrinting(this.view, slugs);
		if (!patches.length) return true;
		const before = snapshotParts(this.view, slugs);
		const ok = await this.act(() => printing(this.id, { action: 'stop', slugs }), { patches });
		if (ok) this.#offerUndo(`Took ${label} off the printer`, before);
		return ok;
	}

	/** Open the whole guide at one of our guide page numbers. */
	openGuidePage(page: number) {
		this.guide = { slug: null, page };
	}

	openGuide(slug: string | null) {
		this.guide = { slug };
	}
}

export function setBuildCtx(ctx: BuildCtx) {
	setContext(KEY, ctx);
}
export function getBuildCtx(): BuildCtx {
	return getContext<BuildCtx>(KEY);
}

/** Short label for a filament role, e.g. "PETG Overture Blue". */
export function filLabel(f: FilamentRole | undefined, role = ''): string {
	return filamentLabel(f, role);
}

export function ago(iso: string, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	return d === 1 ? 'yesterday' : `${d} days ago`;
}
