<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const back = $derived(encodeURIComponent(`/invite/${data.invitation.id}`));
</script>

<div class="wrap">
	<div class="card auth">
		<div>
			<div class="kicker">TMT Build Tracker</div>
			<h1>Join {data.invitation.team}</h1>
		</div>
		<p>
			{data.invitation.inviter} invited you to join <b>{data.invitation.team}</b> as
			<b>{data.invitation.role}</b>.
		</p>
		{#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}

		{#if data.invitation.status !== 'pending'}
			<p class="muted">This invitation is {data.invitation.status}.</p>
		{:else if !data.signedIn}
			{#if data.publicMode}
				<p class="muted">
					Sign in with the Google or GitHub account that uses the invited email address.
				</p>
				<a class="btn primary" href={resolve(`/login?redirect=${back}`)}>Sign in</a>
			{:else if data.signup === 'closed'}
				<p class="muted">
					Sign in with the email address that was invited. Sign-up is closed on this server.
				</p>
				<a class="btn primary" href={resolve(`/login?redirect=${back}`)}>Sign in</a>
			{:else}
				<p class="muted">Sign in or create an account with the email address that was invited.</p>
				<a class="btn primary" href={resolve(`/login?redirect=${back}`)}>Sign in</a>
				<a class="btn" href={resolve(`/signup?redirect=${back}`)}>Create account</a>
			{/if}
		{:else if data.needsVerifiedEmail}
			<div class="error" role="alert">
				Your email address is not verified by your sign-in provider, so this invitation cannot be
				accepted.
			</div>
		{:else if data.wrongAccount}
			<div class="error" role="alert">
				You are signed in as {data.userEmail}, but this invitation was sent to a different address.
			</div>
		{:else}
			<form method="post" action="?/accept" use:enhance>
				<button class="btn primary">Accept</button>
			</form>
			<form method="post" action="?/decline" use:enhance>
				<button class="btn">Decline</button>
			</form>
		{/if}
	</div>
</div>
