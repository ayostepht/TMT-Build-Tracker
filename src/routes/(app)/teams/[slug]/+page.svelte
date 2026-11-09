<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const canEdit = $derived(data.canEdit);
</script>

<div class="head-row">
	<h2>Builds</h2>
	{#if canEdit}
		<a class="btn primary" href={resolve('/(app)/builds/new')} data-testid="new-build">New build</a>
	{/if}
</div>
<ul class="tpl-list">
	{#each data.builds as b (b.id)}
		<li class="tpl">
			<h3><a href={resolve('/(app)/builds/[id]', { id: b.id })}>{b.name}</a></h3>
			<div class="counts">
				<span class="set">{b.phase}</span>
				<span class="set">{b.progress}% printed ({b.printed}/{b.total})</span>
				{#if b.deliveryDate}<span class="set">Due {b.deliveryDate}</span>{/if}
				{#if b.setupStep !== null && canEdit}
					<a class="pill-link" href={resolve('/(app)/builds/[id]/setup', { id: b.id })}
						>Setup: step {b.setupStep} of 5 <span class="btn-arrow" aria-hidden="true">→</span></a
					>
				{/if}
			</div>
		</li>
	{:else}
		<li class="muted">No builds yet.</li>
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
	.head-row h2 {
		margin: 0;
	}
</style>
