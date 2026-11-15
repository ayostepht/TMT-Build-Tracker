<script lang="ts">
	import { formatValue } from './scale.ts';
	import { chartLabelledBy, type Tone } from './tones.ts';

	/**
	 * One horizontal bar per category, split into toned segments, with an optional marker (stock on
	 * hand, the slicer's estimate) and every value printed as text: the bars need no hover. Built
	 * from HTML so labels wrap and truncate like text; the strip is hidden from assistive tech and
	 * the figure's summary and data table carry the numbers. `swatch` is a filament colour (hex) shown
	 * with a ring. `max` is a floor for the shared scale.
	 */
	let {
		rows,
		unit = '',
		max
	}: {
		rows: {
			label: string;
			segments: { value: number; tone: Tone; label?: string }[];
			marker?: { value: number; label: string };
			note?: string;
			swatch?: string;
		}[];
		unit?: string;
		max?: number;
	} = $props();

	const labelledby = chartLabelledBy();
	const total = (r: (typeof rows)[number]) =>
		r.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
	const scaleMax = $derived(
		Math.max(max ?? 0, ...rows.map((r) => Math.max(total(r), r.marker?.value ?? 0)), 1e-9)
	);
	const pct = (v: number) => Math.min(100, (Math.max(0, v) / scaleMax) * 100);
	const u = $derived(unit ? ` ${unit}` : '');
</script>

<ul class="hb-list" role="img" aria-labelledby={labelledby}>
	{#each rows as r, i (i)}
		<li class="hb-item">
			<div class="hb-top">
				<span class="hb-name">
					{#if r.swatch}<span class="hb-sw" style="background: {r.swatch}" aria-hidden="true"
						></span>{/if}
					<span class="hb-label" title={r.label}>{r.label}</span>
				</span>
				<span class="hb-total">{formatValue(total(r))}{u}</span>
			</div>
			<div class="hb-track">
				{#each r.segments as s, k (k)}
					{#if s.value > 0}
						<span class="hb-part hb-tone-{s.tone}" style="width: {pct(s.value)}%"></span>
					{/if}
				{/each}
				{#if r.marker}
					<span class="hb-mark" style="left: {pct(r.marker.value)}%"></span>
				{/if}
			</div>
			<div class="hb-sub">
				{#each r.segments as s, k (k)}
					{#if s.label}
						<span class="hb-key"
							><span class="hb-kw hb-tone-{s.tone}" aria-hidden="true"></span>{formatValue(
								s.value
							)}{u}
							{s.label}</span
						>
					{/if}
				{/each}
				{#if r.marker}
					<span class="hb-key"
						><span class="hb-km" aria-hidden="true"></span>{r.marker.label}
						{formatValue(r.marker.value)}{u}</span
					>
				{/if}
				{#if r.note}<span class="hb-note">{r.note}</span>{/if}
			</div>
		</li>
	{/each}
</ul>

<style>
	.hb-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-8);
		min-width: 0;
	}
	.hb-item {
		display: grid;
		gap: var(--sp-3);
		min-width: 0;
	}
	.hb-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--sp-6);
		min-width: 0;
	}
	.hb-name {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		min-width: 0;
	}
	.hb-label {
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.hb-sw {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: var(--r-pill);
		box-shadow:
			var(--ring-swatch),
			0 0 0 1px var(--field-line);
	}
	.hb-total {
		flex: none;
		font-size: var(--fs-md);
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
	.hb-track {
		position: relative;
		display: flex;
		height: 16px;
		border-radius: var(--r-sm);
		background: var(--paper);
		box-shadow: inset 0 0 0 1px var(--line);
		/* the marker pokes out above and below the strip, so it must not be clipped */
	}
	.hb-part {
		flex: none;
		min-width: 2px;
		height: 100%;
		border-right: 1px solid var(--card);
	}
	.hb-part:first-child {
		border-radius: var(--r-sm) 0 0 var(--r-sm);
	}
	.hb-tone-good {
		background: var(--chart-good);
	}
	.hb-tone-neutral {
		background: var(--chart-todo);
	}
	.hb-tone-accent {
		background: var(--accent);
	}
	/* failed / lost is hatched as well as coloured */
	.hb-tone-bad {
		background: repeating-linear-gradient(135deg, var(--chart-bad) 0 3px, var(--card) 3px 5px);
		box-shadow: inset 0 0 0 1px var(--chart-bad);
	}
	.hb-mark {
		position: absolute;
		top: -4px;
		bottom: -4px;
		width: 3px;
		margin-left: -1.5px;
		background: var(--ink);
		border-radius: 1px;
		box-shadow: 0 0 0 1px var(--card);
	}
	.hb-sub {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--sp-7);
		font-size: var(--fs-sm);
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.hb-key {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.hb-kw {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.hb-km {
		flex: none;
		width: 3px;
		height: 12px;
		background: var(--ink);
		border-radius: 1px;
	}
	.hb-note {
		overflow-wrap: anywhere;
	}
</style>
