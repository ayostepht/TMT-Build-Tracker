<script lang="ts">
	import { paceOf, plateTimeBadge } from '#lib/domain/index.ts';
	import type { Plate } from '#lib/domain/types.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	/** A plate's time: pace-adjusted ("≈ 9.4 h at your pace", base time secondary) once the build has a pace. */
	let { plate }: { plate: Plate } = $props();
	const ctx = getBuildCtx();
	const badge = $derived(plateTimeBadge(plate, paceOf(ctx.view)));
</script>

{#if badge}
	<span class="ptime meta num" title={badge.title} data-testid="plate-time" data-paced={badge.paced}
		>{badge.main}{#if badge.base}<span class="base">{badge.paced ? ' ·' : ''} {badge.base}</span
			>{/if}{#if badge.total}<span class="base"> · {badge.total}</span>{/if}</span
	>
{/if}

<style>
	.base {
		color: var(--muted);
		font-weight: 400;
	}
</style>
