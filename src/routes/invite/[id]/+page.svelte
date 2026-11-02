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
			<p class="muted">Sign in or create an account with the email address that was invited.</p>
			<a class="btn primary" href={resolve(`/login?redirect=${back}`)}>Sign in</a>
			<a class="btn" href={resolve(`/signup?redirect=${back}`)}>Create account</a>
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
