<script lang="ts">
	import { tick } from 'svelte';
	import { applyLibraryPiece, removeCustomPiece } from '#lib/client/api.ts';
	import { fmt, fmtHM } from '#lib/domain/format.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import CustomPieceUpload from '#lib/components/CustomPieceUpload.svelte';
	import CustomReplacesPicker, { kitGroupsOf } from '#lib/components/CustomReplacesPicker.svelte';
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
	/** Bring the confirm step fully into view (clear of the sticky footer) when it opens. */
	function reveal(node: HTMLElement) {
		node.scrollIntoView({ block: 'center' });
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
	/** Names of kit and custom parts, including the ones set aside (a replaced part is usually skipped). */
	const nameOf = (slug: string) =>
		ctx.view.skipped.find((p) => p.slug === slug)?.name ??
		ctx.view.allParts.find((p) => p.slug === slug)?.name ??
		slug;

	/** What a piece of this build replaces and which of those are still set aside, for "Bring back". */
	const replacedOf = (pieceId: string | null) => {
		const c = pieceId ? ctx.view.customPieces.find((x) => x.id === pieceId) : null;
		if (!c?.replaces.length) return null;
		return {
			names: c.replaces.map(nameOf),
			skipped: ctx.view.skipped.filter((p) => c.replaces.includes(p.slug))
		};
	};

	/** The saved part's kit parts that are active in this build (same kit), what the confirm step pre-checks. */
	function wouldReplace(s: LibraryPiece): string[] {
		if (!s.templateId || s.templateId !== ctx.view.build.templateId) return [];
		const active = new Set(ctx.view.parts.filter((p) => !p.custom).map((p) => p.slug));
		return [...new Set(s.replaces)].filter(
			(slug) => active.has(slug) && ctx.view.state[slug]?.status !== 'Printing'
		);
	}
	let confirmId = $state('');
	let confirmSel = $state<string[]>([]);
	/** What the saved part replaces here: listed first, the rest of the kit stays collapsed. */
	let confirmPre = $state<string[]>([]);
	const groups = $derived(kitGroupsOf(ctx.view));

	async function remove(id: string) {
		busy = id;
		notice = null;
		try {
			await ctx.act(() => removeCustomPiece(ctx.id, id, true));
		} finally {
			busy = '';
		}
	}
	async function bringBack(slug: string) {
		busy = slug;
		notice = null;
		try {
			await ctx.restoreSkipped([slug]);
		} finally {
			busy = '';
		}
	}
	async function toggle(s: (typeof savedRows)[number]) {
		notice = null;
		if (!s.pieceId) {
			const pre = wouldReplace(s);
			if (pre.length) {
				// A part that replaces kit parts asks first, with the saved choice pre-checked.
				confirmId = s.id;
				confirmSel = pre;
				confirmPre = [...pre];
				return;
			}
		}
		await run(s, undefined);
	}
	async function run(s: (typeof savedRows)[number], replaces: string[] | undefined) {
		busy = s.id;
		try {
			const ok = await ctx.act(() =>
				s.pieceId
					? removeCustomPiece(ctx.id, s.pieceId, true)
					: applyLibraryPiece(ctx.id, s.id, replaces)
			);
			if (ok !== false) confirmId = '';
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
							{c.plates.length === 1 ? 'plate' : 'plates'}
						</span>
						{@render replaced(c.id)}
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
								: 'no time'} · {fmt(s.totalGrams)} g{!s.pieceId && s.replacesNames.length
								? ` · replaces ${s.replacesNames.join(', ')}`
								: ''}
						</span>
						{@render replaced(s.pieceId)}
					</div>
					<button
						type="button"
						class="btn sm"
						class:primary={!s.pieceId}
						disabled={busy === s.id}
						data-testid={s.pieceId ? 'setup-saved-remove' : 'setup-saved-add'}
						onclick={() => toggle(s)}>{s.pieceId ? 'Remove' : 'Add'}</button
					>
					{#if confirmId === s.id}
						<div class="scp-confirm" data-testid="setup-saved-confirm-step" use:reveal>
							<p>
								<b>Add "{s.name}" to this build</b>
								<span class="muted">
									Checked kit parts are marked Not printing in this build. Uncheck any you still
									want to print; you can bring them back later.
								</span>
							</p>
							<CustomReplacesPicker
								{groups}
								bind:selected={confirmSel}
								primary={confirmPre}
								open
								optional={false}
								hint="Nothing is deleted."
								testid="setup-saved-replaces"
							/>
							<div class="scp-confirm-actions">
								<button
									type="button"
									class="btn sm primary"
									disabled={busy === s.id}
									data-testid="setup-saved-confirm"
									onclick={() => run(s, confirmSel)}>Add to build</button
								>
								<button
									type="button"
									class="btn sm ghost"
									disabled={busy === s.id}
									data-testid="setup-saved-cancel"
									onclick={() => (confirmId = '')}>Cancel</button
								>
							</div>
						</div>
					{/if}
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

{#snippet replaced(pieceId: string | null)}
	{@const r = replacedOf(pieceId)}
	{#if r}
		<div class="scp-replaced" data-testid="setup-replaced">
			<span class="muted scp-meta">Replaces: {r.names.join(', ')}</span>
			{#each r.skipped as p (p.slug)}
				<button
					type="button"
					class="btn sm"
					disabled={busy === p.slug}
					aria-label="Bring back {p.name}"
					data-testid="setup-bring-back"
					onclick={() => bringBack(p.slug)}>Bring back {p.name}</button
				>
			{/each}
		</div>
	{/if}
{/snippet}

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
	.scp-replaced {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
	}
	.scp-confirm {
		flex: 1 1 100%;
		display: grid;
		gap: 12px;
		min-width: 0;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--paper);
	}
	.scp-confirm p {
		display: grid;
		gap: 2px;
		font-size: var(--fs-sm);
	}
	.scp-confirm-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	@media (min-width: 761px) {
		.scp-sheet {
			width: min(760px, calc(100vw - 32px));
		}
	}
</style>
