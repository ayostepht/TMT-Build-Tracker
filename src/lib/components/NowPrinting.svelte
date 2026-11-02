<script lang="ts">
	import { nowPrinting } from '#lib/domain/index.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import NowCard from './NowCard.svelte';

	const ctx = getBuildCtx();
	const items = $derived(nowPrinting(ctx.view));
	const partCount = $derived(items.reduce((a, i) => a + i.parts.length, 0));
</script>

<section class="now" aria-labelledby="nowTitle">
	<div class="now-top">
		<h2 id="nowTitle">Now printing</h2>
		<span class="meta"
			>{partCount ? `${partCount} part${partCount > 1 ? 's' : ''} on the printer` : ''}</span
		>
	</div>
	<div class="now-cards">
		{#each items as item (item.plate)}
			<NowCard {item} />
		{:else}
			<p class="empty">
				Nothing on the printer. Set a part to Printing, or use Start printing on a plate in the
				Plates tab, and it pins here.
			</p>
		{/each}
	</div>
</section>
