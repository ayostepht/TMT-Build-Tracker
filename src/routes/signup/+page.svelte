<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		const res = await authClient.signUp.email({ name, email, password });
		busy = false;
		if (res.error) {
			error = res.error.message ?? 'Sign up failed';
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
		await authClient.signIn.social({ provider: 'oidc', callbackURL: data.redirectTo ?? '/' });
	}
</script>

<div class="wrap">
	<div class="card auth">
		<div>
			<div class="kicker">TMT Build Tracker</div>
			<h1>Create account</h1>
		</div>
		{#if error}<div class="error" role="alert">{error}</div>{/if}
		<form class="stack" onsubmit={submit}>
			<label class="field">Name<input bind:value={name} required autocomplete="name" /></label>
			<label class="field"
				>Email<input type="email" bind:value={email} required autocomplete="email" /></label
			>
			<label class="field"
				>Password (8+ characters)<input
					type="password"
					bind:value={password}
					required
					minlength="8"
					autocomplete="new-password"
				/></label
			>
			<button class="btn primary" disabled={busy}>Create account</button>
		</form>
		{#if data.sso}
			<button class="btn" onclick={sso}>Sign in with {data.sso.providerName}</button>
		{/if}
		<p class="muted">
			Already registered? <a
				href={resolve(
					data.redirectTo ? `/login?redirect=${encodeURIComponent(data.redirectTo)}` : '/login'
				)}>Sign in</a
			>
		</p>
	</div>
</div>
