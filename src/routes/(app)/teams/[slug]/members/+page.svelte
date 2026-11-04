<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const isOwner = $derived(data.role === 'owner');
	const inviteUrl = (id: string) => `${page.url.origin}/invite/${id}`;
</script>

<svelte:head><title>Members · {data.team.name}</title></svelte:head>

{#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}

<h2>Members</h2>
<ul class="tpl-list">
	{#each data.members as m (m.id)}
		<li class="tpl">
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
				<form method="post" action="?/remove" use:enhance>
					<input type="hidden" name="memberId" value={m.id} />
					<button class="btn">Remove</button>
				</form>
			{:else}
				<span class="set">{m.role}</span>
			{/if}
		</li>
	{/each}
</ul>

{#if isOwner}
	<h2>Invite</h2>
	{#if form?.invited}
		<div class="card">
			Invitation for {form.invited.email}. Share this link:
			<input
				readonly
				value={inviteUrl(form.invited.id)}
				onfocus={(e) => e.currentTarget.select()}
			/>
		</div>
	{/if}
	<form class="card stack" method="post" action="?/invite" use:enhance>
		<label class="field">Email<input type="email" name="email" required /></label>
		<label class="field"
			>Role
			<select name="role">
				<option value="viewer">viewer</option>
				<option value="editor">editor</option>
			</select>
		</label>
		<button class="btn primary">Create invite link</button>
	</form>
	{#if data.invites.length}
		<h3>Pending invitations</h3>
		<ul class="tpl-list">
			{#each data.invites as i (i.id)}
				<li class="tpl">
					{i.email} ({i.role})
					<input readonly value={inviteUrl(i.id)} onfocus={(e) => e.currentTarget.select()} />
					<form method="post" action="?/revoke" use:enhance>
						<input type="hidden" name="id" value={i.id} />
						<button class="btn">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
