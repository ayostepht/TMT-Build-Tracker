<script lang="ts">
	import { nowPrinting } from '#lib/domain/index.ts';
	import { page } from '$app/state';
	import { printersHrefFor } from '#lib/workspace-links.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import NowCard from './NowCard.svelte';
	import PrinterJobs from './PrinterJobs.svelte';

	const ctx = getBuildCtx();
	const items = $derived(nowPrinting(ctx.view));
	const partCount = $derived(items.reduce((a, i) => a + i.parts.length, 0));
	const printersHref = $derived(
		printersHrefFor(
			(page.data as { teams?: { id: string; slug: string }[] }).teams,
			ctx.view.build.organizationId
		)
	);
</script>

<section class="now" aria-labelledby="nowTitle">
	<div class="now-top">
		<h2 id="nowTitle">Now printing</h2>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		{#if printersHref}<a class="pill-link" href={printersHref} data-testid="now-printers-link"
				>Printers</a
			>{/if}
		<span class="meta"
			>{partCount ? `${partCount} part${partCount > 1 ? 's' : ''} on the printer` : ''}</span
		>
	</div>
	<PrinterJobs />
	<div class="now-cards">
		{#each items as item (item.plate)}
			<NowCard {item} />
		{:else}
			<p class="empty">
				Nothing on the printer. Set a part to Printing in the Print tab, or use Start printing on a
				plate in the Files tab, and it pins here.
			</p>
		{/each}
	</div>
</section>
