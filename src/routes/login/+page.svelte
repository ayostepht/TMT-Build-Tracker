<script lang="ts">
	import AppMark from '#lib/components/AppMark.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	// Failed round trips come back to this page with ?error=<code>.
	const errorBack = $derived(
		data.redirectTo ? `/login?redirect=${encodeURIComponent(data.redirectTo)}` : '/login'
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		const res = await authClient.signIn.email({ email, password });
		busy = false;
		if (res.error) {
			error = res.error.message ?? 'Sign in failed';
			return;
		}
		// Read the target before invalidating: the reload re-runs this page's load, which
		// redirects (signed in) and replaces `data`, so reading it afterwards gave undefined.
		const dest = data.redirectTo ?? resolve('/(app)');
		await invalidateAll();
		// redirectTo is validated server-side (same-origin relative path only)
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(dest);
	}

	async function sso() {
		await authClient.signIn.social({
			provider: 'oidc',
			callbackURL: data.redirectTo ?? '/',
			errorCallbackURL: errorBack
		});
	}

	async function social(provider: 'google' | 'github') {
		await authClient.signIn.social({
			provider,
			callbackURL: data.redirectTo ?? '/',
			errorCallbackURL: errorBack
		});
	}
</script>

<svelte:head><title>Sign in · TMT Build Tracker</title></svelte:head>

<main id="main" class="wrap" tabindex="-1">
	<div class="card auth">
		<div>
			<div class="kicker auth-brand"><AppMark size={24} />TMT Build Tracker</div>
			<h1>Sign in</h1>
		</div>
		{#if data.notice}<p role="status">{data.notice}</p>{/if}
		{#if error}<div class="error" role="alert">{error}</div>{/if}
		{#if data.accountsPaused}
			<p class="muted" role="status" data-testid="accounts-paused">
				This server is not taking new accounts right now. You can still sign in if you already have
				one.
			</p>
		{/if}
		{#if data.authError}<div class="error" role="alert">{data.authError}</div>{/if}
		{#if data.publicMode}
			{#each data.providers as p (p)}
				<button class="btn primary" onclick={() => social(p)}
					>Continue with {p === 'google' ? 'Google' : 'GitHub'}</button
				>
			{:else}
				<p class="muted">Sign-in is not configured on this server yet.</p>
			{/each}
			<p class="muted">New here? Signing in with Google or GitHub creates your account.</p>
		{:else}
			<form class="stack" onsubmit={submit}>
				<label class="field"
					>Email<input type="email" bind:value={email} required autocomplete="email" /></label
				>
				<label class="field"
					>Password<input
						type="password"
						bind:value={password}
						required
						autocomplete="current-password"
					/></label
				>
				<button class="btn primary" disabled={busy}>Sign in</button>
			</form>
			<p class="muted" data-testid="forgot-password">
				Forgot your password? Ask whoever runs this server for a reset link.
			</p>
			{#if data.sso}
				<button class="btn" onclick={sso}>Sign in with {data.sso.providerName}</button>
			{/if}
			{#if data.signup === 'open'}
				<p class="muted">
					No account? <a
						href={resolve(
							data.redirectTo
								? `/signup?redirect=${encodeURIComponent(data.redirectTo)}`
								: '/signup'
						)}>Create one</a
					>
				</p>
			{:else if data.signup === 'invite'}
				<p class="muted">
					New accounts are by invitation only. Open the invitation link you were sent.
				</p>
			{:else}
				<p class="muted">Sign-up is closed on this server.</p>
			{/if}
		{/if}
		<p class="muted auth-legal">
			By signing in or creating an account you agree to the <a
				href={resolve('/terms')}
				data-testid="terms-link">Terms</a
			>
			and
			<a href={resolve('/privacy')} data-testid="privacy-link">Privacy</a> notes.
		</p>
	</div>
</main>

<style>
	.auth-legal {
		font-size: var(--fs-sm);
	}
	.auth-brand {
		display: flex;
		align-items: center;
		gap: 8px;
	}
</style>
