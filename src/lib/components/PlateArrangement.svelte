<script lang="ts">
	import type { ArrangedPlate } from '#lib/domain/arrange.ts';
	import { legendRows } from '#lib/domain/plate-legend.ts';
	import type { PrintFootprint } from '#lib/domain/print-footprint.ts';
	import type { Silhouette } from '#lib/domain/silhouette.ts';
	import { fmt } from '#lib/domain/index.ts';
	import PlateDiagram from './PlateDiagram.svelte';
	import PlateLegend from './PlateLegend.svelte';

	/**
	 * One arranged plate as the user sees it: the diagram, its numbered legend, how much of
	 * the bed is used and the grams per filament. Hover or tap a legend row (or a shape) to
	 * highlight the other.
	 */
	let {
		plate,
		footprints,
		silhouettes,
		colorOf,
		nameOf,
		filamentLabel,
		perRun = false,
		bedLabel = ''
	}: {
		plate: ArrangedPlate;
		footprints: Record<string, PrintFootprint>;
		silhouettes: Record<string, Silhouette>;
		colorOf: (role: string) => string;
		nameOf: (slug: string) => string;
		filamentLabel: (role: string) => string;
		perRun?: boolean;
		bedLabel?: string;
	} = $props();

	let hover = $state<string | null>(null);
	let pinned = $state<string | null>(null);
	const active = $derived(hover ?? pinned);
	const rows = $derived(legendRows(plate, nameOf));
	const pct = $derived(Math.round(plate.utilisation * 100));
	const anyApprox = $derived(rows.some((r) => r.approx));
	const toggle = (slug: string) => (pinned = pinned === slug ? null : slug);
</script>

<div class="arranged">
	<div class="diagram">
		<PlateDiagram
			{plate}
			{footprints}
			{silhouettes}
			{rows}
			{colorOf}
			{active}
			onactive={(s) => (hover = s)}
			onselect={toggle}
		/>
	</div>
	<div class="side">
		<PlateLegend
			{rows}
			{colorOf}
			{active}
			{pinned}
			onactive={(s) => (hover = s)}
			onselect={toggle}
		/>
		{#if anyApprox}
			<p class="approx-note" data-testid="approx-note">
				Approximate shapes (dashed). Import print geometry for exact shapes.
			</p>
		{/if}
		<div class="stats">
			{#if plate.oversize}
				<span class="over-note">Does not fit the bed{bedLabel ? ` (${bedLabel})` : ''}.</span>
			{:else}
				<div class="util">
					<span class="meta num">{pct}% of the bed used</span>
					<span
						class="bar"
						role="meter"
						aria-label="Bed used"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={pct}><span style="width:{Math.min(100, pct)}%"></span></span
					>
				</div>
			{/if}
			{#if Object.keys(plate.estGrams).length}
				<div class="grams">
					{#each Object.entries(plate.estGrams) as [role, g] (role)}
						<span class="meta num g" data-testid="plate-grams"
							><span class="dot" style="background:{colorOf(role)}" aria-hidden="true"
							></span>{filamentLabel(role)} ~{fmt(g)} g{perRun ? ' per run' : ''}</span
						>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.arranged {
		display: grid;
		gap: 12px 22px;
		align-items: start;
		grid-template-columns: minmax(0, 1fr);
	}
	.diagram {
		min-width: 0;
		max-width: 520px;
		width: 100%;
	}
	.side {
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	@media (min-width: 860px) {
		.arranged {
			grid-template-columns: minmax(300px, 460px) minmax(0, 1fr);
		}
	}
	.approx-note {
		margin: 0;
		font-size: 12.5px;
		color: var(--muted);
	}
	.stats {
		display: grid;
		gap: 8px;
	}
	.util {
		display: grid;
		gap: 4px;
	}
	.bar {
		display: block;
		height: 5px;
		border-radius: 3px;
		background: var(--line);
		overflow: hidden;
	}
	.bar > span {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--accent);
	}
	.grams {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	.g {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.55);
	}
	.over-note {
		color: var(--bad);
		font-size: 13px;
		font-weight: 600;
	}
</style>
