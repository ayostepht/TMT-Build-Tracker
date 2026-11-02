import { getContext, setContext } from 'svelte';
import type { BuildView, FilamentRole } from '#lib/domain/types.ts';
import { getView } from '#lib/client/api.ts';
import { filamentLabel } from '#lib/domain/labels.ts';

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
	guide = $state<{ slug: string | null } | null>(null);

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

	/** Run a mutation, surface its error, then refresh. Returns true on success. */
	async act(fn: () => Promise<unknown>): Promise<boolean> {
		this.error = null;
		try {
			await fn();
			await this.refresh();
			return true;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'That did not save.';
			await this.refresh();
			return false;
		}
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
