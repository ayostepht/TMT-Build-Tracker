<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	import VariantChooser from '#lib/components/VariantChooser.svelte';
	import PlateLayoutPicker from '#lib/components/PlateLayoutPicker.svelte';
	import PrinterPicker from '#lib/components/PrinterPicker.svelte';

	let { data, form }: PageProps = $props();
	let templateId = $state('');
	$effect(() => {
		if (!templateId) templateId = data.templates[0]?.id ?? '';
	});
	let choices = $state<Record<string, string>>({});
	$effect(() => {
		void templateId;
		choices = {};
	});
	const template = $derived(data.templates.find((t) => t.id === templateId));
	const designs = $derived(data.designs.filter((d) => d.templateId === templateId));
	const isOwner = $derived(data.role === 'owner');
	const inviteUrl = (id: string) => `${page.url.origin}/invite/${id}`;
</script>

<section class="stack">
	<div class="kicker">{data.team.personal ? 'Personal' : `Chapter (${data.role})`}</div>
	<h1>{data.team.name}</h1>
	{#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}

	<h2>Builds</h2>
	<ul class="tpl-list">
		{#each data.builds as b (b.id)}
			<li class="tpl">
				<h3><a href={resolve('/(app)/builds/[id]', { id: b.id })}>{b.name}</a></h3>
				<div class="counts">
					<span class="set">{b.phase}</span>
					<span class="set">{b.progress}% printed ({b.printed}/{b.total})</span>
					{#if b.deliveryDate}<span class="set">Due {b.deliveryDate}</span>{/if}
				</div>
			</li>
		{:else}
			<li class="muted">No builds yet.</li>
		{/each}
	</ul>

	{#if data.canEdit}
		<form class="card stack" method="post" action="?/newBuild" use:enhance>
			<h3>New build</h3>
			<label class="field">Name<input name="name" required maxlength="200" /></label>
			<label class="field"
				>Template
				<select name="templateId" bind:value={templateId}>
					{#each data.templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
				</select>
			</label>
			<label class="field"
				>Colors
				<select name="designId">
					<option value="">Template defaults</option>
					{#each designs as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
				</select>
			</label>
			{#key templateId}
				<VariantChooser
					groups={template?.variantGroups ?? []}
					{choices}
					partNames={data.partNames}
					fieldPrefix="variant:"
					onselect={(g, o) => (choices = { ...choices, [g]: o })}
				/>
			{/key}
			<fieldset class="card-sub" data-testid="newbuild-printer">
				<legend>Printer (optional)</legend>
				<PrinterPicker name="printer" />
				<p class="muted">
					With a printer, plates are arranged for its bed when the build is created.
				</p>
			</fieldset>
			<PlateLayoutPicker {templateId} />
			<label class="field">Recipient (optional)<input name="recipient" /></label>
			<label class="field">Hospital (optional)<input name="hospital" /></label>
			<label class="field">Delivery date (optional)<input type="date" name="deliveryDate" /></label>
			<button class="btn primary">Create build</button>
		</form>
	{/if}

	{#if data.team.personal}
		<div class="card stack">
			<h2>Want to build with others?</h2>
			<p class="muted">
				Create a chapter and invite people, then move builds into it from the build's settings.
			</p>
			<div>
				<a class="btn primary" href={resolve('/(app)/onboarding')}>Create a chapter</a>
			</div>
		</div>
	{:else}
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
	{/if}
</section>

<style>
	.card-sub {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 10px 12px 12px;
		margin: 0;
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.card-sub legend {
		padding: 0 6px;
		font-size: 13px;
		color: var(--muted);
	}
	.card-sub p {
		margin: 0;
	}
</style>
