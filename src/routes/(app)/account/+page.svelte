<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import { clearPrivateCaches } from '#lib/client/pwa.ts';
	import Dialog from '#lib/components/design/share/Dialog.svelte';
	import AdminPicker from './AdminPicker.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let open = $state(false);
	let typed = $state('');
	let busy = $state(false);

	const blocked = $derived(data.blockedChapters.length > 0 || data.siteBlock !== null);
	const ready = $derived(
		typed.trim().toLowerCase() === data.email.trim().toLowerCase() &&
			!blocked &&
			!data.needsRecentSignIn
	);

	function close() {
		open = false;
		typed = '';
	}

	async function signInAgain() {
		await authClient.signOut();
		await clearPrivateCaches().catch(() => {});
		await invalidateAll();
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(resolve('/login') + '?redirect=' + encodeURIComponent('/account'));
	}
</script>

<svelte:head><title>Account · TMT Build Tracker</title></svelte:head>

<section class="stack narrow acct-page">
	<div class="kicker">Account</div>
	<h1>{data.name}</h1>
	<p class="muted">{data.email}</p>
	<p class="muted"><small>People in a chapter can see each other's name and email.</small></p>

	<div class="card stack">
		<h2>Export my data</h2>
		<p class="muted">
			One JSON file with your profile, your chapters, your saved designs and the builds in My
			builds. Photos are listed by file name only.
		</p>
		<div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="btn" href="/api/account/export" download data-testid="export-data"
				>Download my data</a
			>
		</div>
	</div>

	{#if data.isAdmin}
		<div class="card stack" data-testid="site-admins">
			<h2>Site admins</h2>
			<p class="muted">
				Site admins manage the kit and who else is an admin. Admins set by the server configuration
				cannot be changed here. If ADMIN_EMAILS names someone who has no account yet, the first
				account stays admin until they sign up. On a self-hosted server, an address in ADMIN_EMAILS
				becomes an admin as soon as someone registers it, so register it first.
			</p>
			<ul class="acct-list admins">
				{#each data.siteAdmins as a (a.id)}
					<li class="admin-row">
						<span
							><b>{a.name}</b> <span class="muted">{a.email}</span>
							<small class="muted"
								>{a.source === 'config'
									? 'set by the server configuration'
									: a.source === 'first'
										? 'first account'
										: 'granted'}</small
							></span
						>
						{#if a.source === 'granted'}
							<form method="post" action="?/revoke" use:enhance>
								<input type="hidden" name="userId" value={a.id} />
								<button class="btn sm" data-testid="revoke-admin">Remove</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
			{#if !open}<AdminPicker error={form?.adminError ?? ''} />{/if}
		</div>
	{/if}

	<div class="card danger-zone stack" data-testid="delete-account-card">
		<h2>Delete my account</h2>
		<p class="muted">
			This removes your sign-in and everything in My builds, including its builds, drafts, photos,
			saved designs and custom filaments. It cannot be undone.
		</p>
		{#if data.siteBlock}
			<div class="error" role="alert" data-testid="delete-site-block-card">
				{data.siteBlockMessage}
			</div>
		{/if}
		{#if data.blockedChapters.length}
			<div class="error" role="alert" data-testid="delete-blocked">
				{#each data.blockedChapters as c (c)}
					<div>Make someone else an owner of {c} first</div>
				{/each}
			</div>
		{/if}
		<div>
			<button
				class="btn danger"
				type="button"
				data-testid="delete-account-open"
				onclick={() => (open = true)}>Delete my account…</button
			>
		</div>
	</div>
</section>

{#if open}
	<Dialog title="Delete my account" onclose={close} testid="delete-account-dialog" danger>
		{#if data.siteBlock === 'last_admin'}
			<div class="stack acct-form" data-testid="handover">
				<div class="error" role="alert" data-testid="delete-site-block">
					You are the only site admin. Choose someone to take over before deleting your account.
				</div>
				<AdminPicker error={form?.adminError ?? ''} />
				<div class="acct-actions">
					<button class="btn" type="button" data-cancel onclick={close}>Cancel</button>
				</div>
			</div>
		{:else}
			<form
				class="stack acct-form"
				method="post"
				action="?/delete"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						await clearPrivateCaches().catch(() => {});
						await update({ reset: false });
						busy = false;
					};
				}}
			>
				<ul class="acct-list">
					<li>
						Deleted for good: My builds ({data.personalBuilds}
						{data.personalBuilds === 1 ? 'build' : 'builds'}), your saved designs and your custom
						filaments.
					</li>
					{#each data.deletedChapters as c (c)}
						<li>Deleted with you, because you are its only member: {c}.</li>
					{/each}
					{#each data.leftChapters as c (c)}
						<li>You leave {c}. Builds you made there stay with the chapter.</li>
					{/each}
				</ul>

				{#if data.siteBlock}
					<div class="error" role="alert" data-testid="delete-site-block">
						{data.siteBlockMessage}
					</div>
				{/if}
				{#if data.blockedChapters.length}
					<div class="error" role="alert">
						{#each data.blockedChapters as c (c)}<div>
								Make someone else an owner of {c} first
							</div>{/each}
					</div>
				{/if}
				{#if form?.error}<div class="error" role="alert" data-testid="delete-error">
						{form.error}
					</div>{/if}

				{#if data.needsRecentSignIn}
					<p class="muted">
						For your safety, sign in again first. You then have 10 minutes to delete your account.
					</p>
					<div>
						<button class="btn primary" type="button" onclick={signInAgain}>Sign in again</button>
					</div>
				{:else}
					<label class="field"
						>Type your email ({data.email}) to confirm
						<input
							name="email"
							type="email"
							bind:value={typed}
							autocomplete="off"
							required
							data-testid="delete-confirm-email"
						/></label
					>
					{#if data.usesPassword}
						<label class="field"
							>Password
							<input
								name="password"
								type="password"
								autocomplete="current-password"
								required
								data-testid="delete-password"
							/></label
						>
					{/if}
					<div class="acct-actions">
						<button
							class="btn danger solid"
							disabled={!ready || busy}
							data-testid="delete-account-confirm">Delete forever</button
						>
						<button class="btn" type="button" data-cancel onclick={close}>Cancel</button>
					</div>
				{/if}
			</form>
		{/if}
	</Dialog>
{/if}

<style>
	.acct-page {
		display: grid;
		gap: 16px;
	}
	.acct-list {
		margin: 0;
		padding-left: 18px;
		display: grid;
		gap: 6px;
		font-size: var(--fs-md);
	}
	.admins {
		list-style: none;
		padding: 0;
	}
	.admin-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.acct-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.acct-form input {
		font-size: var(--fs-field);
	}
</style>
