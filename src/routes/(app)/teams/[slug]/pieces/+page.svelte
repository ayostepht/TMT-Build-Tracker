<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		deleteLibraryPiece,
		listCustomLibrary,
		updateLibraryPiece,
		type LibraryPiece
	} from '#lib/client/api.ts';
	import CustomReplacesPicker, {
		type ReplaceGroup
	} from '#lib/components/CustomReplacesPicker.svelte';
	import LibraryPartForm from '#lib/components/LibraryPartForm.svelte';
	import SlicerTimeInput from '#lib/components/SlicerTimeInput.svelte';
	import { CUSTOM_NAME_MAX } from '#lib/domain/custom.ts';
	import { fmt, fmtHM, MAX_PRINT_SECONDS, parseGrams } from '#lib/domain/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type Row = LibraryPiece & { replacesNames: string[] };
	let pieces = $derived<Row[]>(data.pieces);
	let error = $state('');
	let busyId = $state('');
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

	/** The kit parts a saved part can replace, by section of the kit. */
	const kitGroups = $derived.by<ReplaceGroup[]>(() => {
		const out: ReplaceGroup[] = [];
		for (const p of template?.parts ?? []) {
			const k = p.section || 'Other';
			const hit = out.find((g) => g.key === k);
			if (hit) hit.parts.push({ slug: p.slug, name: p.name });
			else out.push({ key: k, title: k, parts: [{ slug: p.slug, name: p.name }] });
		}
		return out;
	});
	/** A part saved for the kit this page lists (older rows without a kit count as the default kit). */
	const sameKit = (r: Row) => !r.templateId || r.templateId === template?.templateId;

	// One Edit form per saved part: name, each plate, replaced kit parts, the automatic switch.
	type Draft = {
		index: number;
		name: string;
		seconds: number | null;
		gramsText: string;
		runs: number | null;
		/** Single-color plate: its role. */
		role: string;
		/** Multi-color plate: current role -> new role. */
		roles: Record<string, string>;
		/** Multi-color plate: grams per print by current role. */
		byRole: [string, number][];
	};
	type Form = { name: string; isDefault: boolean; replaces: string[]; plates: Draft[] };
	let editing = $state('');
	/** Which button opened the form: "Rename" is a shortcut that focuses the name. */
	let via = $state<'edit' | 'rename'>('edit');
	let form = $state<Form>({ name: '', isDefault: false, replaces: [], plates: [] });
	const round2 = (n: number) => Math.round(n * 100) / 100;
	function startEdit(r: Row, how: 'edit' | 'rename') {
		editing = r.id;
		via = how;
		confirming = '';
		error = '';
		form = {
			name: r.name,
			isDefault: r.isDefault,
			replaces: [...r.replaces],
			plates: r.plates.map((p) => {
				const byRole = Object.entries(p.filamentGrams ?? {}).filter(([, g]) => g > 0);
				return {
					index: p.index,
					name: p.name,
					seconds: p.estSeconds,
					gramsText: p.grams ? String(round2(p.grams)) : '',
					runs: p.runs,
					role: p.role,
					roles: Object.fromEntries(byRole.map(([k]) => [k, k])),
					byRole: byRole.length > 1 ? byRole : []
				};
			})
		};
	}
	const draftBad = (d: Draft) => {
		const g = parseGrams(d.gramsText);
		return (
			(d.seconds ?? 0) > MAX_PRINT_SECONDS ||
			(g !== null && (Number.isNaN(g) || g <= 0 || g > 20000)) ||
			d.runs === null ||
			!Number.isInteger(d.runs) ||
			d.runs < 1 ||
			d.runs > 20
		);
	};
	const sameSet = (a: string[], b: string[]) =>
		a.length === b.length && a.every((x) => b.includes(x));
	/** Only what differs from the saved part. */
	function changes(r: Row) {
		const body: NonNullable<Parameters<typeof updateLibraryPiece>[2]> = {};
		if (form.name.trim() !== r.name) body.name = form.name.trim();
		if (form.isDefault !== r.isDefault) body.isDefault = form.isDefault;
		if (!sameSet(form.replaces, r.replaces)) body.replaces = form.replaces;
		const plates: NonNullable<typeof body.plates> = [];
		for (const d of form.plates) {
			const o = r.plates.find((p) => p.index === d.index);
			if (!o) continue;
			const pl: (typeof plates)[number] = { index: d.index };
			if (d.name.trim() !== o.name) pl.name = d.name.trim();
			if (d.runs !== null && d.runs !== o.runs) pl.runs = d.runs;
			if (d.seconds !== o.estSeconds) pl.estSeconds = d.seconds;
			const g = parseGrams(d.gramsText);
			const og = o.grams ?? null;
			if (g === null ? og !== null : og === null || Math.abs(g - og) >= 0.006) pl.grams = g;
			if (d.byRole.length) {
				const moved = Object.fromEntries(Object.entries(d.roles).filter(([k, v]) => k !== v));
				if (Object.keys(moved).length) pl.roles = moved;
			} else if (d.role !== o.role) pl.role = d.role;
			if (Object.keys(pl).length > 1) plates.push(pl);
		}
		if (plates.length) body.plates = plates;
		return body;
	}
	const formBad = $derived(!form.name.trim() || form.plates.some(draftBad));
	const saveEdit = (r: Row) =>
		run(r.id, async () => {
			const body = changes(r);
			if (Object.keys(body).length) {
				const { piece } = await updateLibraryPiece(data.team.id, r.id, body);
				patch(r, piece);
			}
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
		(pieces = pieces.map((x) =>
			x.id === r.id ? { ...x, ...piece, replacesNames: piece.replaces.map(partName) } : x
		));

	const toggle = (r: Row, on: boolean) =>
		run(r.id, async () => {
			const { piece } = await updateLibraryPiece(data.team.id, r.id, { isDefault: on });
			patch(r, piece);
		});
	const remove = (r: Row) =>
		run(r.id, async () => {
			await deleteLibraryPiece(data.team.id, r.id);
			pieces = pieces.filter((x) => x.id !== r.id);
			confirming = '';
		});
	/** Focus the name when the form was opened with "Rename". */
	function focusIf(node: HTMLInputElement, on: boolean) {
		if (on) node.focus();
	}
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
		{data.team.personal ? 'workspace' : 'team'}. Each one is offered when you set up a build and can
		be added to any build later; you choose which kit parts it replaces each time. Turn on "Add to
		every new build automatically" to have it added without asking (you can bring back the parts it
		replaced). Print time and grams you type here are used wherever the part is added later.
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
						<h3 class="sp-name">{r.name}</h3>
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
					{#if data.canEdit && editing === r.id && template}
						<form
							class="sp-edit"
							aria-label="Edit {r.name}"
							data-testid="saved-part-edit-form"
							onsubmit={(e) => {
								e.preventDefault();
								void saveEdit(r);
							}}
						>
							<label class="sp-field">
								<span class="sp-label">Name</span>
								<input
									class="sp-input"
									type="text"
									bind:value={form.name}
									maxlength={CUSTOM_NAME_MAX}
									autocomplete="off"
									use:focusIf={via === 'rename'}
									data-testid="saved-part-name-input"
								/>
							</label>
							{#each form.plates as d, i (d.index)}
								<fieldset class="sp-edit-plate" data-testid="saved-part-edit-plate">
									<legend>Plate {i + 1}</legend>
									<label class="sp-field">
										<span class="sp-label">Plate name</span>
										<input
											class="sp-input"
											type="text"
											bind:value={d.name}
											maxlength={CUSTOM_NAME_MAX}
											autocomplete="off"
											data-testid="saved-part-edit-plate-name"
										/>
									</label>
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
										<label class="slicer-in sp-grams sp-runs">
											Prints
											<input
												type="number"
												min="1"
												max="20"
												step="1"
												inputmode="numeric"
												bind:value={d.runs}
												data-testid="saved-part-edit-runs"
											/>
										</label>
									</div>
									{#if d.byRole.length}
										<div class="sp-colors" data-testid="saved-part-edit-colors">
											{#each d.byRole as [key, g] (key)}
												<label class="sp-color">
													<span>{roleName(key)} · {gramsText(g)} g</span>
													<select bind:value={d.roles[key]} aria-label="Color for {roleName(key)}">
														{#each template.roles as o (o.key)}
															<option value={o.key}>{o.name} ({o.material})</option>
														{/each}
														{#if !template.roles.some((o) => o.key === key)}
															<option value={key}>{key}</option>
														{/if}
													</select>
												</label>
											{/each}
										</div>
									{:else}
										<label class="sp-field">
											<span class="sp-label">Printed in</span>
											<select bind:value={d.role} data-testid="saved-part-edit-role">
												{#each template.roles as o (o.key)}
													<option value={o.key}>{o.name} ({o.material})</option>
												{/each}
												{#if !template.roles.some((o) => o.key === d.role)}
													<option value={d.role}>{d.role}</option>
												{/if}
											</select>
										</label>
									{/if}
								</fieldset>
							{/each}
							{#if sameKit(r)}
								<CustomReplacesPicker
									groups={kitGroups}
									bind:selected={form.replaces}
									open={form.replaces.length > 0}
									optional={false}
									hint="When you add this part to a build, these kit parts are offered as Not printing. You confirm them each time."
									testid="saved-part-edit-replaces"
								/>
							{:else}
								<div class="sp-other" data-testid="saved-part-other-kit">
									<b>Replaces kit parts</b>
									<p class="meta">Saved for another kit: it replaces nothing here.</p>
									{#if form.replaces.length}
										<button
											type="button"
											class="btn sm"
											onclick={() => (form.replaces = [])}
											data-testid="saved-part-clear-replaces">Clear its replaced parts</button
										>
									{/if}
								</div>
							{/if}
							<label class="sp-check sp-auto">
								<input
									type="checkbox"
									bind:checked={form.isDefault}
									data-testid="saved-part-default"
								/>
								<span class="sp-check-text">
									<span>Add to every new build automatically</span>
									<span class="meta">Off: it is still offered when you set up a build.</span>
								</span>
							</label>
							<div class="sp-actions">
								<button
									type="submit"
									class="btn sm primary"
									disabled={busyId === r.id || formBad}
									data-testid={via === 'rename' ? 'saved-part-name-save' : 'saved-part-edit-save'}
									>Save</button
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
								<span class="sp-check-text">
									<span>Add to every new build automatically</span>
									<span class="meta">Off: it is still offered when you set up a build.</span>
								</span>
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
									disabled={!template}
									onclick={() => startEdit(r, 'rename')}
									data-testid="saved-part-rename">Rename</button
								>
								<button
									type="button"
									class="btn sm"
									disabled={!template}
									onclick={() => startEdit(r, 'edit')}
									data-testid="saved-part-edit">Edit</button
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
						<div class="sp-actions muted">Added to every new build automatically</div>
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
		gap: var(--sp-4);
		margin: 0;
		min-width: 0;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.sp-edit-plate legend {
		font-weight: 600;
		padding: 0 var(--sp-2);
	}
	.sp-field {
		display: grid;
		gap: var(--sp-2);
	}
	.sp-label {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.sp-edit input[type='text'],
	.sp-edit input[type='number'],
	.sp-edit select {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
		padding: 7px var(--sp-4);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--card);
		color: var(--ink);
		font-size: var(--fs-md);
	}
	.sp-edit .sp-edit-nums :global(input[type='text']),
	.sp-edit .sp-runs input {
		width: 9em;
	}
	.sp-edit .sp-runs input {
		width: 5.5em;
	}
	.sp-colors {
		display: grid;
		gap: var(--sp-3);
	}
	.sp-color {
		display: grid;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
	}
	.sp-other {
		display: grid;
		gap: var(--sp-3);
		justify-items: start;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--sp-4) var(--sp-5);
	}
	.sp-other p {
		margin: 0;
	}
	.sp-check-text {
		display: grid;
		gap: 2px;
	}
	.sp-auto {
		align-items: flex-start;
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
		.sp-edit input[type='text'],
		.sp-edit input[type='number'],
		.sp-edit select,
		.sp-edit .sp-edit-nums :global(input[type='text']) {
			font-size: 16px;
			min-height: 40px;
		}
	}
</style>
