<script lang="ts">
	import { tick } from 'svelte';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import { guidePageImageUrl } from '#lib/client/api.ts';
	import { rememberOpener } from '#lib/client/focus.ts';
	import { MAKEGOOD_GUIDE_URL } from '#lib/makegood.ts';

	const ctx = getBuildCtx();
	let index = $state(0);
	let vbox = $state<HTMLDialogElement>();

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
			vbox
				?.querySelector('[role="tab"][aria-selected="true"]')
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
		}
	});

	function close() {
		ctx.guide = null;
	}
	/** Opens the element as a modal <dialog>: native focus trap, inert page, Escape and focus restore. */
	function modal(node: HTMLDialogElement) {
		let gone = false;
		const giveFocusBack = rememberOpener();
		node.showModal();
		node.querySelector<HTMLElement>('[data-initial]')?.focus({ preventScroll: true });
		// Native Escape closes the dialog and fires `close`; ignore the one our own teardown causes.
		const onnative = () => {
			if (!gone) close();
		};
		node.addEventListener('close', onnative);
		return {
			destroy() {
				gone = true;
				if (node.open) node.close();
				giveFocusBack(node);
			}
		};
	}
	// Escape is the dialog's own; arrows turn the pages (not while typing or on a focused tab's own keys).
	function onkeydown(e: KeyboardEvent) {
		if (!ctx.guide || e.defaultPrevented) return;
		if (e.key === 'ArrowLeft' && index > 0) index--;
		else if (e.key === 'ArrowRight' && index < tabs.length - 1) index++;
	}
</script>

<svelte:window {onkeydown} />

{#if ctx.guide}
	<dialog
		class="ds-modal gv-box"
		aria-labelledby="vTitle"
		bind:this={vbox}
		use:modal
		onclick={(e) => e.target === e.currentTarget && close()}
	>
		<div class="gv-head">
			<h2 id="vTitle">
				{part ? part.name : 'Build guide'}
				<span class="sub"
					>{part
						? `${filLabel(ctx.filament(part.role), part.role)} · ${part.sourceFile}`
						: ctx.view.build.templateName}</span
				>
			</h2>
			<button class="gv-close" type="button" aria-label="Close guide" data-initial onclick={close}
				>×</button
			>
		</div>
		<div class="gv-tabs">
			<div class="ds-seg gv-seg" role="tablist" aria-label="Guide pages">
				{#each tabs as t, n (t.page)}
					<button type="button" role="tab" aria-selected={n === index} onclick={() => (index = n)}
						>p{t.page} · {t.title.replace(/:.*/, '')}</button
					>
				{/each}
			</div>
		</div>
		{#if imgSrc && tab}
			<div class="vzoom">
				<div class="zbar" role="group" aria-label="Zoom">
					<button
						type="button"
						class="gv-nav"
						aria-label="Zoom out"
						disabled={zoom <= 1}
						onclick={() => zoomBy(-1)}>−</button
					>
					<span class="zlevel">{Math.round(zoom * 100)}%</span>
					<button
						type="button"
						class="gv-nav"
						aria-label="Zoom in"
						disabled={zoom >= 4}
						onclick={() => zoomBy(1)}>+</button
					>
					<button type="button" class="gv-nav" disabled={zoom === 1} onclick={() => (zoom = 1)}
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
			<div class="gv-img">
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
		<div class="gv-foot">
			<button class="gv-nav" type="button" disabled={index === 0} onclick={() => index--}
				>‹ Prev</button
			>
			<span class="cap">{tab?.note ?? ''}</span>
			<button
				class="gv-nav"
				type="button"
				disabled={index >= tabs.length - 1}
				onclick={() => index++}>Next ›</button
			>
		</div>
	</dialog>
{/if}

<style>
	.gv-box {
		width: min(980px, calc(100vw - 24px));
		max-height: calc(100dvh - 24px);
		display: grid;
		grid-template-rows: auto auto 1fr auto;
		overflow: hidden;
	}
	.gv-head {
		display: flex;
		align-items: center;
		gap: var(--sp-6);
		padding: var(--sp-6) var(--sp-7) var(--sp-4);
	}
	.gv-head h2 {
		flex: 1;
		min-width: 0;
	}
	.gv-head .sub {
		font-size: var(--fs-sm);
		color: var(--muted);
		font-family: var(--f-body);
		font-weight: 400;
		display: block;
		letter-spacing: 0;
	}
	.gv-close {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: var(--r-lg);
		width: 40px;
		height: 40px;
		font-size: var(--fs-lg);
		cursor: pointer;
	}
	/* The page tabs scroll sideways: the segmented track keeps its option widths instead of squeezing. */
	.gv-tabs {
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding: 0 var(--sp-7) var(--sp-5);
		border-bottom: 1px solid var(--line);
	}
	.gv-seg {
		display: inline-grid;
		grid-auto-columns: max-content;
		max-width: none;
	}
	.gv-seg > button {
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	/* Non-colour cue for the open page, besides the raised option. */
	.gv-seg > [aria-selected='true'] {
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	.gv-img {
		overflow: auto;
		min-height: 160px;
		padding: var(--sp-8);
		display: grid;
		align-content: start;
		gap: var(--sp-4);
	}
	.gv-foot {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		padding: var(--sp-5) var(--sp-7);
		border-top: 1px solid var(--line);
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.gv-foot .cap {
		flex: 1;
		min-width: 0;
		color: var(--ink);
	}
	.gv-nav {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: var(--r-md);
		padding: var(--sp-3) var(--sp-6);
	}
	.gv-nav:disabled {
		opacity: 0.4;
		cursor: default;
	}
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
		font: 500 var(--fs-sm) var(--f-mono);
	}
	.zhint {
		font-size: var(--fs-xs);
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
	@media (max-width: 760px) {
		.zhint {
			display: none;
		}
	}
</style>
