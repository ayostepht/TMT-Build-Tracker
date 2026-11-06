<script lang="ts">
	import { fmtH } from '#lib/domain/index.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import PlateStart from './PlateStart.svelte';
	import Swatch from './Swatch.svelte';

	/** The next plates with nothing printed or printing yet, each with Start printing. */
	const MAX = 3;
	const ctx = getBuildCtx();

	const ready = $derived(
		ctx.view.plates.filter((pl) =>
			pl.parts.every((s) => ['To print', 'Reprint'].includes(ctx.view.state[s]?.status ?? ''))
		)
	);
	const shown = $derived(ready.slice(0, MAX));
	const partOf = (slug: string) => ctx.view.parts.find((p) => p.slug === slug);
</script>

{#if ctx.canEdit && shown.length}
	<section class="group ready" aria-label="Ready to print" data-testid="ready-to-print">
		<div class="group-head">
			<h2>Ready to print</h2>
			<span class="meta num">{ready.length} plate{ready.length === 1 ? '' : 's'} not started</span>
		</div>
		<div class="rows">
			{#each shown as pl (pl.number)}
				<div class="ready-row" data-plate={pl.number}>
					<div class="ready-info">
						<div class="pname">Plate {pl.number} · {pl.name}</div>
						<div class="psub">
							{#each [...new Set(pl.parts.map((s) => partOf(s)?.role ?? ''))] as r (r)}
								{@const f = ctx.filament(r)}
								{#if f}<Swatch hex={f.hex} tpu={f.tpu} size="mini" />{/if}
							{/each}
							<span>{pl.parts.map((s) => partOf(s)?.name ?? s).join(', ')}</span>
							{#if pl.estSeconds}
								<span class="num"
									>~{fmtH(pl.estSeconds)}{pl.estSource === 'estimate'
										? ' (est.)'
										: pl.estSource === 'learned'
											? ' (from your slice)'
											: ''}</span
								>
							{/if}
						</div>
					</div>
					<PlateStart plate={pl} />
				</div>
			{/each}
		</div>
		{#if ready.length > shown.length}
			<div class="meta" style="padding:6px 2px">
				{ready.length - shown.length} more not shown. Group by Plate to see them all.
			</div>
		{/if}
	</section>
{/if}

<style>
	.ready {
		margin-bottom: 14px;
	}
	.ready-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-bottom: 1px solid var(--line);
	}
	.ready-row:last-child {
		border-bottom: 0;
	}
	.ready-info {
		min-width: 0;
		flex: 1 1 220px;
	}
</style>
