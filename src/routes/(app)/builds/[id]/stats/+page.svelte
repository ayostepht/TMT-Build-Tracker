<script lang="ts">
	import { resolve } from '$app/paths';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import ChartFigure from '#lib/components/charts/ChartFigure.svelte';
	import HBar from '#lib/components/charts/HBar.svelte';
	import StackedBars from '#lib/components/charts/StackedBars.svelte';
	import StatTile from '#lib/components/charts/StatTile.svelte';
	import StepLine from '#lib/components/charts/StepLine.svelte';
	import { buildStats } from './adapt.ts';

	const ctx = getBuildCtx();
	const s = $derived(buildStats(ctx.view, new Date(ctx.now)));
</script>

<svelte:head><title>Stats · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

{#if s.empty}
	<section class="ds-card bst-empty" data-testid="stats-empty">
		<h2 class="bst-h">No prints logged yet</h2>
		<p class="bst-p">
			Charts for printing time, filament and progress appear here once you log your first print.
		</p>
		<a class="btn primary" href={resolve('/(app)/builds/[id]/print', { id: ctx.id })}>Go to Print</a
		>
	</section>
{:else}
	<div class="bst-grid" data-testid="build-stats">
		<div class="bst-tiles" data-testid="stats-tiles">
			{#each s.tiles as t (t.key)}
				<div data-testid="stat-{t.key}">
					<StatTile
						label={t.label}
						value={t.value}
						unit={t.unit}
						detail={t.detail}
						split={t.split}
					/>
				</div>
			{/each}
		</div>

		{#if s.progress}
			<div class="bst-wide" data-testid="chart-progress">
				<ChartFigure title={s.progress.title} summary={s.progress.summary} table={s.progress.table}>
					<StepLine
						points={s.progress.points}
						projection={s.progress.projection}
						yMax={s.progress.yMax}
						markers={s.progress.markers}
						unit={s.progress.unit}
					/>
				</ChartFigure>
			</div>
		{/if}

		<div class="bst-narrow" data-testid="chart-failures">
			{#if s.failures.rows === null}
				<section class="ds-card bst-note">
					<h3 class="bst-h">{s.failures.title}</h3>
					<p class="bst-p">{s.failures.summary}</p>
				</section>
			{:else}
				<ChartFigure title={s.failures.title} summary={s.failures.summary} table={s.failures.table}>
					<HBar rows={s.failures.rows} unit="failed" />
				</ChartFigure>
			{/if}
		</div>

		{#if s.filament}
			<div class="bst-half" data-testid="chart-filament">
				<ChartFigure title={s.filament.title} summary={s.filament.summary} table={s.filament.table}>
					<HBar rows={s.filament.rows} unit="g" />
				</ChartFigure>
			</div>
		{/if}

		{#if s.plates}
			<div class="bst-half" data-testid="chart-plates">
				<ChartFigure title={s.plates.title} summary={s.plates.summary} table={s.plates.table}>
					<HBar rows={s.plates.rows} unit="h" />
				</ChartFigure>
			</div>
		{/if}

		{#if s.time}
			<div class="bst-full" data-testid="chart-time">
				<ChartFigure title={s.time.title} summary={s.time.summary} table={s.time.table}>
					<StackedBars
						categories={s.time.categories}
						unit="h"
						series={[
							{ key: 'good', label: 'Good', values: s.time.good, tone: 'good' },
							{ key: 'failed', label: 'Failed', values: s.time.failed, tone: 'bad' }
						]}
					/>
				</ChartFigure>
			</div>
		{/if}
	</div>
{/if}

<style>
	.bst-grid {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: var(--sp-8);
		align-items: start;
	}
	.bst-tiles {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--sp-8);
	}
	.bst-wide {
		grid-column: span 8;
	}
	.bst-narrow {
		grid-column: span 4;
	}
	.bst-half {
		grid-column: span 6;
	}
	.bst-full {
		grid-column: 1 / -1;
	}
	.bst-tiles > div > :global(*) {
		height: 100%;
		box-sizing: border-box;
	}
	.bst-wide,
	.bst-narrow,
	.bst-half,
	.bst-full,
	.bst-tiles > div {
		min-width: 0;
	}
	.bst-h {
		margin: 0;
		font-family: var(--f-display);
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--ink);
	}
	.bst-p {
		margin: 0;
		color: var(--muted);
	}
	.bst-empty {
		display: grid;
		gap: var(--sp-5);
		justify-items: start;
	}
	.bst-note {
		display: grid;
		gap: var(--sp-3);
	}
	@media (max-width: 1000px) {
		.bst-tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.bst-wide,
		.bst-narrow,
		.bst-half {
			grid-column: 1 / -1;
		}
	}
	@media (max-width: 520px) {
		.bst-grid,
		.bst-tiles {
			gap: var(--sp-6);
		}
	}
</style>
