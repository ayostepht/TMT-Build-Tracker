<script lang="ts">
	import { untrack } from 'svelte';
	import { fmtHM, parseSlicerTime } from '#lib/domain/format.ts';
	import { followProp } from './follow-prop.svelte.ts';

	let {
		label = 'Slicer time',
		value,
		placeholder = 'e.g. 14h 20m',
		title = 'The time your slicer shows for one run of this plate. Overrides the file and the estimates.',
		disabled = false,
		onsave
	}: {
		label?: string;
		value: number | null | undefined;
		placeholder?: string;
		title?: string;
		disabled?: boolean;
		onsave: (seconds: number | null) => void;
	} = $props();

	let bad = $state(false);
	// The box follows `value` except while the maker is typing in it (see `followProp`).
	let el = $state<HTMLInputElement>();
	const follow = followProp(
		() => el,
		() => (value ? fmtHM(value) : '')
	);

	function commit(e: Event & { currentTarget: HTMLInputElement }) {
		follow.committed();
		const raw = e.currentTarget.value.trim();
		if (raw === '') {
			bad = false;
			onsave(null);
			return;
		}
		const s = parseSlicerTime(raw);
		bad = s === null;
		if (s === null) return;
		e.currentTarget.value = fmtHM(s);
		onsave(s);
	}
</script>

<label class="slicer-in" {title}>
	{label}
	<input
		type="text"
		inputmode="text"
		class="time-in"
		{placeholder}
		bind:this={el}
		value={untrack(() => (value ? fmtHM(value) : ''))}
		{disabled}
		aria-invalid={bad}
		oninput={follow.input}
		onblur={follow.blur}
		onchange={commit}
		onkeydown={(e) => {
			if (e.key === 'Enter') e.currentTarget.blur();
			else if (e.key === 'Escape') {
				bad = false;
				follow.abandon();
			}
		}}
	/>
</label>
{#if bad}<span class="meta">Try 14h 20m, 14:20 or 14.3 (hours).</span>{/if}

<style>
	.time-in {
		width: 7.5em;
	}
</style>
