<script lang="ts">
	import { fmtHM, parseSlicerTime } from '#lib/domain/format.ts';

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

	function commit(e: Event & { currentTarget: HTMLInputElement }) {
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
		value={value ? fmtHM(value) : ''}
		{disabled}
		aria-invalid={bad}
		onchange={commit}
		onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
	/>
</label>
{#if bad}<span class="meta">Try 14h 20m, 14:20 or 14.3 (hours).</span>{/if}

<style>
	.time-in {
		width: 7.5em;
	}
</style>
