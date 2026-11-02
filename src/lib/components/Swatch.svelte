<script lang="ts">
	let {
		hex,
		tpu = false,
		size = 'sw'
	}: { hex: string; tpu?: boolean; size?: 'sw' | 'mini' } = $props();
</script>

<span class={size} class:tpu style="background-color:{hex}" aria-hidden="true"></span>
