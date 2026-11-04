<script lang="ts">
	/** Credit line for MakeGood's 3D TMT files (CC0), shown wherever the bundled kit is used. */
	let { class: className = '' }: { class?: string } = $props();
</script>

<p class="kit-credit {className}">3D model and print files: MakeGood · CC0</p>

<style>
	.kit-credit {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.3;
		color: var(--muted, currentColor);
		opacity: 0.8;
	}
</style>
