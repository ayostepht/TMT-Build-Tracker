<script lang="ts">
	import { resolve } from '$app/paths';
	import { roleLabel, sortRoles } from '#lib/domain/labels.ts';
	import { roleOptions, symmetryPeers } from '#lib/domain/index.ts';
	import type { BuildView, PartDef } from '#lib/domain/types.ts';
	import Swatch from '#lib/components/Swatch.svelte';

	/**
	 * The selected part, as a compact floating chip with a slot-swatch strip. Mounted over the
	 * bottom of the 3D stage, so it never moves the pinned stage, the tabs or the list.
	 */
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
	const slotName = $derived(roleLabel(part.role, current));
	const guide = $derived(part.guideRefs.map((g) => `p. ${g.page}`).join(', '));
	const mats = $derived(part.allowedMaterials.join(' or '));
	const limited = $derived(options.some((o) => !o.ok));
</script>

<section class="sheet" aria-label="Part: {part.name}" data-testid="part-sheet">
	<div class="cardtop">
		{#if current}<Swatch hex={current.hex} tpu={current.tpu} size="mini" />{/if}
		<span class="title" title="{part.name} · {slotName}">
			<b>{part.name}</b><span class="muted">&nbsp;· {slotName}</span>
		</span>
		{#if limited}<span class="only" title="{part.name} needs {mats}">{mats} only</span>{/if}
		{#if view.canEdit && peers.length}
			<label class="both" title="Apply to both sides ({peers.map((p) => p.name).join(', ')})">
				<input
					type="checkbox"
					bind:checked={bothSides}
					aria-label="Apply to both sides ({peers.map((p) => p.name).join(', ')})"
				/>
				<span><span class="wide">Both sides</span><span class="narrow">Both</span></span>
			</label>
		{/if}
		{#if part.guideRefs.length}
			<a
				class="pill-link guide"
				href={resolve('/(app)/builds/[id]/print', { id: view.build.id })}
				title="Open the Print tab (guide {guide})"><span class="wide">Guide </span>{guide}</a
			>
		{/if}
		<button type="button" class="x" onclick={onclose} aria-label="Close part details">
			<span aria-hidden="true">×</span>
		</button>
	</div>
	{#if noPreview || inactive}
		<p class="note muted">
			{#if noPreview}No 3D preview for this part. Its color still counts.{/if}
			{#if inactive}Not used by the current options, so it is hidden in 3D and left out of the
				totals.{/if}
		</p>
	{/if}
	{#if view.canEdit}
		<div class="opts" role="group" aria-label="Move to a slot">
			{#each sortRoles(options, (x) => x.filament.key) as o (o.filament.key)}
				<button
					type="button"
					class="slotbtn"
					class:cur={o.filament.key === part.role}
					disabled={!o.ok}
					aria-pressed={o.filament.key === part.role}
					data-role={o.filament.key}
					title={o.reason ?? undefined}
					onclick={() => onmove(o.filament.key)}
				>
					<span class="lab">
						<Swatch hex={o.filament.hex} tpu={o.filament.tpu} size="mini" />
						<span class="rl">{roleLabel(o.filament.key, o.filament)}</span>
					</span>
				</button>
			{/each}
		</div>
	{:else}
		<p class="note muted">View-only access: colors cannot be changed.</p>
	{/if}
</section>

<style>
	.sheet {
		background: var(--card);
		border: 1px solid var(--accent);
		border-radius: var(--r-lg);
		padding: var(--sp-3) var(--sp-3);
		display: grid;
		gap: var(--sp-3);
		box-shadow: var(--shadow-1);
		max-width: 100%;
		box-sizing: border-box;
	}
	.cardtop {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		min-width: 0;
	}
	.title {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-md);
	}
	.both {
		display: flex;
		gap: var(--sp-2);
		align-items: center;
		font-size: var(--fs-sm);
		flex: none;
		min-height: 32px;
		cursor: pointer;
	}
	.guide {
		flex: none;
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	.x {
		flex: none;
		width: 32px;
		height: 32px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: var(--paper);
		color: var(--ink);
		font: 600 var(--fs-lg)/1 var(--f-body);
		cursor: pointer;
		padding: 0;
	}
	.x:hover {
		border-color: var(--accent);
	}
	.note {
		margin: 0;
		font-size: var(--fs-xs);
	}
	.opts {
		display: flex;
		gap: var(--sp-3);
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: thin;
	}
	.slotbtn {
		flex: 1 1 0;
		min-width: 74px;
		display: flex;
		align-items: center;
		text-align: left;
		padding: var(--sp-2) var(--sp-3);
		min-height: 44px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.lab {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
		min-width: 0;
	}
	.rl {
		line-height: 1.1;
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	.slotbtn:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.slotbtn.cur {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.slotbtn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.only {
		flex: none;
		font: 600 var(--fs-xs)/1 var(--f-body);
		padding: var(--sp-2) var(--sp-3);
		border-radius: var(--r-pill);
		border: 1px solid var(--warn);
		color: var(--warn);
		white-space: nowrap;
	}
	.narrow {
		display: none;
	}
	@media (max-width: 760px) {
		.wide {
			display: none;
		}
		.narrow {
			display: inline;
		}
		.title b {
			font-size: var(--fs-sm);
		}
	}
	@media (min-width: 900px) {
		.sheet {
			max-width: 640px;
		}
	}
</style>
