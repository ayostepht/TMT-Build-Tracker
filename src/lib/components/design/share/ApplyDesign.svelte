<script lang="ts">
	import { focusIn } from '#lib/client/focus.ts';
	import {
		applyDesign,
		listDesigns,
		previewApplyDesign,
		type DesignListItem
	} from '#lib/client/api.ts';
	import { offerDesignUndo } from '#lib/client/design-undo.ts';
	import { designSnapshot, type ApplyMode } from '#lib/domain/design-apply.ts';
	import StartedApplyDialog from './StartedApplyDialog.svelte';
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
	/** The build has started printing: ask how to apply (colors only or also print files) first. */
	let asking = $state(false);

	$effect(() => {
		const tpl = ctx.view.build.templateId;
		let live = true;
		listDesigns(tpl)
			.then((j) => live && (items = j.designs))
			.catch((e) => live && (error = e instanceof Error ? e.message : 'Could not load designs.'));
		return () => (live = false);
	});

	const design = $derived(items?.find((d) => d.id === chosen));

	/** Started build: apply in the chosen mode; errors go back to the dialog, which stays open. */
	async function applyStarted(mode: ApplyMode) {
		if (!design) return;
		const name = design.name;
		const before = designSnapshot(ctx.view);
		ctx.error = null;
		const r = await applyDesign(design.id, ctx.id, {
			mode,
			...(mode === 'full' ? { confirm: true } : {})
		});
		await ctx.refresh();
		const left = r.skipped?.length ?? 0;
		offerDesignUndo(
			mode === 'full'
				? `Applied design "${name}" (colors and print files)`
				: `Applied the colors of "${name}"${left ? `; ${left} ${left === 1 ? 'slot' : 'slots'} left as they were` : ''}`,
			ctx.id,
			before,
			() => ctx.refresh()
		);
		asking = false;
		ondone();
	}

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
		<button
			type="button"
			class="btn primary"
			disabled={!design}
			onclick={() => (ctx.view.started.started ? (asking = true) : (confirming = true))}
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
				if (e.key === 'Escape') {
					// Always swallow Escape here: the native <dialog> around this would otherwise close.
					e.preventDefault();
					e.stopPropagation();
					if (busy) return;
					confirming = false;
				}
			}}
		>
			<p>
				<b>Apply "{design?.name}" to this build?</b>
			</p>
			<p class="muted">
				This replaces the color of every slot and which slot each part uses. Plates that are already
				arranged are re-arranged for the new colors.
			</p>
			<div class="apply-actions">
				<button type="button" class="btn primary" disabled={busy} onclick={apply}
					>{busy ? 'Applying…' : 'Replace colors'}</button
				>
				<button type="button" class="btn" disabled={busy} onclick={() => (confirming = false)}
					>Back</button
				>
			</div>
		</div>
	{/if}

	{#if asking && design}
		<StartedApplyDialog
			load={() => previewApplyDesign(design.id, ctx.id)}
			onchoose={applyStarted}
			oncancel={() => (asking = false)}
		/>
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
	.apply-actions {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	.confirm {
		display: grid;
		gap: var(--sp-5);
	}
</style>
