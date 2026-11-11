<script lang="ts">
	import { resolve } from '$app/paths';

	let {
		status,
		signedIn = null,
		standalone = false
	}: {
		status: number;
		/** true: in the app (nav above). null: unknown (outside the app shell), so offer sign in too. */
		signedIn?: boolean | null;
		/** Outside the app shell: bring our own page container. */
		standalone?: boolean;
	} = $props();

	// Fixed wording per status: never the server's message or a stack trace.
	const copy = $derived(
		status === 404
			? {
					title: 'Page not found',
					body: 'That page does not exist, or you do not have access to it. Check the link, or head back to your builds.'
				}
			: status === 401 || status === 403
				? {
						title: 'No access',
						body: 'You do not have access to that. Ask a chapter owner, or sign in with another account.'
					}
				: status === 429
					? {
							title: 'Slow down a moment',
							body: 'Too many requests in a short time. Wait a few seconds and try again.'
						}
					: {
							title: 'Something went wrong',
							body: 'That was our fault, not yours. Your builds are safe. Try again in a moment.'
						}
	);
	const retry = $derived(status >= 500 || status === 429);
</script>

<svelte:head><title>{copy.title} · TMT Build Tracker</title></svelte:head>

<div class:wrap={standalone}>
	<section class="err" data-testid="error-page" role="alert">
		<div class="err-code num" aria-hidden="true">{status}</div>
		<h1>{copy.title}</h1>
		<p class="muted">{copy.body}</p>
		<div class="err-actions">
			<a class="btn primary" href={resolve('/(app)')} data-testid="error-home">Back to builds</a>
			{#if signedIn !== true}
				<a class="btn" href={resolve('/login')} data-testid="error-login">Sign in</a>
			{/if}
			{#if retry}
				<button class="btn ghost" type="button" onclick={() => location.reload()}>Try again</button>
			{/if}
		</div>
	</section>
</div>

<style>
	.err {
		max-width: 520px;
		margin: 8vh auto 0;
		padding: 28px 24px;
		display: grid;
		gap: 12px;
		justify-items: start;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 14px;
	}
	.err-code {
		font: 700 56px/1 var(--f-display);
		color: var(--accent);
		letter-spacing: 0.02em;
	}
	.err h1,
	.err p {
		margin: 0;
	}
	.err-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 6px;
	}
	@media (max-width: 760px) {
		.err {
			margin-top: 16px;
			padding: 20px 16px;
		}
		.err-code {
			font-size: 44px;
		}
	}
</style>
