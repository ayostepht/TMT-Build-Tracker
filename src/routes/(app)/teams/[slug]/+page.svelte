<script lang="ts">
	import { resolve } from '$app/paths';
	import LandingBoard from '#lib/components/landing/LandingBoard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const canEdit = $derived(data.canEdit);
</script>

{#if data.builds.length === 0}
	<div class="card stack" data-testid="landing-empty">
		<h2>Plan, print and hand off a chair</h2>
		<p>
			TMT Build Tracker helps {data.team.personal ? 'you' : 'your chapter'} build a MakeGood 3D TMT chair:
			pick colors, print the plates, assemble it and hand it over. Once a build is under way, this page
			shows what is printing and what to print next.
		</p>
		{#if canEdit}
			<div>
				<a class="btn primary" href={resolve('/(app)/builds/new')} data-testid="new-build"
					>New build</a
				>
			</div>
		{:else}
			<p class="muted">Ask a chapter owner for editor access to start a build.</p>
		{/if}
	</div>
{:else}
	<LandingBoard views={data.landing.views} more={data.landing.more} />
	<div class="head-row">
		<h2>Builds</h2>
		{#if canEdit}
			<a class="btn primary" href={resolve('/(app)/builds/new')} data-testid="new-build"
				>New build</a
			>
		{/if}
	</div>
{/if}
<ul class="tpl-list">
	{#each data.builds as b (b.id)}
		<li class="ds-card ds-card--compact">
			<h3><a href={resolve('/(app)/builds/[id]', { id: b.id })}>{b.name}</a></h3>
			<div class="counts">
				<span class="ds-badge ds-badge--sm">{b.phase}</span>
				<span class="ds-badge ds-badge--sm">{b.progress}% printed ({b.printed}/{b.total})</span>
				{#if b.deliveryDate}<span class="ds-badge ds-badge--sm">Due {b.deliveryDate}</span>{/if}
				{#if b.setupStep !== null && canEdit}
					<a class="pill-link" href={resolve('/(app)/builds/[id]/setup', { id: b.id })}
						>Setup: step {b.setupStep} of 5 <span class="btn-arrow" aria-hidden="true">→</span></a
					>
				{/if}
			</div>
		</li>
	{/each}
</ul>

{#if data.team.personal}
	<div class="card stack">
		<h2>Want to build with others?</h2>
		<p class="muted">
			Create a chapter and invite people, then move builds into it from the build's settings.
		</p>
		<div>
			<a class="btn primary" href={resolve('/(app)/onboarding')}>Create a chapter</a>
		</div>
	</div>
{/if}

<style>
	.head-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.head-row {
		margin-top: 28px;
		margin-bottom: 12px;
	}
	.head-row h2 {
		margin: 0;
	}
</style>
