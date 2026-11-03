<script lang="ts">
	import { resolve } from '$app/paths';
	import Swatch from '#lib/components/Swatch.svelte';
	import { filamentLabel } from '#lib/domain/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let scope = $state<'all' | 'mine'>('all');
	let q = $state('');

	const shown = $derived(
		data.designs.filter(
			(d) =>
				(scope === 'all' || d.mine) &&
				(!q.trim() ||
					`${d.name} ${d.authorName ?? ''} ${d.roles.map((r) => r.name).join(' ')}`
						.toLowerCase()
						.includes(q.trim().toLowerCase()))
		)
	);
</script>

<svelte:head><title>Designs · TMT Build Tracker</title></svelte:head>

<section class="stack">
	<div class="kicker">Color designs</div>
	<h1>Designs</h1>
	<p class="muted">
		Color schemes other makers shared, and the ones you saved from a build. Start a new build from
		one, or copy it into a build you already have.
	</p>
	<div class="bar">
		<div class="seg" role="group" aria-label="Show">
			<button type="button" aria-pressed={scope === 'all'} onclick={() => (scope = 'all')}>
				All
			</button>
			<button type="button" aria-pressed={scope === 'mine'} onclick={() => (scope = 'mine')}>
				Mine
			</button>
		</div>
		<input type="search" placeholder="Search designs" aria-label="Search designs" bind:value={q} />
	</div>

	<ul class="grid">
		{#each shown as d (d.id)}
			<li class="card design" data-design={d.slug}>
				<a
					class="thumb"
					href={resolve('/(app)/designs/[slug]', { slug: d.slug })}
					tabindex="-1"
					aria-hidden="true"
				>
					{#if d.hasSnapshot}
						<img src="/api/designs/{d.id}/snapshot.png" alt="" loading="lazy" />
					{:else}
						<span class="strip">
							{#each d.roles as r (r.key)}
								<span style="background:{r.hex}"></span>
							{/each}
						</span>
					{/if}
				</a>
				<h3><a href={resolve('/(app)/designs/[slug]', { slug: d.slug })}>{d.name}</a></h3>
				<div class="muted">
					{d.authorName ?? 'Included with the kit'} · {d.templateName}
					{#if !d.isPublic}<span class="set">private</span>{/if}
				</div>
				<ul class="fils">
					{#each d.roles as r (r.key)}
						<li><Swatch hex={r.hex} size="mini" /> {filamentLabel(r, r.key)}</li>
					{/each}
				</ul>
			</li>
		{:else}
			<li class="muted">
				{scope === 'mine'
					? 'You have not saved a design yet. Open a build, go to its Design tab and choose Save as design.'
					: 'No designs yet.'}
			</li>
		{/each}
	</ul>
</section>

<style>
	h1,
	h3,
	p {
		margin: 0;
	}
	.bar {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
	}
	.bar input {
		flex: 1 1 200px;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--card);
		color: var(--ink);
		font-size: 15px;
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 6px;
		overflow: hidden;
	}
	.seg button {
		border: 0;
		background: var(--card);
		color: var(--ink);
		padding: 8px 14px;
		cursor: pointer;
		font: inherit;
	}
	.seg button[aria-pressed='true'] {
		background: var(--accent);
		color: #fff;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 14px;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	}
	.design {
		align-content: start;
		gap: 8px;
	}
	.thumb {
		display: block;
		aspect-ratio: 4 / 3;
		border-radius: 8px;
		overflow: hidden;
		background: var(--paper);
		border: 1px solid var(--line);
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.strip {
		display: flex;
		height: 100%;
	}
	.strip span {
		flex: 1;
	}
	.fils {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
		font-size: 14px;
	}
</style>
