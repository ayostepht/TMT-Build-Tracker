<script lang="ts">
	import { resolve } from '$app/paths';
	import AssemblyPanel from '#lib/components/build/AssemblyPanel.svelte';
	import HandoffPanel from '#lib/components/build/HandoffPanel.svelte';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	const ctx = getBuildCtx();
</script>

<svelte:head><title>Finish · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<nav class="jump" aria-label="On this page">
	<a href="#assembly">Assembly</a>
	<a href="#photos">Photos</a>
	<a href="#handoff">Handoff</a>
	<a href={resolve('/(app)/builds/[id]/summary', { id: ctx.id })} data-testid="open-summary"
		>Printable summary</a
	>
</nav>

<div id="assembly" class="anchor"><AssemblyPanel /></div>
<div id="handoff" class="anchor"><HandoffPanel /></div>

<style>
	.jump {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		font-size: 14px;
		margin-bottom: 12px;
	}
	.anchor {
		scroll-margin-top: 56px;
		margin-bottom: 18px;
	}
</style>
