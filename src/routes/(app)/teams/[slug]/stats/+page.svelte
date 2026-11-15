<script lang="ts">
	import { resolve } from '$app/paths';
	import ChartFigure from '#lib/components/charts/ChartFigure.svelte';
	import HBar from '#lib/components/charts/HBar.svelte';
	import StackedBars from '#lib/components/charts/StackedBars.svelte';
	import StatTile from '#lib/components/charts/StatTile.svelte';
	import { formatValue } from '#lib/components/charts/scale.ts';
	import type { PageProps } from './$types';
	import { MONTH_CHOICES, workspaceCharts } from './adapt.ts';

	let { data, params }: PageProps = $props();

	const stats = $derived(data.stats);
	const c = $derived(workspaceCharts(stats));
	const base = $derived(resolve('/(app)/teams/[slug]/stats', { slug: params.slug }));
	const buildHref = (id: string) => resolve('/(app)/builds/[id]/stats', { id });
	const status = (b: { finished: boolean; phase: string }) =>
		b.finished ? 'Handed off' : b.phase.charAt(0).toUpperCase() + b.phase.slice(1);
</script>

<svelte:head><title>Stats · TMT Build Tracker</title></svelte:head>

<div class="wst" data-testid="workspace-stats">
	<div class="wst-bar">
		<p class="wst-lead">Every build in this workspace. Drafts are not counted.</p>
		<div class="ds-seg ds-seg--sm" role="group" aria-label="Time window" data-testid="stats-months">
			{#each MONTH_CHOICES as m (m)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- base is resolved -->
				<a
					href="{base}?months={m}"
					aria-current={stats.months === m ? 'true' : undefined}
					data-testid="months-{m}">{m} months</a
				>
			{/each}
		</div>
	</div>

	{#if c.empty}
		<section class="ds-card wst-empty" data-testid="stats-empty">
			<h2 class="wst-h">Nothing to chart yet</h2>
			<p class="wst-p">
				There are no builds or prints in the last {stats.months} months. Charts appear once a build has
				logged prints.
			</p>
		</section>
	{:else}
		<div class="wst-grid">
			<div class="wst-tiles" data-testid="stats-tiles">
				{#each c.tiles as t (t.key)}
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

			<div class="wst-wide" data-testid="chart-weekly">
				<ChartFigure title={c.weekly.title} summary={c.weekly.summary} table={c.weekly.table}>
					<StackedBars
						categories={c.weekly.categories}
						unit="h"
						series={[
							{ key: 'good', label: 'Good', values: c.weekly.good, tone: 'good' },
							{ key: 'failed', label: 'Failed', values: c.weekly.failed, tone: 'bad' }
						]}
					/>
				</ChartFigure>
			</div>

			<div class="wst-narrow" data-testid="chart-printers">
				{#if c.printers}
					<ChartFigure
						title={c.printers.title}
						summary={c.printers.summary}
						table={c.printers.table}
					>
						<HBar rows={c.printers.rows} unit="h" />
					</ChartFigure>
				{:else}
					<section class="ds-card wst-note">
						<h3 class="wst-h">Printers</h3>
						<p class="wst-p">No prints in the last {stats.months} months.</p>
					</section>
				{/if}
			</div>

			{#if c.filaments}
				<div class="wst-half" data-testid="chart-filaments">
					<ChartFigure
						title={c.filaments.title}
						summary={c.filaments.summary}
						table={c.filaments.table}
					>
						<HBar rows={c.filaments.rows} unit="g" />
					</ChartFigure>
				</div>
			{/if}

			<div class="wst-half" data-testid="chart-plates">
				{#if c.plates}
					<ChartFigure title={c.plates.title} summary={c.plates.summary} table={c.plates.table}>
						<HBar rows={c.plates.rows} unit="%" max={100} />
					</ChartFigure>
				{:else}
					<section class="ds-card wst-note">
						<h3 class="wst-h">Plates that fail most</h3>
						<p class="wst-p">No plate has three or more prints yet, so there is no rate to show.</p>
					</section>
				{/if}
			</div>

			<section class="ds-card wst-full" data-testid="stats-builds">
				<h3 class="wst-h">Builds</h3>
				<p class="wst-p">
					Builds with prints in the last {stats.months} months, all-time totals. Open one for its own
					Stats tab.
				</p>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="wst-scroll" role="region" aria-label="Builds, table" tabindex="0">
					<table class="wst-table">
						<thead>
							<tr>
								<th scope="col">Build</th>
								<th scope="col">Status</th>
								<th scope="col" class="wst-num">Hours</th>
								<th scope="col" class="wst-num">Filament</th>
								<th scope="col" class="wst-num">Lost</th>
								<th scope="col" class="wst-num">Days</th>
							</tr>
						</thead>
						<tbody>
							{#each stats.builds as b (b.id)}
								<tr data-testid="stats-build-row">
									<th scope="row"><a href={buildHref(b.id)}>{b.name}</a></th>
									<td>{status(b)}</td>
									<td class="wst-num">{formatValue(b.hours, 1)} h</td>
									<td class="wst-num">{formatValue(b.kg, 1)} kg</td>
									<td class="wst-num">{Math.round(b.lostShare * 100)}%</td>
									<td class="wst-num">{b.days}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	{/if}
</div>

<style>
	.wst {
		display: grid;
		gap: var(--sp-8);
		padding-top: var(--sp-4);
		min-width: 0;
	}
	.wst-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-6);
	}
	.wst-lead {
		margin: 0;
		color: var(--muted);
	}
	.wst-grid {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: var(--sp-8);
		align-items: start;
	}
	.wst-tiles {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--sp-8);
	}
	.wst-tiles > div > :global(*) {
		height: 100%;
		box-sizing: border-box;
	}
	.wst-wide {
		grid-column: span 8;
	}
	.wst-narrow {
		grid-column: span 4;
	}
	.wst-half {
		grid-column: span 6;
	}
	.wst-full {
		grid-column: 1 / -1;
	}
	.wst-wide,
	.wst-narrow,
	.wst-half,
	.wst-full,
	.wst-tiles > div {
		min-width: 0;
	}
	.wst-h {
		margin: 0;
		font-family: var(--f-display);
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--ink);
	}
	.wst-p {
		margin: 0;
		color: var(--muted);
	}
	.wst-empty,
	.wst-note,
	.wst-full {
		display: grid;
		gap: var(--sp-4);
	}
	.wst-scroll {
		overflow-x: auto;
		margin-top: var(--sp-4);
	}
	.wst-scroll:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.wst-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--fs-md);
		font-variant-numeric: tabular-nums;
	}
	.wst-table th,
	.wst-table td {
		padding: var(--sp-4) var(--sp-5);
		border-bottom: 1px solid var(--line);
		text-align: left;
		white-space: nowrap;
		color: var(--ink);
	}
	.wst-table thead th {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--muted);
	}
	.wst-table tbody th {
		font-weight: 500;
	}
	.wst-table th a {
		color: var(--accent);
		text-decoration: none;
	}
	.wst-table th a:hover {
		text-decoration: underline;
	}
	.wst-table .wst-num {
		text-align: right;
	}
	@media (max-width: 1000px) {
		.wst-tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.wst-wide,
		.wst-narrow,
		.wst-half {
			grid-column: 1 / -1;
		}
	}
	@media (max-width: 520px) {
		.wst-grid,
		.wst-tiles {
			gap: var(--sp-6);
		}
	}
</style>
