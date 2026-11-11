<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const back = $derived(page.data.backBuild as { id: string; name: string } | null);
	const from = $derived(back ? `?from=${back.id}` : '');
</script>

<svelte:head><title>Kit admin · TMT Build Tracker</title></svelte:head>

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
	<h1>Kits</h1>
	<p class="muted">
		Templates installed on this server and which MakeGood files each one has. Part placement for the
		3D chair is under Advanced.
	</p>
	<ul class="tpl-list">
		{#each data.templates as t (t.id)}
			<li class="ds-card ds-card--compact">
				<h3>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={resolve('/(app)/admin/templates/[id]', { id: t.id }) + from}>{t.name}</a>
				</h3>
				<div class="muted">{t.version}{t.owned ? ' · chapter copy' : ''}</div>
				<div class="counts">
					<span class="ds-badge ds-badge--sm">{t.parts} parts</span>
					<span class="ds-badge ds-badge--sm">{t.plates} plates</span>
					<span class="ds-badge ds-badge--sm">{t.variantGroups} variant groups</span>
					<span class="ds-badge ds-badge--sm">
						{t.model ? `3D model v${t.model.version.slice(0, 8)}` : 'No 3D model yet'}
					</span>
				</div>
			</li>
		{/each}
	</ul>
</section>
