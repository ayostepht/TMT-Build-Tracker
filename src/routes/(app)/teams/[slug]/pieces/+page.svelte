<script lang="ts">
	import { resolve } from '$app/paths';
	import { deleteLibraryPiece, updateLibraryPiece, type LibraryPiece } from '#lib/client/api.ts';
	import { fmt, fmtHM } from '#lib/domain/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type Row = LibraryPiece & { replacesNames: string[] };
	let pieces = $derived<Row[]>(data.pieces);
	let error = $state('');
	let busyId = $state('');
	let renaming = $state('');
	let nameDraft = $state('');
	let confirming = $state('');

	async function run(id: string, fn: () => Promise<void>) {
		error = '';
		busyId = id;
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busyId = '';
		}
	}
	const patch = (r: Row, piece: LibraryPiece) =>
		(pieces = pieces.map((x) => (x.id === r.id ? { ...x, ...piece } : x)));

	const toggle = (r: Row, on: boolean) =>
		run(r.id, async () => {
			const { piece } = await updateLibraryPiece(data.team.id, r.id, { isDefault: on });
			patch(r, piece);
		});
	const startRename = (r: Row) => {
		renaming = r.id;
		nameDraft = r.name;
	};
	const saveName = (r: Row) =>
		run(r.id, async () => {
			const { piece } = await updateLibraryPiece(data.team.id, r.id, { name: nameDraft });
			patch(r, piece);
			renaming = '';
		});
	const remove = (r: Row) =>
		run(r.id, async () => {
			await deleteLibraryPiece(data.team.id, r.id);
			pieces = pieces.filter((x) => x.id !== r.id);
			confirming = '';
		});
</script>

<svelte:head><title>Saved parts · {data.team.name}</title></svelte:head>

<section class="sp-page" data-testid="saved-parts">
	<div class="sp-head">
		<h2>Saved parts</h2>
		<a class="btn back" href={resolve('/(app)/teams/[slug]', { slug: data.team.slug })}>Builds</a>
	</div>
	<p class="muted">
		Custom parts you saved from a build's Files tab, for example a new push handle or a cup holder.
		Add one to any build of this {data.team.personal ? 'workspace' : 'chapter'}, or include it in
		every new build so its filament and print time are counted from the start.
	</p>
	{#if error}<div class="error" role="alert">{error}</div>{/if}

	{#if !pieces.length}
		<div class="card sp-empty" data-testid="saved-parts-empty">
			<p>
				<b>No saved parts yet.</b> Upload a sliced file as a custom part on a build's Files tab and choose
				"Save for new builds".
			</p>
		</div>
	{:else}
		<ul class="sp-list">
			{#each pieces as r (r.id)}
				<li class="card sp-row" data-testid="saved-part" data-name={r.name}>
					<div class="sp-main">
						{#if renaming === r.id}
							<form
								class="sp-rename"
								onsubmit={(e) => {
									e.preventDefault();
									void saveName(r);
								}}
							>
								<input
									class="sp-input"
									bind:value={nameDraft}
									maxlength="80"
									aria-label="Name of the saved part"
									data-testid="saved-part-name-input"
								/>
								<button
									type="submit"
									class="btn sm primary"
									disabled={busyId === r.id || !nameDraft.trim()}
									data-testid="saved-part-name-save">Save</button
								>
								<button type="button" class="btn sm ghost" onclick={() => (renaming = '')}
									>Cancel</button
								>
							</form>
						{:else}
							<h3 class="sp-name">{r.name}</h3>
						{/if}
						<div class="sp-meta muted">
							{r.plates.length}
							{r.plates.length === 1 ? 'plate' : 'plates'} · {r.totalSeconds
								? fmtHM(r.totalSeconds)
								: 'no time'} · {fmt(r.totalGrams)} g
						</div>
						<div class="sp-meta muted">
							{#if r.replacesNames.length}
								Replaces: {r.replacesNames.join(', ')}
							{:else}
								Replaces no kit parts
							{/if}
						</div>
					</div>
					{#if data.canEdit}
						<div class="sp-actions">
							<label class="sp-check">
								<input
									type="checkbox"
									checked={r.isDefault}
									disabled={busyId === r.id}
									onchange={(e) => toggle(r, e.currentTarget.checked)}
									data-testid="saved-part-default"
								/>
								<span>Include in new builds</span>
							</label>
							{#if confirming === r.id}
								<span class="sp-confirm" role="alert"
									>Delete "{r.name}"? Builds that use it keep their parts.</span
								>
								<button
									type="button"
									class="btn sm danger"
									disabled={busyId === r.id}
									onclick={() => remove(r)}
									data-testid="saved-part-delete-confirm">Delete</button
								>
								<button type="button" class="btn sm ghost" onclick={() => (confirming = '')}
									>Cancel</button
								>
							{:else}
								<button
									type="button"
									class="btn sm"
									onclick={() => startRename(r)}
									data-testid="saved-part-rename">Rename</button
								>
								<button
									type="button"
									class="btn sm"
									onclick={() => (confirming = r.id)}
									data-testid="saved-part-delete">Delete</button
								>
							{/if}
						</div>
					{:else if r.isDefault}
						<div class="sp-actions muted">Included in new builds</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.sp-page {
		display: grid;
		gap: var(--sp-6);
		align-content: start;
	}
	.sp-page p {
		margin: 0;
	}
	.sp-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
	}
	.sp-head h2 {
		margin: 0;
	}
	.sp-list {
		display: grid;
		gap: var(--sp-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.sp-row {
		display: grid;
		gap: var(--sp-4);
	}
	.sp-main {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.sp-name {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.sp-meta {
		font-size: var(--fs-sm);
	}
	.sp-rename {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
		align-items: center;
	}
	.sp-input {
		flex: 1 1 200px;
		min-width: 0;
	}
	.sp-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3) var(--sp-4);
	}
	.sp-check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		cursor: pointer;
	}
	.sp-confirm {
		font-size: var(--fs-sm);
	}
	.sp-empty {
		display: grid;
		gap: var(--sp-3);
	}
	@media (min-width: 720px) {
		.sp-row {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
		}
	}
	@media (pointer: coarse) {
		.sp-input {
			font-size: 16px;
		}
	}
</style>
