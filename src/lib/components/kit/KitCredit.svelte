<script lang="ts">
	/**
	 * Credit line for MakeGood's 3D TMT files (CC0), shown wherever the bundled kit is used. One
	 * part, the optional one-piece push handle, is by jeepxj under CC BY-NC.
	 */
	let { class: className = '' }: { class?: string } = $props();
</script>

<p class="kit-credit {className}">
	3D model and print files: MakeGood · CC0.
	<span class="kit-credit-extra">One-piece push handle: jeepxj · CC BY-NC.</span>
</p>

<style>
	.kit-credit-extra {
		display: block;
	}
	.kit-credit {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.3;
		color: var(--muted, currentColor);
		opacity: 0.8;
	}
</style>
