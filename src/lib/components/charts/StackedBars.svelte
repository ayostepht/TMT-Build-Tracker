<script lang="ts">
	import ChartLegend from './ChartLegend.svelte';
	import Hatch from './Hatch.svelte';
	import HitColumns from './HitColumns.svelte';
	import {
		edgeAnchor,
		formatValue,
		labelStep,
		unitSuffix,
		linearScale,
		niceTicks,
		truncate
	} from './scale.ts';
	import { chartLabelledBy, toneFill, type Tone } from './tones.ts';

	/**
	 * Stacked columns over a time series (hours of good / failed prints per week, say). Series stack
	 * bottom to top in the order given. Tap, or arrow to, a column for its values. `max` is a floor
	 * for the axis (it never clips data). Meant to sit in a ChartFigure.
	 */
	let {
		categories,
		series,
		unit = '',
		max
	}: {
		categories: string[];
		series: { key: string; label: string; values: number[]; tone: Tone }[];
		unit?: string;
		max?: number;
	} = $props();

	const uid = $props.id();
	const hatchId = `${uid}-h`;
	const labelledby = chartLabelledBy();

	let frameW = $state(0);
	let selected = $state<number | null>(null);

	const W = $derived(frameW > 0 ? frameW : 640);
	const H = $derived(W < 480 ? 190 : 230);
	const n = $derived(categories.length);

	const totals = $derived(
		categories.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0))
	);
	const axis = $derived(niceTicks(Math.max(max ?? 0, ...totals)));
	const tickLabels = $derived(
		axis.ticks.map((t, i) =>
			i === axis.ticks.length - 1 && unit ? `${formatValue(t)}${unitSuffix(unit)}` : formatValue(t)
		)
	);
	const left = $derived(10 + Math.max(...tickLabels.map((t) => t.length)) * 6.6);
	const right = 6;
	const top = 12;
	const bottom = 26;
	const plotW = $derived(Math.max(10, W - left - right));
	const plotH = $derived(H - top - bottom);
	const slot = $derived(plotW / Math.max(1, n));
	const bw = $derived(Math.min(44, slot * 0.7));
	const y = $derived(linearScale([0, axis.max], [top + plotH, top]));
	const step = $derived(labelStep(slot, Math.max(...categories.map((c) => c.length), 1) * 6.4 + 8));

	function cols(i: number) {
		const x = left + i * slot + (slot - bw) / 2;
		let acc = 0;
		return series.map((s) => {
			const v = Math.max(0, s.values[i] ?? 0);
			const y1 = y(acc);
			acc += v;
			return { s, v, x, y: y(acc), h: y1 - y(acc) };
		});
	}
	function describe(i: number): string {
		const parts = series.map(
			(s) => `${formatValue(s.values[i] ?? 0)}${unitSuffix(unit)} ${s.label}`
		);
		return `${categories[i]}: ${parts.join(', ')}`;
	}
	const labels = $derived(categories.map((_, i) => describe(i)));
</script>

<div class="sb-wrap">
	<ChartLegend items={series.map((s) => ({ label: s.label, tone: s.tone }))} />
	<div class="sb-frame" bind:clientWidth={frameW}>
		<svg
			class="sb-svg"
			role="img"
			aria-labelledby={labelledby}
			viewBox="0 0 {W} {H}"
			width="100%"
			height={H}
		>
			<defs><Hatch id={hatchId} /></defs>
			{#each axis.ticks as t, i (i)}
				<line
					x1={left}
					x2={W - right}
					y1={y(t)}
					y2={y(t)}
					style="stroke: var(--chart-grid)"
					stroke-width="1"
				/>
				<text x={left - 6} y={y(t) + 4} text-anchor="end" class="sb-tick">{tickLabels[i]}</text>
			{/each}
			{#each categories as c, i (i)}
				{#each cols(i) as seg (seg.s.key)}
					{#if seg.v > 0}
						<rect
							x={seg.x}
							y={seg.y}
							width={bw}
							height={Math.max(1, seg.h)}
							fill={toneFill(seg.s.tone, hatchId)}
							style="stroke: var(--card)"
							stroke-width="1"
						/>
					{/if}
				{/each}
				{#if (n - 1 - i) % step === 0}
					<text
						x={left + i * slot + slot / 2}
						y={H - 8}
						text-anchor={edgeAnchor(left + i * slot + slot / 2, truncate(c, 12).length * 6.4, W)}
						class="sb-tick">{truncate(c, 12)}<title>{c}</title></text
					>
				{/if}
			{/each}
		</svg>
		<HitColumns
			count={n}
			width={W}
			x0={left}
			{slot}
			{top}
			height={plotH + bottom}
			{labels}
			bind:selected
		/>
	</div>
	<p class="sb-read">
		{#if selected !== null && categories[selected] !== undefined}
			<strong>{categories[selected]}</strong>
			{#each series as s (s.key)}
				<span class="sb-val"
					>{formatValue(s.values[selected] ?? 0)}{unit ? ' ' + unit : ''} {s.label}</span
				>
			{/each}
		{:else}
			Tap a bar for its value.
		{/if}
	</p>
</div>

<style>
	.sb-wrap {
		display: grid;
		gap: var(--sp-5);
		min-width: 0;
	}
	.sb-frame {
		position: relative;
		min-width: 0;
	}
	.sb-svg {
		display: block;
		width: 100%;
		overflow: hidden;
	}
	.sb-tick {
		font-size: var(--fs-xs);
		fill: var(--muted);
		font-family: var(--f-body);
	}
	.sb-read {
		margin: 0;
		min-height: 2.6em;
		font-size: var(--fs-sm);
		color: var(--muted);
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--sp-6);
	}
	.sb-read strong {
		color: var(--ink);
	}
	.sb-val {
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
</style>
