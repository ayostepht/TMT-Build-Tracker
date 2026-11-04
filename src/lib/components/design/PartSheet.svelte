<script lang="ts">
	import { resolve } from '$app/paths';
	import { filamentLabel } from '#lib/domain/labels.ts';
	import { fmt, roleOptions, symmetryPeers } from '#lib/domain/index.ts';
	import type { BuildView, PartDef } from '#lib/domain/types.ts';
	import Swatch from '#lib/components/Swatch.svelte';

	let {
		view,
		part,
		bothSides = $bindable(true),
		noPreview = false,
		onmove,
		onclose
	}: {
		view: BuildView;
		part: PartDef;
		bothSides?: boolean;
		noPreview?: boolean;
		onmove: (role: string) => void;
		onclose: () => void;
	} = $props();

	const options = $derived(roleOptions(part, view.filaments));
	const current = $derived(view.filaments.find((f) => f.key === part.role));
	const peers = $derived(symmetryPeers(view, part.slug).filter((p) => p.slug !== part.slug));
	const inactive = $derived(!view.parts.some((p) => p.slug === part.slug));
</script>

<section class="sheet" aria-label="Part: {part.name}" data-testid="part-sheet">
	<header>
		<div>
			<div class="kicker">{part.section}</div>
			<h3>{part.name}</h3>
		</div>
		<button type="button" class="btn sm" onclick={onclose} aria-label="Close part details">
			<span aria-hidden="true">×</span> Close
		</button>
	</header>
	<p class="now">
		{#if current}<Swatch hex={current.hex} tpu={current.tpu} size="mini" />{/if}
		<span>In slot <b>{filamentLabel(current, part.role)}</b></span>
		{#if part.bomGrams}<span class="muted">· about {fmt(part.bomGrams)} g</span>{/if}
	</p>
	{#if noPreview}<p class="muted">This part has no 3D preview. Its color still counts.</p>{/if}
	{#if inactive}
		<p class="muted">
			Not used by this build's current options, so it is hidden in 3D and left out of the totals.
		</p>
	{/if}
	{#if part.allowedMaterials.length}
		<p class="muted">Prints in {part.allowedMaterials.join(' or ')}.</p>
	{/if}

	{#if view.canEdit}
		{#if peers.length}
			<label class="both">
				<input type="checkbox" bind:checked={bothSides} />
				Apply to both sides ({peers.map((p) => p.name).join(', ')})
			</label>
		{/if}
		<div class="opts" role="group" aria-label="Move to a slot">
			{#each options as o (o.filament.key)}
				<div class="opt">
					<button
						type="button"
						class="slotbtn"
						class:cur={o.filament.key === part.role}
						disabled={!o.ok}
						aria-pressed={o.filament.key === part.role}
						data-role={o.filament.key}
						onclick={() => onmove(o.filament.key)}
					>
						<Swatch hex={o.filament.hex} tpu={o.filament.tpu} />
						<span class="txt">
							<b>{filamentLabel(o.filament, o.filament.key)}</b>
							<span class="muted">{o.filament.material}</span>
						</span>
					</button>
					{#if o.reason}<span class="why">{o.reason}</span>{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="muted">You have view-only access, so colors cannot be changed.</p>
	{/if}
	{#if part.guideRefs.length}
		<p class="muted">
			Guide: {part.guideRefs.map((g) => `p. ${g.page}`).join(', ')}
			· <a href={resolve('/(app)/builds/[id]/print', { id: view.build.id })}>Open Print tab</a>
		</p>
	{/if}
</section>

<style>
	.sheet {
		background: var(--card);
		border: 1px solid var(--accent);
		border-radius: 10px;
		padding: 12px 14px;
		display: grid;
		gap: 8px;
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: start;
	}
	h3,
	p {
		margin: 0;
	}
	.now {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.both {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 14px;
	}
	.opts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 8px;
	}
	.opt {
		display: grid;
		gap: 2px;
		align-content: start;
	}
	.slotbtn {
		display: flex;
		gap: 8px;
		align-items: center;
		text-align: left;
		padding: 8px 10px;
		min-height: 44px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		cursor: pointer;
	}
	.slotbtn:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.slotbtn.cur {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.slotbtn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.txt {
		display: grid;
		min-width: 0;
	}
	.why {
		font-size: 12px;
		color: var(--warn);
	}
</style>
