<script lang="ts">
	import type { FilamentRole } from '#lib/domain/types.ts';
	import Swatch from './Swatch.svelte';
	import { filamentLabel } from '#lib/domain/labels.ts';

	let { filament, role = '' }: { filament: FilamentRole | undefined; role?: string } = $props();
</script>

<span class="chip static">
	{#if filament}<Swatch hex={filament.hex} tpu={filament.tpu} size="mini" />{/if}
	{filamentLabel(filament, role)}
</span>
