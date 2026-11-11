<script lang="ts">
	import type { Snippet } from 'svelte';
	import AppMark from '#lib/components/AppMark.svelte';
	import { resolve } from '$app/paths';

	let {
		title,
		updated,
		signedIn,
		other,
		children
	}: {
		title: string;
		/** ISO date the text was last changed. */
		updated: string;
		signedIn: boolean;
		/** The sibling page, linked at the foot. */
		other: 'privacy' | 'terms';
		children: Snippet;
	} = $props();
</script>

<main id="main" class="wrap" tabindex="-1">
	<article class="card legal-page">
		<header class="legal-head">
			<div class="kicker legal-brand"><AppMark size={24} />TMT Build Tracker</div>
			<h1>{title}</h1>
			<p class="muted">Last updated <time datetime={updated}>{updated}</time></p>
		</header>
		<div class="legal-body">{@render children()}</div>
		<footer class="legal-foot">
			{#if signedIn}
				<a class="btn primary" href={resolve('/(app)')} data-testid="legal-back">Back to the app</a>
			{:else}
				<a class="btn primary" href={resolve('/login')} data-testid="legal-back">Sign in</a>
			{/if}
			{#if other === 'privacy'}
				<a class="btn" href={resolve('/privacy')} data-testid="privacy-link">Privacy</a>
			{:else}
				<a class="btn" href={resolve('/terms')} data-testid="terms-link">Terms</a>
			{/if}
		</footer>
	</article>
</main>

<style>
	.legal-page {
		width: min(46rem, 100%);
		margin: 4vh auto 0;
		padding: 28px;
		display: grid;
		gap: var(--sp-8);
		min-width: 0;
	}
	.legal-brand {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.legal-head {
		display: grid;
		gap: var(--sp-3);
	}
	.legal-head :global(p) {
		margin: 0;
	}
	.legal-body {
		display: grid;
		gap: var(--sp-6);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.legal-body :global(h2) {
		margin: var(--sp-5) 0 0;
	}
	.legal-body :global(p),
	.legal-body :global(ul) {
		margin: 0;
	}
	.legal-body :global(ul) {
		padding-left: 1.25em;
		display: grid;
		gap: var(--sp-3);
	}
	.legal-foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
	@media (max-width: 480px) {
		.legal-page {
			padding: 20px;
		}
	}
</style>
