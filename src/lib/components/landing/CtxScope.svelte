<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setBuildCtx, type BuildCtx } from '../build-context.svelte.ts';

	/** Provides one build's context to the components inside, so `getBuildCtx()` works on the landing. */
	let { ctx, children }: { ctx: BuildCtx; children: Snippet } = $props();
	// svelte-ignore state_referenced_locally
	setBuildCtx(ctx);
</script>

{@render children()}
