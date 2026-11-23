<script lang="ts">
	import {
		addCustomPiece,
		discardPlateUpload,
		uploadThreeMf,
		uploadThumbnailUrl,
		type UploadResult
	} from '#lib/client/api.ts';
	import { fmt, fmtH } from '#lib/domain/index.ts';
	import { CUSTOM_NAME_MAX, MAX_CUSTOM_PIECES, MAX_CUSTOM_PLATES } from '#lib/domain/custom.ts';
	import type { BuildView } from '#lib/domain/types.ts';

	/**
	 * Add a custom part from a 3MF: an accessory or a beta replacement the kit does not have. The file goes
	 * up like any sliced file; here the maker names the piece, picks its plates and colours, and optionally
	 * the kit parts it replaces. Its plates are kept as sliced and show up on the Print tab.
	 */
	let {
		view,
		onclose,
		ondone
	}: {
		view: BuildView;
		onclose: () => void;
		ondone: (msg: string) => void;
	} = $props();

	type Phase = 'pick' | 'uploading' | 'review' | 'adding';
	let phase = $state<Phase>('pick');
	let fileName = $state('');
	let progress = $state(0);
	let error = $state<string | null>(null);
	let up = $state<UploadResult | null>(null);
	let drag = $state(false);

	let name = $state('');
	let include = $state<Record<number, boolean>>({});
	let runs = $state<Record<number, number>>({});
	let colours = $state<Record<string, string>>({});
	let role = $state('');
	let replaces = $state<string[]>([]);

	const haveCustom = $derived(view.customPieces.reduce((n, c) => n + c.plates.length, 0));
	const roomPlates = $derived(Math.max(0, MAX_CUSTOM_PLATES - haveCustom));
	const full = $derived(view.customPieces.length >= MAX_CUSTOM_PIECES);
	const sliced = $derived(!!up?.summary.sliced);
	const chosen = $derived(up ? up.summary.plates.filter((p) => include[p.index]) : []);
	/** Filament slots that carry grams on a chosen plate: each needs a colour of this build. */
	const usedSlots = $derived(
		new Set(
			sliced
				? chosen.flatMap((p) =>
						Object.entries(p.filamentGrams ?? {})
							.filter(([, g]) => g > 0)
							.map(([i]) => i)
					)
				: []
		)
	);
	const missingColour = $derived([...usedSlots].some((i) => !colours[i]));
	const overCap = $derived(chosen.length > roomPlates);
	const problem = $derived(
		full
			? `A build can have at most ${MAX_CUSTOM_PIECES} custom parts.`
			: !name.trim()
				? 'Give the part a name.'
				: !chosen.length
					? 'Choose at least one plate.'
					: overCap
						? `A build can have at most ${MAX_CUSTOM_PLATES} custom plates (${haveCustom} now).`
						: missingColour
							? 'Choose a color for every filament the plates use.'
							: !sliced && !role
								? 'Choose a color.'
								: null
	);

	// Kit parts grouped by the plate they print on; the ones on no plate come last.
	const kitGroups = $derived.by(() => {
		const kit = new Map(view.parts.filter((p) => !p.custom).map((p) => [p.slug, p]));
		const seen: Record<string, boolean> = {};
		const out: { key: string; title: string; parts: { slug: string; name: string }[] }[] = [];
		for (const pl of view.plates) {
			if (pl.source.startsWith('custom:')) continue;
			const parts = pl.parts
				.filter((s) => kit.has(s) && !seen[s])
				.map((s) => ({ slug: s, name: kit.get(s)!.name }));
			parts.forEach((p) => (seen[p.slug] = true));
			if (parts.length)
				out.push({ key: `p${pl.number}`, title: `Plate ${pl.number} · ${pl.name}`, parts });
		}
		const rest = [...kit.values()].filter((p) => !seen[p.slug]);
		if (rest.length)
			out.push({
				key: 'rest',
				title: 'Not on a plate',
				parts: rest.map((p) => ({ slug: p.slug, name: p.name }))
			});
		return out;
	});
	const nameOfKit = (slug: string) => view.parts.find((p) => p.slug === slug)?.name ?? slug;

	const baseName = (f: string) =>
		f
			.replace(/\.gcode\.3mf$/i, '')
			.replace(/\.3mf$/i, '')
			.replace(/[_]+/g, ' ')
			.trim()
			.slice(0, CUSTOM_NAME_MAX);

	async function pick(file: File | null | undefined) {
		if (!file) return;
		if (!/\.3mf$/i.test(file.name)) {
			error = 'Choose a .3mf file (a .gcode.3mf from your slicer works too).';
			return;
		}
		error = null;
		fileName = file.name;
		progress = 0;
		phase = 'uploading';
		try {
			const r = await uploadThreeMf(view.build.id, file, (f) => (progress = f));
			up = r;
			name = baseName(file.name);
			include = Object.fromEntries(
				r.summary.plates.map((p, i) => [p.index, i < Math.max(1, roomPlates)])
			);
			runs = Object.fromEntries(
				r.summary.plates.map((p) => [p.index, Math.min(20, Math.max(1, p.runsHint || 1))])
			);
			colours = Object.fromEntries(
				Object.entries(r.suggestions.filamentMap).map(([i, k]) => [i, k ?? ''])
			);
			role = Object.values(colours).find(Boolean) ?? view.filaments[0]?.key ?? '';
			replaces = [];
			phase = 'review';
		} catch (e) {
			error = e instanceof Error ? e.message : 'The upload failed.';
			phase = 'pick';
		}
	}

	function toggleReplace(slug: string, on: boolean) {
		replaces = on ? [...replaces, slug] : replaces.filter((s) => s !== slug);
	}

	async function add() {
		if (!up || problem) return;
		const u = up;
		phase = 'adding';
		error = null;
		try {
			const r = await addCustomPiece(view.build.id, u.uploadId, {
				name: name.trim(),
				plates: chosen.map((p) => p.index),
				runs: Object.fromEntries(chosen.map((p) => [String(p.index), runs[p.index] ?? 1])),
				...(sliced
					? {
							filamentMap: Object.fromEntries([...usedSlots].map((i) => [i, colours[i]]))
						}
					: { role }),
				replaces
			});
			const n = r.plates.length;
			ondone(
				`Added "${name.trim()}": ${n} plate${n === 1 ? '' : 's'} (${r.plates.join(', ')}) after the kit's plates${r.skipped.length ? `; ${r.skipped.length} kit part${r.skipped.length === 1 ? '' : 's'} marked Not printing` : ''}.`
			);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not add the part.';
			phase = 'review';
		}
	}

	async function cancel() {
		if (up && phase === 'review') {
			try {
				await discardPlateUpload(view.build.id, up.uploadId);
			} catch {
				/* the server clears stale uploads on the next one */
			}
		}
		onclose();
	}
	/** Escape in the sheet: the same as Cancel, except while the part is being added. */
	export function close() {
		if (phase !== 'adding') void cancel();
	}
</script>

<section class="cpu" aria-label="Add a custom part">
	<div class="cpu-head">
		<h2>Add a custom part</h2>
		<button class="btn sm" type="button" onclick={cancel} disabled={phase === 'adding'}
			>Cancel</button
		>
	</div>

	{#if error}<div class="error" role="alert">{error}</div>{/if}

	{#if phase === 'pick' || phase === 'uploading'}
		<p class="muted">
			An accessory or a beta replacement that is not in the kit: a one-piece push handle, a cup
			holder, an activity table. Choose its .3mf from your slicer. Its plates are kept as you sliced
			them, with the print time and grams from the file, and join the Print tab after the kit's
			plates. The file itself is not kept.
		</p>
		{#if phase === 'pick'}
			<label
				class="cpu-drop"
				class:drag
				ondragover={(e) => {
					e.preventDefault();
					drag = true;
				}}
				ondragleave={() => (drag = false)}
				ondrop={(e) => {
					e.preventDefault();
					drag = false;
					void pick(e.dataTransfer?.files?.[0]);
				}}
			>
				<input
					type="file"
					accept=".3mf,model/3mf"
					data-testid="custom-3mf-file"
					onchange={(e) => void pick(e.currentTarget.files?.[0])}
				/>
				<span>Choose a .3mf file, or drop it here</span>
			</label>
		{:else}
			<div class="cpu-progress" role="status">
				<div class="cpu-bar"><span style="width:{Math.round(progress * 100)}%"></span></div>
				<span class="meta"
					>{progress < 1
						? `Uploading ${fileName}… ${Math.round(progress * 100)}%`
						: `Reading ${fileName}…`}</span
				>
			</div>
		{/if}
	{:else if up}
		{@const s = up.summary}
		<p class="meta cpu-sum">
			<b>{fileName}</b>
			· {s.sliced ? 'sliced' : 'not sliced'}
			{#if s.printer}· {s.printer}{/if}
		</p>
		{#each s.warnings as w (w)}<p class="cpu-note">{w}</p>{/each}
		{#if !s.sliced}
			<p class="cpu-note" data-testid="custom-unsliced-note">
				This file is not sliced, so it has no print time or grams. Add it now and type the time and
				grams on its plate afterwards.
			</p>
		{/if}

		<label class="cpu-field">
			<span class="cpu-label">Name</span>
			<input
				type="text"
				bind:value={name}
				maxlength={CUSTOM_NAME_MAX}
				data-testid="custom-name"
				autocomplete="off"
			/>
		</label>

		<h3>Plates ({s.plates.length})</h3>
		{#if roomPlates < s.plates.length}
			<p class="meta">
				This build has room for {roomPlates} more custom plate{roomPlates === 1 ? '' : 's'}.
			</p>
		{/if}
		<ul class="cpu-plates">
			{#each s.plates as pl (pl.index)}
				<li class="ds-card ds-card--compact cpu-plate" class:off={!include[pl.index]}>
					<label class="cpu-inc">
						<input
							type="checkbox"
							bind:checked={include[pl.index]}
							aria-label="Add plate {pl.index}"
							data-testid="custom-plate-include"
						/>
					</label>
					{#if pl.hasThumbnail}
						<img
							src={uploadThumbnailUrl(view.build.id, up.uploadId, pl.index)}
							alt="Plate {pl.index} preview"
							loading="lazy"
							width="56"
							height="56"
						/>
					{/if}
					<div class="cpu-info">
						<b>Plate {pl.index} · {pl.name || 'Plate'}</b>
						<span class="meta">
							{#if s.sliced}
								{pl.estSeconds ? fmtH(pl.estSeconds) : 'no time'}
								· {pl.grams ? `${fmt(pl.grams)} g` : 'no grams'}
							{:else}
								no time or grams yet
							{/if}
						</span>
					</div>
					<label class="cpu-runs">
						<span class="meta">Prints</span>
						<input
							type="number"
							min="1"
							max="20"
							step="1"
							inputmode="numeric"
							bind:value={runs[pl.index]}
							disabled={!include[pl.index]}
							aria-label="Times to print plate {pl.index}"
						/>
					</label>
				</li>
			{/each}
		</ul>

		<h3>Colors</h3>
		{#if s.sliced}
			<div class="cpu-fil">
				{#each s.filaments as f (f.index)}
					{#if usedSlots.has(String(f.index))}
						<label class="cpu-slot">
							<span class="cpu-swatch" style="background:{f.color ?? 'transparent'}"></span>
							<span class="cpu-fl">#{f.index} {f.type}{f.name ? ` · ${f.name}` : ''}</span>
							<select bind:value={colours[String(f.index)]} aria-label="Build color for #{f.index}">
								<option value="">Choose…</option>
								{#each view.filaments as r (r.key)}
									<option value={r.key}>{r.name} ({r.material})</option>
								{/each}
							</select>
						</label>
					{/if}
				{/each}
				{#if !usedSlots.size}<p class="meta">The chosen plates use no filament weight.</p>{/if}
			</div>
		{:else}
			<label class="cpu-slot">
				<span class="cpu-fl">Printed in</span>
				<select bind:value={role} aria-label="Color of the part">
					{#each view.filaments as r (r.key)}
						<option value={r.key}>{r.name} ({r.material})</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if kitGroups.length}
			<details class="cpu-replaces" data-testid="custom-replaces">
				<summary>
					Replaces kit parts{replaces.length ? ` (${replaces.length})` : ''}
					<span class="meta">optional</span>
				</summary>
				<p class="meta">
					These parts are marked Not printing; you can bring them back. Nothing is deleted.
				</p>
				{#each kitGroups as g (g.key)}
					<fieldset class="cpu-group">
						<legend>{g.title}</legend>
						{#each g.parts as p (p.slug)}
							<label class="cpu-chk">
								<input
									type="checkbox"
									checked={replaces.includes(p.slug)}
									onchange={(e) => toggleReplace(p.slug, e.currentTarget.checked)}
								/>
								{p.name}
							</label>
						{/each}
					</fieldset>
				{/each}
			</details>
		{/if}

		{#if replaces.length}
			<p class="meta cpu-sel">Replacing: {replaces.map(nameOfKit).join(', ')}</p>
		{/if}
		{#if problem}<p class="meta cpu-problem" role="status">{problem}</p>{/if}
		<div class="cpu-actions">
			<button class="btn" type="button" onclick={cancel} disabled={phase === 'adding'}
				>Cancel</button
			>
			<button
				class="btn primary"
				type="button"
				data-testid="custom-add"
				disabled={!!problem || phase === 'adding'}
				onclick={add}>{phase === 'adding' ? 'Adding…' : 'Add to build'}</button
			>
		</div>
	{/if}
</section>

<style>
	.cpu {
		display: grid;
		gap: var(--sp-6);
		padding: var(--sp-8);
	}
	.cpu-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--sp-5);
	}
	.cpu h2,
	.cpu h3 {
		margin: 0;
	}
	.cpu h3 {
		font-size: var(--fs-base);
	}
	.cpu-sum {
		overflow-wrap: anywhere;
	}
	.cpu-drop {
		display: grid;
		place-items: center;
		padding: 28px var(--sp-6);
		border: 2px dashed var(--line);
		border-radius: var(--r-lg);
		color: var(--muted);
		cursor: pointer;
		text-align: center;
	}
	.cpu-drop.drag {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.cpu-progress {
		display: grid;
		gap: var(--sp-3);
	}
	.cpu-bar {
		display: flex;
		height: 8px;
		background: var(--line);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	.cpu-bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.15s;
	}
	.cpu-note {
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--r-md);
		background: var(--warn-soft);
		color: var(--ink);
		font-size: var(--fs-sm);
	}
	.cpu-field {
		display: grid;
		gap: var(--sp-2);
	}
	.cpu-label {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.cpu input[type='text'],
	.cpu input[type='number'],
	.cpu select {
		width: 100%;
		min-width: 0;
		padding: 7px var(--sp-4);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--card);
		color: var(--ink);
		font-size: var(--fs-md);
	}
	.cpu-plates {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-4);
	}
	.cpu-plate {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-4) var(--sp-5);
		background: var(--paper);
	}
	.cpu-plate.off {
		opacity: 0.6;
	}
	.cpu-plate img {
		border-radius: var(--r-md);
		border: 1px solid var(--line);
		background: #fff; /* slicer thumbnails are drawn for a white page: no token */
		object-fit: contain;
		flex: none;
	}
	.cpu-inc {
		display: inline-flex;
		align-items: center;
		min-width: 24px;
		min-height: 24px;
	}
	.cpu-info {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
		flex: 1 1 140px;
		overflow-wrap: anywhere;
	}
	.cpu-runs {
		display: grid;
		gap: var(--sp-1);
		width: 84px;
	}
	.cpu-fil {
		display: grid;
		gap: var(--sp-4);
	}
	.cpu-slot {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-2) var(--sp-4);
		align-items: center;
	}
	.cpu-slot select {
		grid-column: 1 / -1;
	}
	.cpu-swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--line);
	}
	.cpu-replaces {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--sp-4) var(--sp-5);
	}
	.cpu-replaces summary {
		cursor: pointer;
		font-weight: 600;
	}
	.cpu-replaces p {
		margin: var(--sp-3) 0;
	}
	.cpu-group {
		border: 0;
		padding: 0;
		margin: var(--sp-4) 0 0;
		display: grid;
		gap: var(--sp-2);
	}
	.cpu-group legend {
		padding: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
		font-weight: 600;
	}
	.cpu-chk {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		min-height: 32px;
	}
	.cpu-sel {
		overflow-wrap: anywhere;
	}
	.cpu-problem {
		margin: 0;
		color: var(--warn);
		font-weight: 600;
	}
	.cpu-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-4);
		position: sticky;
		bottom: 0;
		padding: var(--sp-4) 0;
		margin-bottom: calc(-1 * var(--sp-4));
		background: var(--card);
	}
	@media (pointer: coarse) {
		.cpu input[type='text'],
		.cpu input[type='number'],
		.cpu select {
			font-size: var(--fs-field);
			min-height: 40px;
		}
	}
	@media (min-width: 761px) {
		.cpu-slot {
			grid-template-columns: auto 1fr minmax(180px, 1fr);
		}
		.cpu-slot select {
			grid-column: auto;
		}
	}
</style>
