<script lang="ts">
	import { tick } from 'svelte';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';

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

	$effect(() => {
		if (ctx.guide) {
			index = 0;
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
			<div class="vimg">
				{#if tab}
					<h3>Page {tab.page}: {tab.title}</h3>
					<!-- Guide images arrive in a later milestone: when tab.hasImage, render
					     <img src=".../guide/{tab.page}" alt="Guide page {tab.page}: {tab.title}"> here. -->
					<p class="muted">{tab.note}</p>
				{:else}
					<p class="muted">No guide pages for this {part ? 'part' : 'template'}.</p>
				{/if}
				<p class="muted">
					Guide page images are imported by a chapter owner in a later version. Until then this
					shows the page titles and which pages cover the part.
				</p>
			</div>
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
