<script lang="ts">
	import { tick } from 'svelte';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import { guidePageImageUrl } from '#lib/client/api.ts';
	import { MAKEGOOD_GUIDE_URL } from '#lib/makegood.ts';

	const ctx = getBuildCtx();
	let index = $state(0);
	let closeBtn = $state<HTMLButtonElement>();
	let lastFocus: Element | null = null;

	const slug = $derived(ctx.guide?.slug ?? null);
	const part = $derived(slug ? ctx.view.parts.find((p) => p.slug === slug) : undefined);
	const tabs = $derived.by(() => {
		const titles = new Map(ctx.view.guidePages.map((g) => [g.page, g]));
		if (part) {
			return part.guideRefs.map((r) => ({
				page: r.page,
				note: r.text,
				title: titles.get(r.page)?.title ?? `Page ${r.page}`,
				hasImage: !!titles.get(r.page)?.hasImage
			}));
		}
		return [...ctx.view.guidePages]
			.sort((a, b) => a.sort - b.sort)
			.map((g) => ({ page: g.page, note: g.title, title: g.title, hasImage: g.hasImage }));
	});
	const tab = $derived(tabs[Math.min(index, Math.max(0, tabs.length - 1))]);

	let zoom = $state(1);
	let scroller = $state<HTMLDivElement>();
	let drag: { x: number; y: number; left: number; top: number } | null = null;
	const ZOOMS = [1, 1.5, 2, 3, 4];
	const imgSrc = $derived(
		tab?.hasImage ? guidePageImageUrl(ctx.view.build.templateId, tab.page) : null
	);
	// Keep the selected tab visible in the scrolling tab strip.
	$effect(() => {
		void index;
		if (!ctx.guide) return;
		tick().then(() =>
			document
				.querySelector('.vtab[aria-selected="true"]')
				?.scrollIntoView({ inline: 'center', block: 'nearest' })
		);
	});
	// A new page starts fitted.
	$effect(() => {
		void tab?.page;
		zoom = 1;
		if (scroller) scroller.scrollTo(0, 0);
	});
	function zoomBy(dir: 1 | -1) {
		const i = ZOOMS.findIndex((z) => z >= zoom - 0.01);
		zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir))];
	}
	function pointerdown(e: PointerEvent) {
		if (e.pointerType !== 'mouse' || zoom <= 1 || !scroller) return;
		drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
		scroller.setPointerCapture(e.pointerId);
	}
	function pointermove(e: PointerEvent) {
		if (!drag || !scroller) return;
		scroller.scrollLeft = drag.left - (e.clientX - drag.x);
		scroller.scrollTop = drag.top - (e.clientY - drag.y);
	}
	function pointerup() {
		drag = null;
	}

	$effect(() => {
		if (ctx.guide) {
			const want = ctx.guide.page;
			const at = want === undefined ? -1 : tabs.findIndex((t) => t.page === want);
			index = at >= 0 ? at : 0;
			lastFocus = document.activeElement;
			tick().then(() => closeBtn?.focus());
		}
	});

	function close() {
		ctx.guide = null;
		if (lastFocus instanceof HTMLElement) lastFocus.focus();
	}
	function onkeydown(e: KeyboardEvent) {
		if (!ctx.guide) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft' && index > 0) index--;
		else if (e.key === 'ArrowRight' && index < tabs.length - 1) index++;
	}
</script>

<svelte:window {onkeydown} />

{#if ctx.guide}
	<div class="viewer" onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
		<div class="vbox" role="dialog" aria-modal="true" aria-labelledby="vTitle">
			<div class="vhead">
				<h2 id="vTitle">
					{part ? part.name : 'Build guide'}
					<span class="sub"
						>{part
							? `${filLabel(ctx.filament(part.role), part.role)} · ${part.sourceFile}`
							: ctx.view.build.templateName}</span
					>
				</h2>
				<button
					class="vclose"
					type="button"
					aria-label="Close guide"
					bind:this={closeBtn}
					onclick={close}>×</button
				>
			</div>
			<div class="vtabs" role="tablist" aria-label="Guide pages">
				{#each tabs as t, n (t.page)}
					<button
						class="vtab"
						type="button"
						role="tab"
						aria-selected={n === index}
						onclick={() => (index = n)}>p{t.page} · {t.title.replace(/:.*/, '')}</button
					>
				{/each}
			</div>
			{#if imgSrc && tab}
				<div class="vzoom">
					<div class="zbar" role="group" aria-label="Zoom">
						<button
							type="button"
							class="vnav"
							aria-label="Zoom out"
							disabled={zoom <= 1}
							onclick={() => zoomBy(-1)}>−</button
						>
						<span class="zlevel">{Math.round(zoom * 100)}%</span>
						<button
							type="button"
							class="vnav"
							aria-label="Zoom in"
							disabled={zoom >= 4}
							onclick={() => zoomBy(1)}>+</button
						>
						<button type="button" class="vnav" disabled={zoom === 1} onclick={() => (zoom = 1)}
							>Fit</button
						>
						<span class="zhint">Double-tap to zoom, drag or swipe to move</span>
					</div>
					<div
						class="zoomwrap"
						bind:this={scroller}
						onpointerdown={pointerdown}
						onpointermove={pointermove}
						onpointerup={pointerup}
						onpointercancel={pointerup}
						ondblclick={() => (zoom = zoom > 1 ? 1 : 2)}
						role="presentation"
					>
						<img
							src={imgSrc}
							alt="Guide page {tab.page}: {tab.title}"
							style="width:{zoom * 100}%"
							draggable="false"
						/>
					</div>
				</div>
			{:else}
				<div class="vimg">
					{#if tab}
						<h3>Page {tab.page}: {tab.title}</h3>
						<p class="muted">{tab.note}</p>
					{:else}
						<p class="muted">No guide pages for this {part ? 'part' : 'template'}.</p>
					{/if}
					<p class="muted" data-testid="guide-makegood">
						MakeGood maker guide, page {tab?.page ?? ''}.
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a href={MAKEGOOD_GUIDE_URL} target="_blank" rel="noopener noreferrer"
							>Open MakeGood's guide</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</p>
				</div>
			{/if}
			<div class="vfoot">
				<button class="vnav" type="button" disabled={index === 0} onclick={() => index--}
					>‹ Prev</button
				>
				<span class="cap">{tab?.note ?? ''}</span>
				<button
					class="vnav"
					type="button"
					disabled={index >= tabs.length - 1}
					onclick={() => index++}>Next ›</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.vzoom {
		display: grid;
		grid-template-rows: auto 1fr;
		min-height: 0;
	}
	.zbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-bottom: 1px solid var(--line);
		flex-wrap: wrap;
	}
	.zlevel {
		min-width: 3.2em;
		text-align: center;
		font: 500 13px var(--f-mono);
	}
	.zhint {
		font-size: 12px;
		color: var(--muted);
		margin-left: auto;
	}
	.zoomwrap {
		overflow: auto;
		min-height: 0;
		background: #fff;
		touch-action: pan-x pan-y pinch-zoom;
		overscroll-behavior: contain;
		cursor: grab;
	}
	.zoomwrap img {
		display: block;
		max-width: none;
		height: auto;
		user-select: none;
	}
	@media (max-width: 600px) {
		.zhint {
			display: none;
		}
	}
</style>
