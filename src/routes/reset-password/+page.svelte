<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.ts';

	// The link is /reset-password#token=...: the fragment is never sent to the server. It is
	// moved out of the address bar on load and kept in memory only.
	let token = $state('');
	let password = $state('');
	let confirm = $state('');
	let show = $state(false);
	let busy = $state(false);
	let error = $state('');
	let done = $state(false);
	let dead = $state(false);

	onMount(() => {
		const h = new URLSearchParams(location.hash.replace(/^#/, ''));
		token = h.get('token') ?? '';
		history.replaceState(history.state, '', location.pathname);
		if (!token) dead = true;
	});

	const deadText =
		'This reset link is invalid, expired or already used. Ask whoever runs this server for a new one.';

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		if (password.length < 8) {
			error = 'Use at least 8 characters.';
			return;
		}
		if (password !== confirm) {
			error = 'The two passwords do not match.';
			return;
		}
		busy = true;
		const res = await authClient.resetPassword({ newPassword: password, token });
		busy = false;
		if (res.error) {
			if (res.error.code === 'INVALID_TOKEN') {
				dead = true;
				token = '';
			} else error = res.error.message ?? 'Could not change the password.';
			return;
		}
		token = '';
		password = confirm = '';
		done = true;
	}
</script>

<svelte:head>
	<title>Reset password</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="wrap">
	<div class="card auth">
		<div>
			<div class="kicker">TMT Build Tracker</div>
			<h1>Reset password</h1>
		</div>
		{#if done}
			<p data-testid="reset-done" role="status">
				Password changed. You are signed out everywhere; sign in with the new password.
			</p>
			<button
				class="btn primary"
				data-testid="reset-to-login"
				onclick={() => goto(resolve('/login'))}>Go to sign in</button
			>
		{:else if dead}
			<div class="error" role="alert" data-testid="reset-dead">{deadText}</div>
			<button class="btn" onclick={() => goto(resolve('/login'))}>Back to sign in</button>
		{:else}
			{#if error}<div class="error" role="alert" data-testid="reset-error">{error}</div>{/if}
			<form class="stack" onsubmit={submit}>
				<label class="field"
					>New password<input
						data-testid="reset-password"
						type={show ? 'text' : 'password'}
						bind:value={password}
						required
						minlength="8"
						autocomplete="new-password"
					/></label
				>
				<label class="field"
					>Repeat new password<input
						data-testid="reset-confirm"
						type={show ? 'text' : 'password'}
						bind:value={confirm}
						required
						minlength="8"
						autocomplete="new-password"
					/></label
				>
				<label class="muted"><input type="checkbox" bind:checked={show} /> Show passwords</label>
				<button class="btn primary" data-testid="reset-submit" disabled={busy || !token}
					>Change password</button
				>
			</form>
		{/if}
	</div>
</div>
