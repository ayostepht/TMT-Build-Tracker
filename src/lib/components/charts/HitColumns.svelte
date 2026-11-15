<script lang="ts">
	import { rovingIndex } from './scale.ts';

	/**
	 * The tap / keyboard layer over a column chart: one real <button aria-pressed> per column laid over
	 * the SVG (HTML, because an interactive element cannot live inside role="img"). Roving tabindex:
	 * one tab stop, arrows / Home / End move, focus or tap selects and the chart shows the value in
	 * its readout; tapping the selected column or pressing Escape clears it. Geometry is in the
	 * chart's viewBox units, laid out as percentages so it follows the SVG.
	 */
	let {
		count,
		width,
		x0,
		slot,
		top,
		height,
		labels,
		selected = $bindable(null)
	}: {
		count: number;
		/** viewBox width. */
		width: number;
		/** Left edge of the first column. */
		x0: number;
		/** Column width. */
		slot: number;
		top: number;
		height: number;
		/** Accessible name per column (carries the values). */
		labels: string[];
		selected?: number | null;
	} = $props();

	let tab = $state(0);
	let before: number | null = null;
	let els: HTMLButtonElement[] = [];
	const tabIdx = $derived(Math.min(tab, Math.max(0, count - 1)));

	function onkey(e: KeyboardEvent, i: number) {
		if (e.key === 'Escape') {
			selected = null;
			return;
		}
		const j = rovingIndex(e.key, i, count);
		if (j === null) return;
		e.preventDefault();
		tab = j;
		els[j]?.focus();
	}
</script>

{#each labels as label, i (i)}
	<button
		type="button"
		class="hc-col"
		style="left: {((x0 + i * slot) / width) * 100}%; width: {(slot / width) *
			100}%; top: {top}px; height: {height}px"
		tabindex={i === tabIdx ? 0 : -1}
		aria-pressed={selected === i}
		aria-label={label}
		bind:this={els[i]}
		onfocus={() => {
			selected = i;
			tab = i;
		}}
		onpointerdown={() => (before = selected)}
		onclick={() => {
			tab = i;
			// a tap focuses first (selecting it), so compare with what was selected before the press
			selected = before === i ? null : i;
			before = null;
		}}
		onkeydown={(e) => onkey(e, i)}
	></button>
{/each}

<style>
	.hc-col {
		position: absolute;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		border-radius: var(--r-sm);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.hc-col[aria-pressed='true'] {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.hc-col:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
</style>
