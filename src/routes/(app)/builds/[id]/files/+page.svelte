<script lang="ts">
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import ExportCard from '#lib/components/ExportCard.svelte';
	import PlatesPanel from '#lib/components/build/PlatesPanel.svelte';
	import PrinterHint from '#lib/components/PrinterHint.svelte';
	import PrintSettings from '#lib/components/build/PrintSettings.svelte';

	const ctx = getBuildCtx();
</script>

<svelte:head><title>Files · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<PrinterHint />

<nav class="jump" aria-label="On this page">
	<a class="pill-link" href="#plates">Printer and plates</a>
	<a class="pill-link" href="#export">Export</a>
	<a class="pill-link" href="#settings">Print settings</a>
</nav>

<div id="plates" class="anchor"><PlatesPanel /></div>
<div id="export" class="anchor"><ExportCard /></div>
<div class="anchor"><PrintSettings /></div>

<style>
	.jump {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
		align-items: center;
		margin-bottom: var(--sp-6);
	}
	.anchor {
		scroll-margin-top: 56px;
		margin-bottom: var(--sp-9);
	}
</style>
