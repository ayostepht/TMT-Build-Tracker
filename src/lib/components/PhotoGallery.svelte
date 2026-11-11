<script lang="ts">
	import AskDialog from './AskDialog.svelte';
	import { isTopTrap, trapFocus } from '#lib/client/focus-trap.ts';
	import { createAsk } from '#lib/client/ask.svelte.ts';
	import { deletePhoto, photoUrl, uploadPhoto } from '#lib/client/api.ts';
	import { downscalePhoto } from '#lib/client/images.ts';
	import type { PhotoKind } from '#lib/domain/types.ts';
	import { ago, getBuildCtx } from './build-context.svelte.ts';

	let {
		kinds,
		uploadKind,
		label = 'photo',
		emptyText = 'No photos yet.'
	}: { kinds: PhotoKind[]; uploadKind: PhotoKind; label?: string; emptyText?: string } = $props();

	const ctx = getBuildCtx();
	const photos = $derived(ctx.view.photos.filter((p) => kinds.includes(p.kind)));
	let busy = $state<string | null>(null);
	let error = $state('');
	let open = $state<number | null>(null);
	let input = $state<HTMLInputElement>();
	let lbox = $state<HTMLElement>();
	const asking = createAsk();

	async function pick(e: Event & { currentTarget: HTMLInputElement }) {
		const files = [...(e.currentTarget.files ?? [])];
		e.currentTarget.value = '';
		error = '';
		let n = 0;
		for (const f of files) {
			n++;
			busy = `Uploading ${n} of ${files.length}`;
			try {
				const s = await downscalePhoto(f);
				await uploadPhoto(ctx.id, {
					kind: uploadKind,
					file: s.full,
					thumb: s.thumb,
					width: s.width,
					height: s.height
				});
			} catch (err) {
				error = err instanceof Error ? err.message : 'That photo did not upload.';
				break;
			}
		}
		busy = null;
		await ctx.refresh();
	}

	async function remove(id: string) {
		if (
			!(await asking.ask('Delete this photo?', { title: 'Delete photo?', confirmLabel: 'Delete' }))
		)
			return;
		const idx = open;
		await ctx.act(() => deletePhoto(ctx.id, id));
		if (idx !== null) open = photos.length ? Math.min(idx, photos.length - 1) : null;
	}

	function show(i: number) {
		open = i;
	}
	function close() {
		open = null;
	}
	function onkeydown(e: KeyboardEvent) {
		if (open === null) return;
		// A question on top (delete photo) takes Escape; the viewer stays.
		if (asking.current || !isTopTrap(lbox)) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft' && open > 0) open--;
		else if (e.key === 'ArrowRight' && open < photos.length - 1) open++;
	}
	const cur = $derived(open !== null ? photos[open] : undefined);
</script>

<svelte:window {onkeydown} />

<AskDialog ask={asking} />

<div class="gallery">
	{#if ctx.canEdit}
		<div class="up">
			<button type="button" class="btn" disabled={busy !== null} onclick={() => input?.click()}
				>Add {label}s</button
			>
			<input
				bind:this={input}
				type="file"
				accept="image/*"
				multiple
				hidden
				onchange={pick}
				data-testid="photo-input"
			/>
			{#if busy}<span class="muted" role="status">{busy}…</span>{/if}
		</div>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if photos.length}
		<ul class="grid">
			{#each photos as p, i (p.id)}
				<li>
					<button
						type="button"
						class="thumb"
						onclick={() => show(i)}
						aria-label="Open {label} {i + 1}"
					>
						<img
							src={photoUrl(ctx.id, p.id, true)}
							alt={p.caption || `${label} ${i + 1}`}
							loading="lazy"
						/>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">{emptyText}</p>
	{/if}
</div>

{#if cur && open !== null}
	<div
		class="lightbox"
		onclick={(e) => e.target === e.currentTarget && close()}
		role="presentation"
	>
		<div
			class="lbox"
			role="dialog"
			aria-modal="true"
			aria-label="Photo viewer"
			tabindex="-1"
			bind:this={lbox}
			use:trapFocus={{ initial: '[data-initial]' }}
		>
			<div class="lhead">
				<span class="muted"
					>{open + 1} of {photos.length} · {cur.createdByName ?? 'Someone'}, {ago(
						cur.createdAt
					)}</span
				>
				<button type="button" class="x" aria-label="Close photo" data-initial onclick={close}
					>×</button
				>
			</div>
			<div class="limg"><img src={photoUrl(ctx.id, cur.id)} alt={cur.caption || `${label}`} /></div>
			<div class="lfoot">
				<button type="button" class="btn sm" disabled={open === 0} onclick={() => open!--}
					>‹ Prev</button
				>
				<span class="cap">{cur.caption}</span>
				{#if ctx.canEdit}
					<button type="button" class="btn sm danger" onclick={() => remove(cur.id)}>Delete</button>
				{/if}
				<button
					type="button"
					class="btn sm"
					disabled={open >= photos.length - 1}
					onclick={() => open!++}>Next ›</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.gallery {
		display: grid;
		gap: 10px;
	}
	.up {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 8px;
	}
	.thumb {
		display: block;
		width: 100%;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
		background: var(--paper);
		aspect-ratio: 1;
		cursor: zoom-in;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(10, 12, 24, 0.82);
		display: grid;
		place-items: center;
		padding: 12px;
	}
	.lbox {
		background: var(--card);
		color: var(--ink);
		border-radius: 12px;
		width: min(1100px, 100%);
		max-height: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		overflow: hidden;
	}
	.lhead,
	.lfoot {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
	}
	.lhead {
		justify-content: space-between;
	}
	.lfoot .cap {
		flex: 1;
		min-width: 0;
		font-size: 14px;
	}
	.x {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 8px;
		width: 36px;
		height: 36px;
		font-size: 18px;
	}
	.limg {
		min-height: 0;
		display: grid;
		place-items: center;
		background: #000;
		overflow: hidden;
	}
	.limg img {
		max-width: 100%;
		max-height: 72vh;
		object-fit: contain;
	}
</style>
