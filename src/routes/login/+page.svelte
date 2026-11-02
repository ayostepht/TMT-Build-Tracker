<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

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
		await invalidateAll();
		await goto(resolve('/'));
	}

	async function sso() {
		await authClient.signIn.social({ provider: 'oidc', callbackURL: '/' });
	}
</script>

<div class="wrap">
	<div class="card auth">
		<div>
			<div class="kicker">TMT Build Tracker</div>
			<h1>Sign in</h1>
		</div>
		{#if error}<div class="error" role="alert">{error}</div>{/if}
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
		{#if data.sso}
			<button class="btn" onclick={sso}>Sign in with {data.sso.providerName}</button>
		{/if}
		<p class="muted">No account? <a href={resolve('/signup')}>Create one</a></p>
	</div>
</div>
