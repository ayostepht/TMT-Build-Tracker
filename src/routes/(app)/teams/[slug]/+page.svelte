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
	<div class="head-row">
		<h2>Builds</h2>
		{#if canEdit}
			<a class="btn primary" href={resolve('/(app)/builds/new')} data-testid="new-build"
				>New build</a
			>
		{/if}
	</div>
	<ul class="tpl-list bl-list">
		{#each data.builds as b (b.id)}
			<li class="bl-card" data-testid="build-card">
				<a class="bl-link" href={resolve('/(app)/builds/[id]', { id: b.id })}>{b.name}</a>
				<span class="bl-go" aria-hidden="true">→</span>
				<div class="bl-meta">
					<span class="ds-badge ds-badge--sm">{b.phase}</span>
					<span class="bl-prog">{b.progress}% printed ({b.printed}/{b.total})</span>
					{#if b.deliveryDate}<span class="bl-prog">Due {b.deliveryDate}</span>{/if}
					{#if b.setupStep !== null && canEdit}
						<a class="pill-link bl-setup" href={resolve('/(app)/builds/[id]/setup', { id: b.id })}
							>Setup: step {b.setupStep} of 5 <span class="btn-arrow" aria-hidden="true">→</span></a
						>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	<LandingBoard views={data.landing.views} more={data.landing.more} />
{/if}

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
		margin-top: 16px;
		margin-bottom: 8px;
	}
	.head-row h2 {
		margin: 0;
	}
	.bl-list {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/* Compact row: name + arrow on line 1, status and progress on line 2. The whole row is one
	   link (stretched link); the Setup pill sits above it. */
	.bl-card {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 8px;
		row-gap: 2px;
		min-height: 44px;
		padding: 8px 12px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
	}
	.bl-card:hover {
		border-color: var(--accent);
	}
	.bl-card:has(.bl-link:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.bl-link {
		grid-column: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 600 var(--fs-base) / 1.25 var(--f-body);
		color: inherit;
		text-decoration: none;
	}
	.bl-link::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.bl-link:focus-visible {
		outline: none;
	}
	.bl-go {
		grid-column: 2;
		grid-row: 1;
		color: var(--accent);
		font-size: 18px;
		line-height: 1;
	}
	.bl-meta {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 8px;
		min-width: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.bl-setup {
		position: relative;
		z-index: 1;
		min-height: 32px;
	}
</style>
