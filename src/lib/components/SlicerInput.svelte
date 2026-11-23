<script lang="ts">
	import { untrack } from 'svelte';
	import { followProp } from './follow-prop.svelte.ts';
	let {
		label,
		value,
		title = 'Grams your slicer shows for this plate',
		disabled = false,
		onsave
	}: {
		label: string;
		value: number | null | undefined;
		title?: string;
		disabled?: boolean;
		onsave: (v: number | null) => void;
	} = $props();

	// The box follows `value` except while the maker is typing in it (see `followProp`).
	let el = $state<HTMLInputElement>();
	const follow = followProp(
		() => el,
		() => String(value ?? '')
	);

	function commit(e: Event & { currentTarget: HTMLInputElement }) {
		follow.committed();
		const raw = e.currentTarget.value;
		onsave(raw === '' ? null : Math.max(0, Number(raw)));
	}
</script>

<label class="slicer-in" {title}>
	{label}
	<input
		type="number"
		min="0"
		step="1"
		placeholder="g"
		bind:this={el}
		value={untrack(() => value ?? '')}
		{disabled}
		oninput={follow.input}
		onblur={follow.blur}
		onchange={commit}
		onkeydown={(e) => {
			if (e.key === 'Enter') e.currentTarget.blur();
			else if (e.key === 'Escape') follow.abandon();
		}}
	/>
	g
</label>
