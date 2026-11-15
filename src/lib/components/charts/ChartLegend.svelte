<script lang="ts">
	import type { Tone } from './tones.ts';

	/** A text legend: swatch plus words, so every series is named without relying on colour. */
	let {
		items
	}: {
		items: { label: string; tone: Tone; shape?: 'box' | 'line' | 'dash' | 'diamond' }[];
	} = $props();
</script>

<ul class="cl-list">
	{#each items as it, i (i)}
		<li class="cl-item">
			<span class="cl-sw cl-{it.shape ?? 'box'} cl-tone-{it.tone}" aria-hidden="true"></span>
			{it.label}
		</li>
	{/each}
</ul>

<style>
	.cl-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-8);
		font-size: var(--fs-sm);
		color: var(--ink);
	}
	.cl-item {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		min-width: 0;
	}
	.cl-sw {
		flex: none;
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background: var(--sw);
	}
	.cl-line {
		height: 3px;
		width: 16px;
		border-radius: 2px;
	}
	.cl-dash {
		height: 0;
		width: 16px;
		border-radius: 0;
		background: none;
		border-top: 3px dashed var(--sw);
	}
	.cl-diamond {
		width: 10px;
		height: 10px;
		border-radius: 1px;
		transform: rotate(45deg);
	}
	.cl-tone-good {
		--sw: var(--chart-good);
	}
	.cl-tone-bad {
		--sw: var(--chart-bad);
	}
	.cl-tone-neutral {
		--sw: var(--chart-todo);
	}
	.cl-tone-accent {
		--sw: var(--accent);
	}
	/* failed / lost carries a hatch as well as its colour */
	.cl-box.cl-tone-bad {
		background: repeating-linear-gradient(135deg, var(--chart-bad) 0 2.5px, var(--card) 2.5px 4px);
		box-shadow: inset 0 0 0 1px var(--chart-bad);
	}
</style>
