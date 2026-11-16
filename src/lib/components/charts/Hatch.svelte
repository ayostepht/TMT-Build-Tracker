<script lang="ts">
	/** The diagonal-stripe fill used for the failed/lost tone inside an <svg><defs>. */
	let { id }: { id: string } = $props();
</script>

<pattern {id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
	<rect width="6" height="6" style="fill: var(--chart-bad)" />
	<rect width="2.4" height="6" style="fill: var(--card)" opacity="0.7" />
</pattern>
