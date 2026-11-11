<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { nowPrinting } from '#lib/domain/index.ts';
	import type { BuildView } from '#lib/domain/types.ts';
	import { BuildCtx } from '../build-context.svelte.ts';
	import GuideViewer from '../GuideViewer.svelte';
	import NowCard from '../NowCard.svelte';
	import CtxScope from './CtxScope.svelte';
	import NextUpCard from './NextUpCard.svelte';
	import { nextUpPlate } from './next-up.ts';

	/**
	 * The landing's "Now printing" and "Next up" across the builds it was given. One `BuildCtx` per
	 * build (the same class the build layout uses) is shared by both sections. The server caps how
	 * many builds it hands us (LANDING_BUILD_CAP) because each build is polled and fetches its
	 * printer jobs; all builds of a chapter share one printer stream. Build state itself is polled,
	 * not streamed (see below).
	 */
	let { views, more = 0 }: { views: BuildView[]; more?: number } = $props();

	// A plain lookup of contexts, never read reactively.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const cache = new Map<string, BuildCtx>();
	function sync(vs: BuildView[]): BuildCtx[] {
		const keep = new Set(vs.map((v) => v.build.id));
		for (const id of [...cache.keys()]) if (!keep.has(id)) cache.delete(id);
		return vs.map((v) => {
			let c = cache.get(v.build.id);
			if (!c) {
				c = new BuildCtx(v);
				cache.set(v.build.id, c);
			} else if (c.view !== v) c.view = v;
			return c;
		});
	}
	let ctxs = $state.raw<BuildCtx[]>(sync(untrack(() => views)));
	let lastViews = untrack(() => views);
	$effect.pre(() => {
		const v = views;
		if (v === lastViews) return;
		lastViews = v;
		ctxs = sync(v);
	});

	// No build streams here: a browser keeps at most 6 connections per host over HTTP/1.1, and every
	// open stream takes one (the printer stream is shared by the nav and all cards), so more
	// would crowd page loads. Instead each build is re-fetched every 20 s while the page is
	// visible, and when the phone wakes or the tab regains focus. Your own actions refresh at once.
	$effect(() => {
		let last = 0;
		const refreshAll = (minGap: number) => {
			if (document.visibilityState === 'hidden') return;
			const t = Date.now();
			if (t - last < minGap) return;
			last = t;
			for (const c of ctxs) void c.refresh();
		};
		const onWake = () => refreshAll(2000);
		const timer = setInterval(() => refreshAll(15000), 20000);
		document.addEventListener('visibilitychange', onWake);
		window.addEventListener('online', onWake);
		window.addEventListener('focus', onWake);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onWake);
			window.removeEventListener('online', onWake);
			window.removeEventListener('focus', onWake);
		};
	});
	// 30 s tick so elapsed / remaining timers move.
	$effect(() => {
		const t = setInterval(() => {
			const now = Date.now();
			for (const c of ctxs) c.now = now;
		}, 30000);
		return () => clearInterval(t);
	});

	const nowCount = $derived(ctxs.reduce((n, c) => n + nowPrinting(c.view).length, 0));
	const nextCount = $derived(ctxs.filter((c) => nextUpPlate(c.view)).length);
</script>

<div class="lb-root">
	<section class="lb" aria-labelledby="lb-now" data-testid="landing-now">
		<h2 id="lb-now">Now printing</h2>
		{#if nowCount}
			<div class="lb-cards">
				{#each ctxs as c (c.id)}
					<CtxScope ctx={c}>
						{#each nowPrinting(c.view) as item (item.plate)}
							<div class="lb-one" data-testid="landing-now-card">
								<a
									class="pill-link lb-open"
									href={resolve('/(app)/builds/[id]', { id: c.id })}
									data-testid="landing-open-build"
									title={c.view.build.name}
									><span class="lb-open-name">{c.view.build.name}</span>
									<span class="btn-arrow" aria-hidden="true">→</span></a
								>
								<NowCard {item} compact />
							</div>
						{/each}
						{#if c.guide}<GuideViewer />{/if}
					</CtxScope>
				{/each}
			</div>
		{:else}
			<p class="muted lb-empty">Nothing on a printer right now.</p>
		{/if}
	</section>

	{#if nextCount}
		<section class="lb" aria-labelledby="lb-next" data-testid="landing-next">
			<h2 id="lb-next">Next up</h2>
			<div class="lb-cards">
				{#each ctxs as c (c.id)}
					{@const plate = nextUpPlate(c.view)}
					{#if plate}
						<CtxScope ctx={c}><NextUpCard {plate} /></CtxScope>
					{/if}
				{/each}
			</div>
		</section>
	{/if}
	{#if more > 0}
		<p class="muted" data-testid="landing-more">
			Showing the {ctxs.length} most active builds.
			<a href={resolve('/(app)/builds')}>All builds</a>
		</p>
	{/if}
</div>

<style>
	.lb-root {
		display: grid;
		gap: 28px;
		margin-top: 16px;
	}
	.lb {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 10px;
	}
	.lb h2 {
		margin: 0;
	}
	.lb-cards {
		display: grid;
		min-width: 0;
		grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
		gap: 12px;
		align-items: start;
	}
	.lb-one {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 6px;
		min-width: 0;
	}
	.lb-open {
		justify-self: start;
		max-width: 100%;
		min-height: 44px;
		padding-inline: 16px;
		font-weight: 600;
	}
	.lb-open-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lb-empty {
		margin: 0;
	}
</style>
