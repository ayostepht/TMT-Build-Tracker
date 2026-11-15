<script lang="ts">
	import type { Tone } from './tones.ts';

	/**
	 * A headline number: label, value with a unit, a line of detail and an optional thin split bar
	 * (good vs failed, say). The bar is decoration: put the same numbers in `detail` ("112 h good,
	 * 9 h failed") so nothing depends on colour.
	 */
	let {
		label,
		value,
		unit,
		detail,
		split,
		compact = false
	}: {
		label: string;
		value: string;
		unit?: string;
		detail?: string;
		split?: { value: number; tone: Tone }[];
		/** Small header-card variant: one line each for label and detail, smaller value. */
		compact?: boolean;
	} = $props();

	const sum = $derived((split ?? []).reduce((s, x) => s + Math.max(0, x.value), 0));
</script>

<div class="ds-card ds-card--compact st-tile" class:st-compact={compact}>
	<p class="st-label" title={compact ? label : undefined}>{label}</p>
	<p class="st-value">
		{value}{#if unit}<span class="st-unit">{unit}</span>{/if}
	</p>
	{#if split && sum > 0}
		<div class="st-split" aria-hidden="true">
			{#each split as s, i (i)}
				{#if s.value > 0}
					<span class="st-part st-tone-{s.tone}" style="width: {(s.value / sum) * 100}%"></span>
				{/if}
			{/each}
		</div>
	{/if}
	{#if detail}<p class="st-detail" title={compact ? detail : undefined}>{detail}</p>{/if}
</div>

<style>
	.st-tile {
		gap: var(--sp-3);
		align-content: start;
	}
	.st-label,
	.st-value,
	.st-detail {
		margin: 0;
		min-width: 0;
	}
	.st-label {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--muted);
		letter-spacing: 0.3px;
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}
	.st-value {
		font-family: var(--f-display);
		font-size: var(--fs-3xl);
		font-weight: 600;
		line-height: 1.05;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.st-unit {
		margin-left: var(--sp-3);
		font-size: var(--fs-lg);
		font-weight: 500;
		color: var(--muted);
	}
	.st-detail {
		font-size: var(--fs-sm);
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.st-compact {
		padding: var(--sp-4) var(--sp-4);
		gap: var(--sp-2);
		border-radius: var(--r-md);
	}
	.st-compact .st-label,
	.st-compact .st-detail {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow-wrap: normal;
		font-size: var(--fs-xs);
	}
	.st-compact .st-label {
		letter-spacing: 0.2px;
	}
	.st-compact .st-value {
		font-size: var(--fs-xl);
		white-space: nowrap;
		overflow-wrap: normal;
	}
	.st-compact .st-unit {
		margin-left: var(--sp-1);
		font-size: var(--fs-sm);
	}
	.st-compact .st-split {
		height: 5px;
	}
	.st-split {
		display: flex;
		height: 8px;
		border-radius: var(--r-pill);
		overflow: hidden;
		background: var(--paper);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.st-part {
		height: 100%;
		min-width: 2px;
	}
	.st-tone-good {
		background: var(--chart-good);
	}
	.st-tone-neutral {
		background: var(--chart-todo);
	}
	.st-tone-accent {
		background: var(--accent);
	}
	.st-tone-bad {
		background: repeating-linear-gradient(135deg, var(--chart-bad) 0 3px, var(--card) 3px 5px);
	}
</style>
