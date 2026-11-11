<script lang="ts">
	import { resolve } from '$app/paths';
	import LandingBoard from '#lib/components/landing/LandingBoard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const canEdit = $derived(data.canEdit);
	// The builds with something on the board, printing first (the server orders them): a thumb-sized
	// way in that sits above the cards, so it is on screen without scrolling.
	const QUICK_MAX = 4;
	const quick = $derived(data.landing.views.slice(0, QUICK_MAX).map((v) => v.build));
	const quickMore = $derived(data.builds.length > quick.length);
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
	{#if quick.length}
		<nav class="bl-quick" aria-label="Open a build" data-testid="landing-quick">
			{#each quick as q (q.id)}
				<a
					class="pill-link bl-quick-link"
					href={resolve('/(app)/builds/[id]', { id: q.id })}
					title={q.name}
					><span class="bl-quick-name">{q.name}</span>
					<span class="btn-arrow" aria-hidden="true">→</span></a
				>
			{/each}
			{#if quickMore}
				<a class="pill-link bl-quick-link" href={resolve('/(app)/builds')}>All builds</a>
			{/if}
		</nav>
	{/if}
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
		<li class="ds-card ds-card--compact bl-card" data-testid="build-card">
			<h3 class="bl-title">
				<a class="bl-link" href={resolve('/(app)/builds/[id]', { id: b.id })}>{b.name}</a>
			</h3>
			<span class="bl-go" aria-hidden="true">→</span>
			<div class="counts">
				<span class="ds-badge ds-badge--sm">{b.phase}</span>
				<span class="ds-badge ds-badge--sm">{b.progress}% printed ({b.printed}/{b.total})</span>
				{#if b.deliveryDate}<span class="ds-badge ds-badge--sm">Due {b.deliveryDate}</span>{/if}
				{#if b.setupStep !== null && canEdit}
					<a class="pill-link bl-setup" href={resolve('/(app)/builds/[id]/setup', { id: b.id })}
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
	.bl-quick {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}
	.bl-quick-link {
		min-height: 44px;
		padding-inline: 16px;
		font-size: var(--fs-md);
		font-weight: 600;
		max-width: 100%;
	}
	.bl-quick-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The whole card is one link (stretched link); the Setup pill sits above it. */
	.bl-card {
		position: relative;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}
	.bl-card:hover {
		border-color: var(--accent);
	}
	.bl-card:has(.bl-link:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.bl-title {
		grid-column: 1;
		margin: 0;
	}
	.bl-link {
		overflow-wrap: anywhere;
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
	.bl-card :global(.counts) {
		grid-column: 1 / -1;
	}
	.bl-go {
		grid-column: 2;
		grid-row: 1;
		color: var(--accent);
		font-size: 22px;
		line-height: 1;
	}
	.bl-setup {
		position: relative;
		z-index: 1;
		min-height: 32px;
	}
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
