<script lang="ts">
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

	function commit(e: Event & { currentTarget: HTMLInputElement }) {
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
		value={value ?? ''}
		{disabled}
		onchange={commit}
		onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
	/>
	g
</label>
