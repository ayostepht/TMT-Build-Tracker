<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		deleteLibraryPiece,
		listCustomLibrary,
		updateLibraryPiece,
		type LibraryPiece
	} from '#lib/client/api.ts';
	import LibraryPartForm from '#lib/components/LibraryPartForm.svelte';
	import SlicerTimeInput from '#lib/components/SlicerTimeInput.svelte';
	import { fmt, fmtHM, MAX_PRINT_SECONDS, parseGrams } from '#lib/domain/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type Row = LibraryPiece & { replacesNames: string[] };
	let pieces = $derived<Row[]>(data.pieces);
	let error = $state('');
	let busyId = $state('');
	let renaming = $state('');
	let nameDraft = $state('');
	let confirming = $state('');
	let adding = $state(false);
	let notice = $state('');
	type Template = Awaited<ReturnType<typeof listCustomLibrary>>['template'];
	let template = $state<Template | null>(null);
	$effect(() => {
		let live = true;
		listCustomLibrary(data.team.id)
			.then((r) => {
				if (live) template = r.template;
			})
			.catch(() => {
				if (live)
					error = 'The kit could not be loaded, so parts cannot be added now. Reload to retry.';
			});
		return () => {
			live = false;
		};
	});
	const partName = (slug: string) => template?.parts.find((p) => p.slug === slug)?.name ?? slug;
	/** Grams to one decimal, so a typed 45.5 is not shown as 46. */
	const gramsText = (g: number) => String(Math.round(g * 10) / 10);
	const roleName = (key: string) => template?.roles.find((r) => r.key === key)?.name ?? key;

	function created(piece: LibraryPiece) {
		pieces = [...pieces, { ...piece, replacesNames: piece.replaces.map(partName) }];
		adding = false;
		notice = `Added "${piece.name}".`;
	}

	// Inline edit of each plate's print time and grams.
	type Draft = { index: number; label: string; seconds: number | null; gramsText: string };
	let editing = $state('');
	let drafts = $state<Draft[]>([]);
	const startEdit = (r: Row) => {
		editing = r.id;
		confirming = '';
		drafts = r.plates.map((p) => ({
			index: p.index,
			label: p.name,
			seconds: p.estSeconds,
			gramsText: p.grams ? String(Math.round(p.grams * 100) / 100) : ''
		}));
	};
	const draftBad = (d: Draft) => {
		const g = parseGrams(d.gramsText);
		return (
			(d.seconds ?? 0) > MAX_PRINT_SECONDS ||
			(g !== null && (Number.isNaN(g) || g <= 0 || g > 20000))
		);
	};
	const saveEdit = (r: Row) =>
		run(r.id, async () => {
			const { piece } = await updateLibraryPiece(data.team.id, r.id, {
				plates: drafts.map((d) => {
					const g = parseGrams(d.gramsText);
					return { index: d.index, estSeconds: d.seconds, grams: g === null ? null : g };
				})
			});
			patch(r, piece);
			editing = '';
		});

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

<svelte:head><title>Custom parts · {data.team.name}</title></svelte:head>

<section class="sp-page" data-testid="saved-parts">
	<div class="sp-head">
		<h2>Custom parts</h2>
		<div class="sp-head-actions">
			{#if data.canEdit && !adding}
				<button
					type="button"
					class="btn primary"
					disabled={!template}
					onclick={() => {
						adding = true;
						notice = '';
					}}
					data-testid="saved-part-add">Add a custom part</button
				>
			{/if}
			<a class="btn back" href={resolve('/(app)/teams/[slug]', { slug: data.team.slug })}>Builds</a>
		</div>
	</div>
	<p class="muted">
		Parts that are not in the kit, for example a new push handle or a cup holder, saved for this
		{data.team.personal ? 'workspace' : 'chapter'}. Add one to any build, or include it in every new
		build so its filament and print time are counted from the start. Print time and grams you type
		here are used wherever the part is added later.
	</p>
	{#if error}<div class="error" role="alert">{error}</div>{/if}
	{#if notice}<div class="sp-notice" role="status" data-testid="saved-part-notice">
			{notice}
		</div>{/if}
	{#if adding && template}
		<div class="card">
			<LibraryPartForm
				organizationId={data.team.id}
				{template}
				oncreated={created}
				onclose={() => (adding = false)}
			/>
		</div>
	{/if}

	{#if !pieces.length}
		<div class="card sp-empty" data-testid="saved-parts-empty">
			<p>
				<b>No custom parts yet.</b>
				{data.canEdit ? 'Use "Add a custom part" above, or save one' : 'A part can be saved'} from a build's
				Files tab with "Save for new builds".
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
						{#if editing !== r.id}
							<ul class="sp-plates muted" data-testid="saved-part-plates">
								{#each r.plates as p (p.index)}
									<li>
										{p.name || `Plate ${p.index + 1}`} · {p.estSeconds
											? fmtHM(p.estSeconds)
											: 'no time'} · {p.grams ? `${gramsText(p.grams)} g` : 'no grams'}{p.runs > 1
											? ` × ${p.runs}`
											: ''} · {roleName(p.role)}
									</li>
								{/each}
							</ul>
						{/if}
						<div class="sp-meta muted">
							{#if r.replacesNames.length}
								Replaces: {r.replacesNames.join(', ')}
							{:else}
								Replaces no kit parts
							{/if}
						</div>
					</div>
					{#if data.canEdit && editing === r.id}
						<form
							class="sp-edit"
							data-testid="saved-part-edit-form"
							onsubmit={(e) => {
								e.preventDefault();
								void saveEdit(r);
							}}
						>
							{#each drafts as d (d.index)}
								<div class="sp-edit-plate">
									<b>{d.label || `Plate ${d.index + 1}`}</b>
									<div class="sp-edit-nums">
										<SlicerTimeInput
											label="Print time"
											value={d.seconds}
											placeholder="e.g. 2h 30m"
											title="Time of one print of this plate."
											onsave={(sec) => (d.seconds = sec)}
										/>
										<label class="slicer-in sp-grams">
											Grams (per print)
											<input
												type="text"
												inputmode="decimal"
												autocomplete="off"
												placeholder="g"
												bind:value={d.gramsText}
												aria-invalid={draftBad(d)}
												data-testid="saved-part-edit-grams"
											/>
										</label>
									</div>
								</div>
							{/each}
							<div class="sp-actions">
								<button
									type="submit"
									class="btn sm primary"
									disabled={busyId === r.id || drafts.some(draftBad)}
									data-testid="saved-part-edit-save">Save</button
								>
								<button type="button" class="btn sm ghost" onclick={() => (editing = '')}
									>Cancel</button
								>
							</div>
						</form>
					{:else if data.canEdit}
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
									>Remove "{r.name}"? Builds that use it keep their parts.</span
								>
								<button
									type="button"
									class="btn sm danger"
									disabled={busyId === r.id}
									onclick={() => remove(r)}
									data-testid="saved-part-delete-confirm">Remove</button
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
									onclick={() => startEdit(r)}
									data-testid="saved-part-edit">Edit time and grams</button
								>
								<button
									type="button"
									class="btn sm"
									onclick={() => (confirming = r.id)}
									data-testid="saved-part-delete">Remove</button
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
	.sp-head-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}
	.sp-notice {
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--r-md);
		background: var(--accent-soft);
		color: var(--ink);
	}
	.sp-plates {
		margin: var(--sp-2) 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 2px;
		font-size: var(--fs-sm);
		overflow-wrap: anywhere;
	}
	.sp-edit {
		grid-column: 1 / -1;
		display: grid;
		gap: var(--sp-4);
	}
	.sp-edit-plate {
		display: grid;
		gap: var(--sp-3);
	}
	.sp-edit-nums {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4) var(--sp-5);
	}
	.sp-edit-nums :global(.slicer-in),
	.sp-grams {
		display: grid;
		gap: var(--sp-1);
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.sp-edit-nums :global(input[type='text']) {
		width: 9em;
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
		.sp-input,
		.sp-edit-nums :global(input[type='text']) {
			font-size: 16px;
			min-height: 40px;
		}
	}
</style>
