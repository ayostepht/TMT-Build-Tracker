<script lang="ts">
	import ChartLegend from './ChartLegend.svelte';
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
	import { chartLabelledBy } from './tones.ts';

	/**
	 * A cumulative step line (it only moves when something happens) with an optional dashed
	 * projection that continues from the last point. `x` values are labels in order; `yMax` is the
	 * top of the axis (the goal, e.g. total plates). Markers are failures drawn as diamonds on the
	 * line and named in the legend. Tap or arrow to a position for its value. Meant for a ChartFigure.
	 */
	let {
		points,
		projection = [],
		yMax,
		markers = [],
		unit = ''
	}: {
		points: { x: string; y: number }[];
		projection?: { x: string; y: number }[];
		yMax: number;
		markers?: { x: string; label: string; tone: 'bad' }[];
		unit?: string;
	} = $props();

	const labelledby = chartLabelledBy();
	let frameW = $state(0);
	let selected = $state<number | null>(null);

	const W = $derived(frameW > 0 ? frameW : 640);
	const H = $derived(W < 480 ? 190 : 230);

	/** Every x label once, actual points first, then projected positions beyond them. */
	const xs = $derived.by(() => {
		const out = points.map((p) => p.x);
		for (const p of projection) if (!out.includes(p.x)) out.push(p.x);
		return out;
	});
	const n = $derived(xs.length);
	const top = $derived(Math.max(1, yMax));
	const ticks = $derived.by(() => {
		const t = niceTicks(top).ticks.filter((v) => v <= top);
		if (top - t[t.length - 1] > top * 0.08) t.push(top);
		return t;
	});
	const tickLabels = $derived(ticks.map((t) => formatValue(t)));
	const left = $derived(10 + Math.max(...tickLabels.map((t) => t.length)) * 6.6);
	const right = 12;
	const padTop = 12;
	const bottom = 26;
	const plotW = $derived(Math.max(10, W - left - right));
	const plotH = $derived(H - padTop - bottom);
	// Positions sit in the middle of equal slots so the hit columns line up with the line.
	const slot = $derived(plotW / Math.max(1, n));
	const px = (i: number) => left + slot * i + slot / 2;
	const y = $derived(linearScale([0, top], [padTop + plotH, padTop]));
	const clamp = (v: number) => Math.min(top, Math.max(0, v));
	const idx = (x: string) => xs.indexOf(x);

	/** step-after: hold the value until the next point, then jump. */
	const stepPath = $derived.by(() => {
		let d = '';
		points.forEach((p, i) => {
			const X = px(idx(p.x));
			const Y = y(clamp(p.y));
			d += i === 0 ? `M${X} ${Y}` : `H${X}V${Y}`;
		});
		return d;
	});
	const areaPath = $derived(points.length ? `${stepPath}V${y(0)}H${px(idx(points[0].x))}Z` : '');
	const projPath = $derived.by(() => {
		if (!projection.length || !points.length) return '';
		const last = points[points.length - 1];
		let d = `M${px(idx(last.x))} ${y(clamp(last.y))}`;
		for (const p of projection) {
			if (idx(p.x) <= idx(last.x)) continue;
			d += `L${px(idx(p.x))} ${y(clamp(p.y))}`;
		}
		return d;
	});
	function valueAt(i: number): { y: number; projected: boolean } | null {
		const x = xs[i];
		const a = points.find((p) => p.x === x);
		if (a) return { y: a.y, projected: false };
		const p = projection.find((p) => p.x === x);
		return p ? { y: p.y, projected: true } : null;
	}
	const markerPts = $derived(
		markers
			.map((m) => {
				const i = idx(m.x);
				const a = points.find((p) => p.x === m.x);
				return i < 0 ? null : { i, label: m.label, y: a ? clamp(a.y) : 0 };
			})
			.filter((m): m is { i: number; label: string; y: number } => m !== null)
	);
	function describe(i: number): string {
		const v = valueAt(i);
		const u = unitSuffix(unit);
		if (!v) return `${xs[i]}: no value`;
		return `${xs[i]}: ${formatValue(v.y)}${u}${v.projected ? ' (projected)' : ''}`;
	}
	const labels = $derived(xs.map((_, i) => describe(i)));
	const step = $derived(labelStep(slot, Math.max(...xs.map((x) => x.length), 1) * 6.4 + 8));
	const legend = $derived([
		{ label: 'Done so far', tone: 'accent' as const, shape: 'line' as const },
		...(projPath ? [{ label: 'Projected', tone: 'accent' as const, shape: 'dash' as const }] : []),
		...markers.map((m) => ({
			label: `${m.x}: ${m.label}`,
			tone: m.tone,
			shape: 'diamond' as const
		}))
	]);
</script>

<div class="sl-wrap">
	<ChartLegend items={legend} />
	<div class="sl-frame" bind:clientWidth={frameW}>
		<svg
			class="sl-svg"
			role="img"
			aria-labelledby={labelledby}
			viewBox="0 0 {W} {H}"
			width="100%"
			height={H}
		>
			{#each ticks as t, i (i)}
				<line
					x1={left}
					x2={W - right}
					y1={y(t)}
					y2={y(t)}
					style="stroke: var(--chart-grid)"
					stroke-width="1"
				/>
				<text x={left - 6} y={y(t) + 4} text-anchor="end" class="sl-tick">{tickLabels[i]}</text>
			{/each}
			{#if areaPath}
				<path d={areaPath} style="fill: var(--accent)" opacity="0.1" />
			{/if}
			{#if stepPath}
				<path
					d={stepPath}
					fill="none"
					style="stroke: var(--accent)"
					stroke-width="2.5"
					stroke-linejoin="round"
				/>
			{/if}
			{#if projPath}
				<path
					d={projPath}
					fill="none"
					style="stroke: var(--accent)"
					stroke-width="2.5"
					stroke-dasharray="6 5"
					stroke-linecap="round"
				/>
			{/if}
			{#each markerPts as m, k (k)}
				<line
					x1={px(m.i)}
					x2={px(m.i)}
					y1={y(m.y)}
					y2={y(0)}
					style="stroke: var(--chart-bad)"
					stroke-width="1.5"
					stroke-dasharray="2 3"
				/>
				<rect
					x={px(m.i) - 5.5}
					y={y(m.y) - 5.5}
					width="11"
					height="11"
					transform="rotate(45 {px(m.i)} {y(m.y)})"
					style="fill: var(--chart-bad); stroke: var(--card)"
					stroke-width="1.5"
				/>
			{/each}
			{#each xs as x, i (i)}
				{#if (n - 1 - i) % step === 0}
					<text
						x={px(i)}
						y={H - 8}
						text-anchor={edgeAnchor(px(i), truncate(x, 12).length * 6.4, W)}
						class="sl-tick">{truncate(x, 12)}<title>{x}</title></text
					>
				{/if}
			{/each}
		</svg>
		<HitColumns
			count={n}
			width={W}
			x0={left}
			{slot}
			top={padTop}
			height={plotH + bottom}
			{labels}
			bind:selected
		/>
	</div>
	<p class="sl-read">
		{#if selected !== null && xs[selected] !== undefined}
			<strong>{xs[selected]}</strong>
			<span class="sl-val">{describe(selected).slice(xs[selected].length + 2)}</span>
		{:else}
			Tap the chart for a value.
		{/if}
	</p>
</div>

<style>
	.sl-wrap {
		display: grid;
		gap: var(--sp-5);
		min-width: 0;
	}
	.sl-frame {
		position: relative;
		min-width: 0;
	}
	.sl-svg {
		display: block;
		width: 100%;
		overflow: hidden;
	}
	.sl-tick {
		font-size: var(--fs-xs);
		fill: var(--muted);
		font-family: var(--f-body);
	}
	.sl-read {
		margin: 0;
		min-height: 1.4em;
		font-size: var(--fs-sm);
		color: var(--muted);
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--sp-6);
	}
	.sl-read strong,
	.sl-val {
		color: var(--ink);
	}
	.sl-val {
		font-variant-numeric: tabular-nums;
	}
</style>
