<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PlacementEditor from '#lib/components/PlacementEditor.svelte';
	import KitCredit from '#lib/components/kit/KitCredit.svelte';
	import KitStatus from '#lib/components/kit/KitStatus.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let advOpen = $state(false);
	const back = $derived(page.data.backBuild as { id: string; name: string } | null);
</script>

<section class="stack">
	<div class="kicker">Kit admin</div>
	{#if back}
		<p>
			<a
				class="btn ghost sm back"
				href={resolve('/(app)/builds/[id]', { id: back.id })}
				data-testid="back-to-build-link"
				><span class="btn-arrow" aria-hidden="true">←</span> Back to {back.name}</a
			>
		</p>
	{/if}
	<p>
		<a class="btn ghost sm back" href={resolve('/(app)/admin/templates')}
			><span class="btn-arrow" aria-hidden="true">←</span> Kits</a
		>
	</p>
	<h1>{data.template.name}</h1>

	<div class="card stack">
		<KitStatus templateId={data.template.id} />
		<KitCredit />
		<p class="muted">
			To add or replace files, open a build and use Files, then Print settings. The setup steps of a
			new build do the same in "Choose build template".
			{#if back}
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="btn sm go"
					href={resolve('/(app)/builds/[id]/files', { id: back.id }) + '#settings'}
					>Open Print settings <span class="btn-arrow" aria-hidden="true">→</span></a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</p>
	</div>

	<details
		class="card adv"
		data-testid="advanced-placement"
		ontoggle={(e) => (advOpen = e.currentTarget.open)}
	>
		<summary><h2>Advanced: part placement</h2></summary>
		{#if !advOpen}
			<!-- the 3D editor loads when opened -->
		{:else if data.model}
			<p class="muted">
				Pick a part (tap it in the 3D view or in the list) and nudge it into place. Positions are
				millimetres, y up; the model keeps each part in its own STEP frame, so nothing is
				reconverted.
			</p>
			{#key data.model.version + String(data.model.hardwareUrl)}
				<PlacementEditor templateId={data.template.id} model={data.model} parts={data.parts} />
			{/key}
		{:else}
			<p class="muted">The 3D chair is not installed yet, so there is nothing to place.</p>
		{/if}
	</details>
</section>

<style>
	section.stack {
		display: grid;
		gap: 14px;
	}
	section.stack > p {
		margin: 0;
	}
	.adv summary {
		cursor: pointer;
		list-style: revert;
	}
	.adv summary h2 {
		display: inline;
	}
	.adv[open] summary {
		margin-bottom: 10px;
	}
</style>
