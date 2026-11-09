<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { deleteBuild, updateBuild } from '#lib/client/api.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const back = $derived(page.data.backBuild as { id: string; name: string } | null);
	// svelte-ignore state_referenced_locally
	let workspaceId = $state(data.workspaceId ?? '');
	const templates = $derived(data.workspaces.find((w) => w.id === workspaceId)?.templates ?? []);
	let templateId = $state('');
	$effect(() => {
		if (!templates.some((t) => t.id === templateId)) templateId = templates[0]?.id ?? '';
	});
	let creating = $state(false);

	let renaming = $state<string | null>(null);
	let renameText = $state('');
	let confirmDelete = $state<{ id: string; name: string } | null>(null);
	let error = $state('');

	async function rename(id: string) {
		const name = renameText.trim();
		if (!name) return;
		error = '';
		try {
			await updateBuild(id, { name });
			renaming = null;
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not rename';
		}
	}

	async function remove() {
		if (!confirmDelete) return;
		error = '';
		try {
			await deleteBuild(confirmDelete.id);
			confirmDelete = null;
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not delete';
			confirmDelete = null;
		}
	}

	const ago = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
</script>

<svelte:head><title>Studio · TMT Build Tracker</title></svelte:head>

<section class="stack">
	{#if back}
		<p>
			<a
				class="btn ghost sm back"
				href={resolve('/(app)/builds/[id]', { id: back.id })}
				data-testid="back-to-build-link"
				><span class="btn-arrow" aria-hidden="true">←</span> Back to {back.name}</a
			>
		</p>
	{/if}
	<div class="top">
		<div class="titles">
			<div class="kicker">Studio</div>
			<h1>Play with designs, no build needed</h1>
			<p class="muted lead">
				A draft is a scratch copy of the kit: recolor it, change options, generate plates for your
				printer and export a 3MF. Nothing is tracked, and drafts stay out of your build lists. When
				you like one, make it a build.
			</p>
		</div>
		{#if data.workspaces.length && !creating}
			<button
				class="btn primary newbtn"
				type="button"
				data-testid="new-draft"
				onclick={() => (creating = true)}>New draft</button
			>
		{/if}
	</div>

	{#if error}<div class="error" role="alert">{error}</div>{/if}

	{#if !data.workspaces.length}
		<div class="banner" role="note">
			You have view-only access everywhere, so you cannot start a draft.
		</div>
	{:else if creating}
		<form
			class="card stack narrow"
			method="post"
			action="?/create"
			use:enhance
			data-testid="new-draft-form"
		>
			<h2>New draft</h2>
			{#if form?.error}<div class="error" role="alert">{form.error}</div>{/if}
			<label class="field"
				>Name (optional)<input name="name" maxlength="200" placeholder="Draft name" /></label
			>
			{#if data.workspaces.length > 1}
				<label class="field"
					>Keep it in
					<select name="organizationId" bind:value={workspaceId}>
						{#each data.workspaces as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
					</select>
				</label>
			{:else}
				<input type="hidden" name="organizationId" value={workspaceId} />
			{/if}
			<label class="field"
				>Template
				<select name="templateId" bind:value={templateId} required>
					{#each templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
				</select>
			</label>
			<div class="acts">
				<button class="btn primary" data-testid="create-draft">Create draft</button>
				<button class="btn" type="button" onclick={() => (creating = false)}>Cancel</button>
			</div>
		</form>
	{/if}

	<h2>Your drafts</h2>
	<ul class="grid" aria-label="Drafts">
		{#each data.drafts as d (d.id)}
			<li class="card draft" data-draft={d.name}>
				{#if d.colors.length}
					<a
						class="swatches"
						href={resolve('/(app)/builds/[id]/design', { id: d.id })}
						tabindex="-1"
						aria-hidden="true"
					>
						{#each d.colors as c, i (i)}<span style="background:{c}"></span>{/each}
					</a>
				{/if}
				{#if renaming === d.id}
					<form
						class="acts"
						onsubmit={(e) => {
							e.preventDefault();
							void rename(d.id);
						}}
					>
						<input aria-label="Draft name" bind:value={renameText} maxlength="200" required />
						<button class="btn sm primary">Save</button>
						<button class="btn sm" type="button" onclick={() => (renaming = null)}>Cancel</button>
					</form>
				{:else}
					<h3>
						<a href={resolve('/(app)/builds/[id]/design', { id: d.id })} data-testid="open-draft"
							>{d.name}</a
						>
					</h3>
				{/if}
				<div class="muted">{d.templateName} · {d.workspace} · updated {ago(d.updated)}</div>
				<div class="acts">
					<a class="btn sm primary" href={resolve('/(app)/builds/[id]/design', { id: d.id })}
						>Open</a
					>
					<button
						class="btn sm"
						type="button"
						onclick={() => ((renaming = d.id), (renameText = d.name))}>Rename</button
					>
					<button
						class="btn sm danger"
						type="button"
						data-testid="delete-draft"
						onclick={() => (confirmDelete = { id: d.id, name: d.name })}>Delete</button
					>
				</div>
			</li>
		{:else}
			<li class="muted">No drafts yet. Start one with New draft.</li>
		{/each}
	</ul>

	<div class="shared">
		<div class="shead">
			<h2>Shared designs</h2>
			<a class="btn sm go" href={resolve('/(app)/designs')} data-testid="browse-designs"
				>Browse the design gallery <span class="btn-arrow" aria-hidden="true">→</span></a
			>
		</div>
		<p class="muted">
			Open a design and choose Use this design to start a build from it, or to copy its colors into
			a build or draft you already have.
		</p>
		{#if data.gallery.length}
			<ul class="strip6" aria-label="Recent designs">
				{#each data.gallery as g (g.id)}
					<li>
						<a href={resolve('/(app)/designs/[slug]', { slug: g.slug })}>
							<span class="gthumb">
								{#if g.hasSnapshot}
									<img src="/api/designs/{g.id}/snapshot.png" alt="" loading="lazy" />
								{:else}
									<span class="swatches">
										{#each g.colors as c, i (i)}<span style="background:{c}"></span>{/each}
									</span>
								{/if}
							</span>
							<span class="gname">{g.name}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

{#if confirmDelete}
	<div class="backdrop" role="presentation">
		<div
			class="dialog card"
			role="alertdialog"
			aria-labelledby="delDraft"
			data-testid="delete-dialog"
		>
			<strong id="delDraft">Delete the draft "{confirmDelete.name}"?</strong>
			<p class="muted">Its colors, plates and uploaded files are removed. This cannot be undone.</p>
			<div class="acts">
				<button class="btn danger solid" type="button" onclick={remove} data-testid="confirm-delete"
					>Delete draft</button
				>
				<button class="btn" type="button" onclick={() => (confirmDelete = null)}>Cancel</button>
			</div>
		</div>
	</div>
{/if}

<style>
	section.stack {
		display: grid;
		gap: 16px;
	}
	h1,
	h2,
	h3,
	p {
		margin: 0;
	}
	.top {
		display: flex;
		gap: 16px;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.titles {
		display: grid;
		gap: 6px;
		flex: 1 1 320px;
		min-width: 0;
	}
	.lead {
		max-width: 68ch;
	}
	.newbtn {
		min-height: 44px;
		padding-inline: 24px;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.acts .btn {
		display: inline-flex;
		align-items: center;
	}
	.acts input {
		flex: 1 1 160px;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		color: var(--ink);
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 14px;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	}
	.draft {
		display: grid;
		gap: 8px;
		align-content: start;
	}
	.swatches {
		display: flex;
		height: 72px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--line);
	}
	.swatches span {
		flex: 1;
	}
	.shared {
		display: grid;
		gap: 10px;
		margin-top: 8px;
	}
	.shead {
		display: flex;
		gap: 12px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.strip6 {
		list-style: none;
		margin: 0;
		padding: 0 0 4px;
		display: flex;
		gap: 12px;
		overflow-x: auto;
	}
	.strip6 li {
		flex: 0 0 160px;
	}
	.strip6 a {
		display: grid;
		gap: 6px;
		text-decoration: none;
		color: var(--ink);
	}
	.gthumb {
		display: block;
		aspect-ratio: 4 / 3;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--line);
		background: var(--card);
	}
	.gthumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.gthumb .swatches {
		height: 100%;
		border: 0;
		border-radius: 0;
	}
	.gname {
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.45);
		display: grid;
		place-items: center;
		padding: 16px;
		z-index: 50;
	}
	.dialog {
		max-width: 420px;
		display: grid;
		gap: 10px;
	}
</style>
