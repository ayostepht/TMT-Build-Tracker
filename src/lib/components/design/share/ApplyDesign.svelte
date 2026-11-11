<script lang="ts">
	import { focusIn } from '#lib/client/focus-trap.ts';
	import { applyDesign, listDesigns, type DesignListItem } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import Swatch from '#lib/components/Swatch.svelte';
	import { toasts } from '#lib/components/toast.svelte.ts';

	let { ondone }: { ondone: () => void } = $props();
	const ctx = getBuildCtx();

	let items = $state<DesignListItem[] | null>(null);
	let error = $state<string | null>(null);
	let chosen = $state('');
	let confirming = $state(false);
	let busy = $state(false);

	$effect(() => {
		const tpl = ctx.view.build.templateId;
		let live = true;
		listDesigns(tpl)
			.then((j) => live && (items = j.designs))
			.catch((e) => live && (error = e instanceof Error ? e.message : 'Could not load designs.'));
		return () => (live = false);
	});

	const design = $derived(items?.find((d) => d.id === chosen));

	async function apply() {
		if (!design) return;
		busy = true;
		const name = design.name;
		const ok = await ctx.act(() => applyDesign(design.id, ctx.id));
		busy = false;
		if (ok) {
			toasts.push(`Applied design "${name}"`);
			ondone();
		} else {
			confirming = false;
		}
	}
</script>

<div class="apply" data-testid="apply-design">
	{#if error}
		<div class="error" role="alert">{error}</div>
	{:else if !items}
		<p class="muted">Loading saved designs…</p>
	{:else if !items.length}
		<p class="muted">
			No saved or shared designs fit this kit yet. Save this one to reuse it later.
		</p>
	{:else if !confirming}
		<label class="field">
			Saved or shared design
			<select bind:value={chosen} data-testid="apply-design-select">
				<option value="">Choose a design…</option>
				{#each items as d (d.id)}
					<option value={d.id}>{d.name}{d.mine ? ' (mine)' : ''}</option>
				{/each}
			</select>
		</label>
		{#if design}
			<span class="strip" aria-hidden="true">
				{#each design.roles as r (r.key)}<Swatch hex={r.hex} size="mini" />{/each}
			</span>
		{/if}
		{#if ctx.error}<div class="error" role="alert">{ctx.error}</div>{/if}
		<button type="button" class="btn primary" disabled={!design} onclick={() => (confirming = true)}
			>Apply this design…</button
		>
	{:else}
		<div
			class="confirm"
			role="alertdialog"
			aria-label="Confirm applying the design"
			tabindex="-1"
			use:focusIn={'button:not(.primary)'}
			onkeydown={(e) => {
				if (e.key === 'Escape' && !busy) {
					e.stopPropagation();
					confirming = false;
				}
			}}
		>
			<p>
				<b>Apply "{design?.name}" to this build?</b>
			</p>
			<p class="muted">
				This replaces the color of every slot and which slot each part uses. Your print progress,
				plates and logged runs are kept.
			</p>
			<div class="row">
				<button type="button" class="btn primary" disabled={busy} onclick={apply}
					>{busy ? 'Applying…' : 'Replace colors'}</button
				>
				<button type="button" class="btn" disabled={busy} onclick={() => (confirming = false)}
					>Back</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	.apply {
		display: grid;
		gap: var(--sp-6);
	}
	p {
		margin: 0;
	}
	.strip {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}
	.row {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	.confirm {
		display: grid;
		gap: var(--sp-5);
	}
</style>
