<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const total = $derived(data.groups.reduce((n, g) => n + g.builds.length, 0));
</script>

<svelte:head><title>All builds · TMT Build Tracker</title></svelte:head>

<section class="stack" data-testid="all-builds-page">
	<div class="head-row">
		<div>
			<div class="kicker">Every chapter and My builds</div>
			<h1>All builds</h1>
		</div>
		<a class="btn primary" href={resolve('/(app)/builds/new')} data-testid="new-build">New build</a>
	</div>
	{#if total === 0}
		<p class="muted">No builds yet.</p>
	{/if}
	{#each data.groups as g (g.id)}
		{#if g.builds.length || total === 0}
			<div class="ab-group" data-testid="builds-group">
				<h2>
					<a href={resolve('/(app)/teams/[slug]', { slug: g.slug })}>{g.name}</a>
					<span class="ab-n">{g.builds.length}</span>
				</h2>
				<ul class="tpl-list">
					{#each g.builds as b (b.id)}
						<li class="tpl">
							<h3><a href={resolve('/(app)/builds/[id]', { id: b.id })}>{b.name}</a></h3>
							<div class="counts">
								<span class="set">{b.phase}</span>
								<span class="set">{b.progress}% printed ({b.printed}/{b.total})</span>
								{#if b.deliveryDate}<span class="set">Due {b.deliveryDate}</span>{/if}
								{#if b.setupStep !== null && g.role !== 'viewer'}
									<a class="pill-link" href={resolve('/(app)/builds/[id]/setup', { id: b.id })}
										>Setup: step {b.setupStep} of 5
										<span class="btn-arrow" aria-hidden="true">→</span></a
									>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/each}
</section>

<style>
	.head-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.ab-group {
		display: grid;
		gap: 10px;
	}
	.ab-group h2 a {
		color: inherit;
		text-decoration: none;
	}
	.ab-n {
		font: 600 13px/1 var(--f-body);
		color: var(--muted);
		margin-left: 6px;
	}
</style>
