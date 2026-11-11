<script lang="ts">
	import { inlineConfirm } from '#lib/client/focus-trap.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { deleteBuild, updateBuild } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	const ctx = getBuildCtx();
	const b = $derived(ctx.view.build);
	let name = $derived(b.name);
	let saved = $state('');
	let confirming = $state(false);
	let trigger = $state<HTMLButtonElement>();

	async function save(e: SubmitEvent) {
		e.preventDefault();
		const ok = await ctx.act(() => updateBuild(ctx.id, { name: name.trim() || b.name }));
		saved = ok ? 'Saved' : '';
		setTimeout(() => (saved = ''), 2000);
	}

	async function remove() {
		if (await ctx.act(() => deleteBuild(ctx.id))) await goto(resolve('/(app)/studio'));
	}

	const printer = $derived(ctx.view.printer);
</script>

<form class="card" onsubmit={save} data-testid="draft-settings">
	<h2>Draft name</h2>
	<label class="field">Name <input bind:value={name} disabled={!ctx.canEdit} required /></label>
	{#if ctx.canEdit}
		<div>
			<button class="btn primary" type="submit">Save name</button>
			<span class="muted" role="status">{saved}</span>
		</div>
	{/if}
</form>

<section class="card">
	<h2>Printer and plate layout</h2>
	<p class="muted" data-testid="draft-printer-summary">
		{#if printer}
			Planned for {printer.name} ({printer.bedX} × {printer.bedY} mm).
		{:else}
			No printer chosen yet.
		{/if}
		{ctx.view.plates.length} plates.
	</p>
	<div>
		<a class="btn" href={resolve('/(app)/builds/[id]/files', { id: ctx.id })}
			>Change printer or layout</a
		>
	</div>
</section>

{#if ctx.canEdit}
	<section class="card danger-zone">
		<h2>Delete draft</h2>
		<p class="muted">
			Deletes this draft with its colors, plates and uploaded files. This cannot be undone.
		</p>
		{#if !confirming}
			<div>
				<button
					class="btn danger"
					type="button"
					data-testid="delete-draft-settings"
					bind:this={trigger}
					onclick={() => (confirming = true)}>Delete this draft…</button
				>
			</div>
		{:else}
			<div
				role="alertdialog"
				aria-labelledby="delTitle"
				tabindex="-1"
				use:inlineConfirm={{
					initial: 'button:not(.danger)',
					oncancel: () => (confirming = false),
					returnTo: () => trigger
				}}
				style="display:grid;gap:10px"
			>
				<strong id="delTitle">Delete "{b.name}" for good?</strong>
				<div>
					<button class="btn danger solid" type="button" onclick={remove}>Delete draft</button>
					<button class="btn" type="button" onclick={() => (confirming = false)}>Cancel</button>
				</div>
			</div>
		{/if}
	</section>
{/if}
