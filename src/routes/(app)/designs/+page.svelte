<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Swatch from '#lib/components/Swatch.svelte';
	import { filamentLabel, roleLabel, sortRoles } from '#lib/domain/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const back = $derived(page.data.backBuild as { id: string; name: string } | null);
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
	<div class="ghead">
		<div class="kicker">Color designs</div>
		<h1>Designs</h1>
		<p class="muted lead">
			Color schemes other makers shared, and the ones you saved. Open one to start a new build from
			it, or to copy its colors into a build or draft you already have.
		</p>
	</div>
	<div class="filters">
		<div class="seg" role="group" aria-label="Show">
			<button type="button" aria-pressed={scope === 'all'} onclick={() => (scope = 'all')}>
				All
			</button>
			<button type="button" aria-pressed={scope === 'mine'} onclick={() => (scope = 'mine')}>
				Mine
			</button>
		</div>
		<input type="search" placeholder="Search designs" aria-label="Search designs" bind:value={q} />
		<span class="muted count" aria-live="polite"
			>{shown.length} design{shown.length === 1 ? '' : 's'}</span
		>
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
							{#each sortRoles(d.roles, (r) => r.key) as r (r.key)}
								<span style="background:{r.hex}"></span>
							{/each}
						</span>
					{/if}
				</a>
				<div class="meta">
					<h3><a href={resolve('/(app)/designs/[slug]', { slug: d.slug })}>{d.name}</a></h3>
					<div class="muted">
						{d.authorName ?? 'Included with the kit'} · {d.templateName}
						{#if !d.isPublic}<span class="set">private</span>{/if}
					</div>
				</div>
				<ul class="fils">
					{#each sortRoles(d.roles, (r) => r.key) as r (r.key)}
						<li>
							<Swatch hex={r.hex} size="mini" />
							<span class="role">{roleLabel(r.key, r)}</span>
							<span class="muted fil" title={filamentLabel(r, r.key)}
								>{filamentLabel(r, r.key)}</span
							>
						</li>
					{/each}
				</ul>
				<a class="btn primary use" href="{resolve('/(app)/designs/[slug]', { slug: d.slug })}#use"
					>Use this design</a
				>
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
	section.stack {
		display: grid;
		gap: 16px;
	}
	h1,
	h3,
	p {
		margin: 0;
	}
	.ghead {
		display: grid;
		gap: 6px;
	}
	.lead {
		max-width: 62ch;
	}
	/* Not ".bar": app.css uses that name for the 10 px progress bar, which clipped this row. */
	.filters {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
	}
	.filters input {
		flex: 1 1 200px;
		max-width: 420px;
		min-height: 40px;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--card);
		color: var(--ink);
		font-size: 15px;
	}
	.count {
		font-size: 14px;
		margin-left: auto;
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
		padding: 8px 16px;
		min-height: 40px;
		cursor: pointer;
		font: inherit;
		font-size: 15px;
		font-weight: 500;
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
		gap: 10px;
	}
	.meta {
		display: grid;
		gap: 2px;
	}
	.meta .muted {
		font-size: 14px;
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
		gap: 4px;
		font-size: 14px;
	}
	.fils li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.role {
		font-weight: 600;
		white-space: nowrap;
	}
	.fil {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
	}
	.use {
		justify-self: start;
		margin-top: 2px;
	}
</style>
