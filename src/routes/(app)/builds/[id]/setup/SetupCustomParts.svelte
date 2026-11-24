<script lang="ts">
	import { tick } from 'svelte';
	import { applyLibraryPiece, removeCustomPiece } from '#lib/client/api.ts';
	import { fmt, fmtHM } from '#lib/domain/format.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import CustomPieceUpload from '#lib/components/CustomPieceUpload.svelte';
	import type { LibraryPiece } from '#lib/client/api.ts';

	/**
	 * The setup wizard's Options-step card for custom parts: add one from a file (the same sheet as the Files
	 * tab), remove the ones this build holds, add the workspace's saved ones. Always shown.
	 */
	let { saved }: { saved: (LibraryPiece & { replacesNames: string[] })[] } = $props();
	const ctx = getBuildCtx();

	let adding = $state(false);
	let sheet = $state<CustomPieceUpload>();
	let notice = $state<string | null>(null);
	let busy = $state('');

	let openerEl: HTMLElement | null = null;
	function open(e: Event) {
		const el = e.currentTarget;
		openerEl = el instanceof HTMLElement ? el : null;
		notice = null;
		adding = true;
	}
	async function close() {
		adding = false;
		await tick();
		const a = document.activeElement;
		if (!a || a === document.body) openerEl?.focus();
	}
	/** Opens the sheet as a modal <dialog>: native focus trap, inert page and Escape. */
	function modal(node: HTMLDialogElement) {
		node.showModal();
		return {
			destroy() {
				if (node.open) node.close();
			}
		};
	}

	/** Parts of this build that no saved part of the workspace stands behind (added from a file here or on the Files tab). */
	const pieces = $derived(
		ctx.view.customPieces.filter((c) => !c.libraryId || !saved.some((s) => s.id === c.libraryId))
	);
	/** Saved parts; "in" = this build already holds a piece made from one. */
	const savedRows = $derived(
		saved.map((s) => ({
			...s,
			pieceId: ctx.view.customPieces.find((c) => c.libraryId === s.id)?.id ?? null
		}))
	);
	const nameOf = (slug: string) => ctx.view.allParts.find((p) => p.slug === slug)?.name ?? slug;

	async function remove(id: string) {
		busy = id;
		notice = null;
		try {
			await ctx.act(() => removeCustomPiece(ctx.id, id, true));
		} finally {
			busy = '';
		}
	}
	async function toggle(s: (typeof savedRows)[number]) {
		busy = s.id;
		notice = null;
		try {
			await ctx.act(() =>
				s.pieceId ? removeCustomPiece(ctx.id, s.pieceId, true) : applyLibraryPiece(ctx.id, s.id)
			);
		} finally {
			busy = '';
		}
	}
</script>

<section class="card scp" aria-labelledby="saved-h" data-testid="setup-saved-parts">
	<h2 id="saved-h">Custom parts</h2>
	<p class="muted">
		Parts that are not in the kit, such as a new push handle or a cup holder. Add one now so its
		filament and print time are in the estimate; you can also add them later on the Files tab.
	</p>

	{#if pieces.length}
		<h3 class="scp-sub">In this build</h3>
		<ul class="scp-list" aria-label="Custom parts in this build">
			{#each pieces as c (c.id)}
				<li class="scp-row" data-testid="setup-custom-piece" data-name={c.name}>
					<div class="scp-info">
						<b>{c.name}</b>
						<span class="muted scp-meta">
							{c.plates.length}
							{c.plates.length === 1 ? 'plate' : 'plates'}{c.replaces.length
								? ` · replaces ${c.replaces.map(nameOf).join(', ')}`
								: ''}
						</span>
					</div>
					<button
						type="button"
						class="btn sm"
						disabled={busy === c.id || !c.removable}
						data-testid="setup-custom-remove"
						onclick={() => remove(c.id)}>Remove</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if savedRows.length}
		<h3 class="scp-sub">Saved custom parts</h3>
		<ul class="scp-list" aria-label="Saved custom parts">
			{#each savedRows as s (s.id)}
				<li class="scp-row" data-testid="setup-saved-part" data-name={s.name}>
					<div class="scp-info">
						<b>{s.name}</b>
						<span class="muted scp-meta">
							Saved · {s.plates.length}
							{s.plates.length === 1 ? 'plate' : 'plates'} · {s.totalSeconds
								? fmtHM(s.totalSeconds)
								: 'no time'} · {fmt(s.totalGrams)} g{s.replacesNames.length
								? ` · replaces ${s.replacesNames.join(', ')}`
								: ''}
						</span>
					</div>
					<button
						type="button"
						class="btn sm"
						class:primary={!s.pieceId}
						disabled={busy === s.id}
						data-testid={s.pieceId ? 'setup-saved-remove' : 'setup-saved-add'}
						onclick={() => toggle(s)}>{s.pieceId ? 'Remove' : 'Add'}</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if notice}<p class="ok-note" role="status">{notice}</p>{/if}

	<div>
		<button type="button" class="btn" data-testid="setup-add-custom" onclick={open}
			>Add a custom part</button
		>
	</div>
</section>

{#if adding}
	<dialog
		class="ds-modal ds-modal--sheet scp-sheet"
		aria-label="Add a custom part"
		data-testid="custom-dialog"
		use:modal
		oncancel={(e) => {
			e.preventDefault();
			sheet?.close();
		}}
	>
		<CustomPieceUpload
			bind:this={sheet}
			view={ctx.view}
			onclose={close}
			ondone={(msg) => {
				void close();
				notice = msg;
				void ctx.refresh();
			}}
		/>
	</dialog>
{/if}

<style>
	.scp {
		display: grid;
		gap: 12px;
		min-width: 0;
	}
	.scp-sub {
		margin: 0;
		font-size: var(--fs-md);
	}
	.scp h2,
	.scp p {
		margin: 0;
	}
	.scp-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}
	.scp-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
		padding: 12px 0;
		border-top: 1px solid var(--line);
		min-width: 0;
	}
	.scp-info {
		display: grid;
		gap: 2px;
		min-width: 0;
		flex: 1 1 220px;
		overflow-wrap: anywhere;
	}
	.scp-meta {
		font-size: var(--fs-sm);
	}
	@media (min-width: 761px) {
		.scp-sheet {
			width: min(760px, calc(100vw - 32px));
		}
	}
</style>
