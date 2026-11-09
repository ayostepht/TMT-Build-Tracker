<script lang="ts">
	import { printing } from '#lib/client/api.ts';
	import type { Plate } from '#lib/domain/types.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import StartOnPrinter from './StartOnPrinter.svelte';

	/**
	 * "Start printing" for a plate from the Print tab: same mutation and team-printer buttons as the
	 * plate cards in the Files tab. `only` narrows it to one part (a rim run on a perPartRuns plate).
	 */
	let {
		plate,
		only = null,
		label = 'Start printing'
	}: { plate: Plate; only?: string | null; label?: string } = $props();
	const ctx = getBuildCtx();

	const idle = $derived(
		(only ? [only] : plate.parts).filter(
			(s) => !['Printed', 'Printing'].includes(ctx.view.state[s]?.status ?? '')
		)
	);
	const name = (slug: string) => {
		const p = ctx.view.parts.find((x) => x.slug === slug);
		return filLabel(ctx.filament(p?.role ?? ''), p?.name);
	};
	const start = (slugs: string[]) => ctx.act(() => printing(ctx.id, { action: 'start', slugs }));
</script>

{#if ctx.canEdit && idle.length}
	<span class="start-plate">
		{#if plate.perPartRuns}
			{#each idle as slug (slug)}
				<button
					class="btn sm"
					type="button"
					aria-label="Start {name(slug)} run on plate {plate.number}"
					onclick={() => start([slug])}>Start {name(slug)} run</button
				>
				<StartOnPrinter slugs={[slug]} plateNumber={plate.number} />
			{/each}
		{:else}
			<button
				class="btn sm primary"
				type="button"
				aria-label="Start printing plate {plate.number}"
				onclick={() => start(idle)}>{label}</button
			>
			<StartOnPrinter slugs={idle} plateNumber={plate.number} />
		{/if}
	</span>
{/if}

<style>
	.start-plate {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
</style>
