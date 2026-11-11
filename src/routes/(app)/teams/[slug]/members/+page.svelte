<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Dialog from '#lib/components/design/share/Dialog.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const isOwner = $derived(data.role === 'owner');
	const inviteUrl = (id: string) => `${page.url.origin}/invite/${id}`;

	/** Member being removed: asked about in a dialog, not a browser confirm(). */
	let removing = $state<{ id: string; name: string } | null>(null);

	/** Which invite link was just copied ("Copied" confirmation); a failed copy leaves the field selected. */
	let copied = $state<string | null>(null);
	let pendingLinks = $state<Record<string, HTMLInputElement | null>>({});
	let newLink = $state<HTMLInputElement | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;
	async function copyLink(id: string, input: HTMLInputElement | null) {
		try {
			await navigator.clipboard.writeText(inviteUrl(id));
			copied = id;
			clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = null), 2500);
		} catch {
			// No clipboard access (plain http, permissions): select the link so it can be copied by hand.
			input?.focus();
			input?.select();
		}
	}
</script>

<svelte:head><title>Members · {data.team.name}</title></svelte:head>

{#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}

<h2>Members</h2>
<ul class="tpl-list">
	{#each data.members as m (m.id)}
		<li class="ds-card ds-card--compact" data-testid="member-row">
			<b>{m.name}</b> <span class="muted">{m.email}</span>
			{#if isOwner}
				<form method="post" action="?/setRole" use:enhance>
					<input type="hidden" name="memberId" value={m.id} />
					<select
						name="role"
						value={m.role}
						aria-label="Role of {m.name}"
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					>
						<option value="owner">owner</option>
						<option value="editor">editor</option>
						<option value="viewer">viewer</option>
					</select>
				</form>
				<button
					class="btn"
					type="button"
					data-testid="remove-member"
					onclick={() => (removing = { id: m.id, name: m.name })}>Remove</button
				>
			{:else}
				<span class="ds-badge ds-badge--sm">{m.role}</span>
			{/if}
		</li>
	{/each}
</ul>

{#if isOwner}
	<h2>Invite</h2>
	{#if form?.invited}
		<div class="card stack" data-testid="invite-created">
			<span>Invitation for {form.invited.email}. Share this link:</span>
			<div class="mem-link">
				<input
					bind:this={newLink}
					readonly
					aria-label="Invite link"
					value={inviteUrl(form.invited.id)}
					onfocus={(e) => e.currentTarget.select()}
				/>
				<button
					class="btn"
					type="button"
					data-testid="copy-invite"
					onclick={() => copyLink(form.invited!.id, newLink)}
					>{copied === form.invited.id ? 'Copied' : 'Copy link'}</button
				>
			</div>
		</div>
	{/if}
	<form class="card stack" method="post" action="?/invite" use:enhance>
		<label class="field">Email<input type="email" name="email" required /></label>
		<label class="field"
			>Role
			<select name="role">
				<option value="editor" selected>editor</option>
				<option value="viewer">viewer</option>
			</select>
		</label>
		<button class="btn primary">Create invite link</button>
	</form>
	{#if data.invites.length}
		<h3>Pending invitations</h3>
		<ul class="tpl-list">
			{#each data.invites as i (i.id)}
				<li class="ds-card ds-card--compact">
					{i.email} ({i.role})
					<div class="mem-link">
						<input
							bind:this={pendingLinks[i.id]}
							readonly
							aria-label="Invite link for {i.email}"
							value={inviteUrl(i.id)}
							onfocus={(e) => e.currentTarget.select()}
						/>
						<button
							class="btn"
							type="button"
							data-testid="copy-pending-invite"
							onclick={() => copyLink(i.id, pendingLinks[i.id] ?? null)}
							>{copied === i.id ? 'Copied' : 'Copy link'}</button
						>
					</div>
					<form method="post" action="?/revoke" use:enhance>
						<input type="hidden" name="id" value={i.id} />
						<button class="btn">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

{#if removing}
	{@const who = removing}
	<Dialog
		title="Remove {who.name}?"
		onclose={() => (removing = null)}
		testid="remove-member-dialog"
	>
		<p>
			{who.name} will lose access to this chapter's builds and printers. Their print history stays.
		</p>
		<form
			class="mem-actions"
			method="post"
			action="?/remove"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					removing = null;
				};
			}}
		>
			<input type="hidden" name="memberId" value={who.id} />
			<button class="btn" type="button" onclick={() => (removing = null)}>Cancel</button>
			<button class="btn primary" data-testid="confirm-remove-member">Remove member</button>
		</form>
	</Dialog>
{/if}

<style>
	.mem-link {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.mem-link input {
		flex: 1 1 220px;
		min-width: 0;
	}
	.mem-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
</style>
