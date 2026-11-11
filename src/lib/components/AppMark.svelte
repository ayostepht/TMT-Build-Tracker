<script lang="ts">
	/** The app icon (white layered T on the accent), shown beside the app name. Decorative. */
	let { size }: { size?: number } = $props();
</script>

<img
	class="app-mark"
	src="/icons/icon.svg"
	alt=""
	width={size ?? 28}
	height={size ?? 28}
	style={size ? `--mark:${size}px` : undefined}
/>

<style>
	.app-mark {
		flex: none;
		width: var(--mark, 28px);
		height: var(--mark, 28px);
		border-radius: var(--r-md);
	}
	@media (min-width: 1440px) {
		.app-mark {
			width: var(--mark, 32px);
			height: var(--mark, 32px);
		}
	}
</style>
