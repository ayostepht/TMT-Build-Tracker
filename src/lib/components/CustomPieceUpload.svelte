<script lang="ts">
	import {
		addCustomPiece,
		applyLibraryPiece,
		discardPlateUpload,
		listCustomLibrary,
		saveCustomPieceToLibrary,
		uploadThreeMf,
		uploadThumbnailUrl,
		type LibraryPiece,
		type UploadResult
	} from '#lib/client/api.ts';
	import { fmt, fmtH, MAX_PRINT_SECONDS, parseGrams } from '#lib/domain/index.ts';
	import SlicerTimeInput from './SlicerTimeInput.svelte';
	import CustomReplacesPicker, { kitGroupsOf } from './CustomReplacesPicker.svelte';
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
	/** Print time per file plate, seconds: from the file when sliced, typed otherwise. */
	let times = $state<Record<number, number | null>>({});
	/** Grams per print per file plate, as typed (decimal comma accepted). */
	let gramsText = $state<Record<number, string>>({});
	let colours = $state<Record<string, string>>({});
	let role = $state('');
	let replaces = $state<string[]>([]);
	let saveForLater = $state(false);
	/** "Add to every new build automatically" for the saved part (off: it is still offered in a setup). */
	let saveDefault = $state(false);
	/** File filaments set to "Not used in this build" (slot → true): their grams are dropped. */
	let ignored = $state<Record<string, boolean>>({});
	/** The option value of that choice in a color select (never a role key). */
	const IGNORE = '__ignore__';

	// The workspace's saved parts that this build does not hold yet.
	let library = $state<LibraryPiece[]>([]);
	let applying = $state<string | null>(null);
	/** The saved part whose replaced kit parts are being confirmed, and the parts checked for this add. */
	let confirming = $state<LibraryPiece | null>(null);
	let confirmReplaces = $state<string[]>([]);
	const offered = $derived(
		library.filter((l) => !view.customPieces.some((c) => c.libraryId === l.id))
	);
	$effect(() => {
		const org = view.build.organizationId;
		let live = true;
		listCustomLibrary(org)
			.then((r) => {
				if (live) library = r.pieces;
			})
			.catch(() => {
				/* the list is a shortcut; adding a file still works */
			});
		return () => {
			live = false;
		};
	});

	const haveCustom = $derived(view.customPieces.reduce((n, c) => n + c.plates.length, 0));
	const roomPlates = $derived(Math.max(0, MAX_CUSTOM_PLATES - haveCustom));
	const full = $derived(view.customPieces.length >= MAX_CUSTOM_PIECES);
	/** Same limit as a typed part weight on the server. */
	const MAX_GRAMS = 20000;
	const typedGrams = (i: number) => parseGrams(gramsText[i] ?? '');
	const gramsBad = (i: number) => {
		const g = typedGrams(i);
		return g !== null && (Number.isNaN(g) || g <= 0 || g > MAX_GRAMS);
	};
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
	const missingColour = $derived([...usedSlots].some((i) => !ignored[i] && !colours[i]));
	/** Grams of one print of a plate without the ignored filaments (the file's total less their grams). */
	function keptGrams(
		p: { grams: number | null; filamentGrams: Record<string, number> },
		ign: Record<string, boolean>
	) {
		const fg = Object.entries(p.filamentGrams ?? {}).filter(([, g]) => g > 0);
		const dropped = fg.reduce((a, [i, g]) => a + (ign[i] ? g : 0), 0);
		const kept = fg.reduce((a, [i, g]) => a + (ign[i] ? 0 : g), 0);
		if (p.grams && p.grams > 0 && dropped > 0) {
			const left = Math.round((p.grams - dropped) * 100) / 100;
			return left > 0 ? left : Math.round(kept * 100) / 100;
		}
		return p.grams && p.grams > 0 ? p.grams : kept > 0 ? Math.round(kept * 100) / 100 : null;
	}
	const showGrams = (g: number | null) => (g && g > 0 ? String(Math.round(g * 100) / 100) : '');
	/** A chosen plate that has grams but keeps no filament. */
	const nothingKept = $derived(
		sliced
			? chosen.find((p) => {
					const used = Object.entries(p.filamentGrams ?? {}).filter(([, g]) => g > 0);
					return used.length > 0 && used.every(([i]) => ignored[i]);
				})
			: undefined
	);
	/** Choose a color of the build, or "Not used in this build" (drops the slot's grams). */
	function setSlot(slot: string, value: string) {
		const was = { ...ignored };
		if (value === IGNORE) ignored[slot] = true;
		else {
			ignored[slot] = false;
			colours[slot] = value;
		}
		// a grams box still showing the file's number follows the kept filaments; a typed number stays
		for (const p of up?.summary.plates ?? [])
			if ((gramsText[p.index] ?? '') === showGrams(keptGrams(p, was)))
				gramsText[p.index] = showGrams(keptGrams(p, ignored));
	}
	const overCap = $derived(chosen.length > roomPlates);
	const badNumbers = $derived(
		chosen.some((p) => gramsBad(p.index) || (times[p.index] ?? 0) > MAX_PRINT_SECONDS)
	);
	const problem = $derived(
		full
			? `A build can have at most ${MAX_CUSTOM_PIECES} custom parts.`
			: !name.trim()
				? 'Give the part a name.'
				: !chosen.length
					? 'Choose at least one plate.'
					: overCap
						? `A build can have at most ${MAX_CUSTOM_PLATES} custom plates (${haveCustom} now).`
						: nothingKept
							? `Plate ${nothingKept.index} keeps no filament: leave at least one of its filaments in use.`
							: badNumbers
								? 'Check the print time (at most 30 days) and the grams (more than 0, at most 20000).'
								: missingColour
									? 'Choose a color for every filament the plates use.'
									: !sliced && !role
										? 'Choose a color.'
										: null
	);

	// Kit parts grouped by the plate they print on; the ones on no plate come last.
	const kitGroups = $derived(kitGroupsOf(view));
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
			times = Object.fromEntries(
				r.summary.plates.map((p) => [p.index, r.summary.sliced ? p.estSeconds : null])
			);
			gramsText = Object.fromEntries(
				r.summary.plates.map((p) => [
					p.index,
					r.summary.sliced && p.grams && p.grams > 0 ? String(Math.round(p.grams * 100) / 100) : ''
				])
			);
			runs = Object.fromEntries(
				r.summary.plates.map((p) => [p.index, Math.min(20, Math.max(1, p.runsHint || 1))])
			);
			colours = Object.fromEntries(
				Object.entries(r.suggestions.filamentMap).map(([i, k]) => [i, k ?? ''])
			);
			role = Object.values(colours).find(Boolean) ?? view.filaments[0]?.key ?? '';
			replaces = [];
			ignored = {};
			phase = 'review';
		} catch (e) {
			error = e instanceof Error ? e.message : 'The upload failed.';
			phase = 'pick';
		}
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
				// what is in the boxes: the file's own numbers come back unchanged, typed ones are stored as typed
				times: Object.fromEntries(
					chosen.flatMap((p) => (times[p.index] ? [[String(p.index), times[p.index]!]] : []))
				),
				grams: Object.fromEntries(
					chosen.flatMap((p) => {
						const g = typedGrams(p.index);
						return g && !Number.isNaN(g) ? [[String(p.index), g]] : [];
					})
				),
				...(sliced
					? {
							filamentMap: Object.fromEntries(
								[...usedSlots].filter((i) => !ignored[i]).map((i) => [i, colours[i]])
							),
							ignore: [...usedSlots].filter((i) => ignored[i])
						}
					: { role }),
				replaces
			});
			const n = r.plates.length;
			let msg = `Added "${name.trim()}": ${n} plate${n === 1 ? '' : 's'} (${r.plates.join(', ')}) after the kit's plates${r.skipped.length ? `; ${r.skipped.length} kit part${r.skipped.length === 1 ? '' : 's'} marked Not printing` : ''}.`;
			if (saveForLater) {
				// a failed save never undoes the add
				try {
					await saveCustomPieceToLibrary(view.build.id, r.pieceId, saveDefault);
					msg += saveDefault
						? ' Saved, and added to every new build automatically.'
						: ' Saved for new builds.';
				} catch (e) {
					msg += ` It could not be saved for new builds: ${e instanceof Error ? e.message : 'try the Save button on the part.'}`;
				}
			}
			ondone(msg);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not add the part.';
			phase = 'review';
		}
	}

	/** Kit parts a saved part would replace here: the same kit, and parts that are active in this build. */
	function savedReplaces(l: LibraryPiece): string[] {
		if (!l.templateId || l.templateId !== view.build.templateId) return [];
		const here = new Set(kitGroups.flatMap((g) => g.parts.map((p) => p.slug)));
		return l.replaces.filter((s) => here.has(s));
	}
	/** "Add" on a saved part: with kit parts to replace the maker confirms them first; otherwise it goes in. */
	function startSaved(l: LibraryPiece) {
		const pre = savedReplaces(l);
		if (!pre.length) return void applySaved(l);
		error = null;
		confirmReplaces = pre;
		confirming = l;
	}
	/** Add a saved part of the workspace to this build, without a file; `replaces` is the confirmed list. */
	async function applySaved(l: LibraryPiece, replacesNow?: string[]) {
		if (applying) return;
		applying = l.id;
		error = null;
		try {
			const r = await applyLibraryPiece(view.build.id, l.id, replacesNow);
			if ('already' in r) {
				ondone(`"${l.name}" is already in this build.`);
				return;
			}
			const n = r.plates.length;
			ondone(
				`Added "${l.name}": ${n} plate${n === 1 ? '' : 's'} (${r.plates.join(', ')}) after the kit's plates${r.skipped.length ? `; replaced ${r.skipped.map(nameOfKit).join(', ')} (marked Not printing)` : ''}.`
			);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not add the part.';
			applying = null;
		}
	}

	async function cancel() {
		if (confirming && !applying) {
			confirming = null;
			return;
		}
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
		{#if phase === 'pick' && confirming}
			{@const l = confirming}
			<div class="cpu-saved cpu-confirm" data-testid="custom-saved-confirm-step">
				<h3>Add "{l.name}"</h3>
				<p class="meta">
					It replaces the kit parts checked below: they are marked Not printing in this build. You
					can bring them back later; nothing is deleted.
				</p>
				<CustomReplacesPicker
					groups={kitGroups}
					bind:selected={confirmReplaces}
					open
					optional={false}
					primary={confirmReplaces}
					testid="custom-saved-replaces"
					hint="Checked: the parts this saved part replaces. Uncheck one to keep printing it, or check another to skip it."
				/>
				{#if confirmReplaces.length}
					<p class="meta cpu-sel">
						Marked Not printing: {confirmReplaces.map(nameOfKit).join(', ')}
					</p>
				{:else}
					<p class="meta cpu-sel">No kit part is marked Not printing.</p>
				{/if}
				<div class="cpu-actions">
					<button
						class="btn"
						type="button"
						data-testid="custom-saved-cancel"
						disabled={!!applying}
						onclick={() => (confirming = null)}>Cancel</button
					>
					<button
						class="btn primary"
						type="button"
						data-testid="custom-saved-confirm"
						disabled={!!applying}
						onclick={() => applySaved(l, confirmReplaces)}
						>{applying ? 'Adding…' : 'Add to build'}</button
					>
				</div>
			</div>
		{:else if phase === 'pick' && offered.length}
			<div class="cpu-saved" data-testid="custom-saved-list">
				<h3>Saved custom parts</h3>
				<ul>
					{#each offered as l (l.id)}
						<li class="ds-card ds-card--compact cpu-saved-row">
							<div class="cpu-info">
								<b>{l.name}</b>
								<span class="meta">
									{l.plates.length} plate{l.plates.length === 1 ? '' : 's'}
									· {l.totalSeconds ? fmtH(l.totalSeconds) : 'no time'}
									· {l.totalGrams ? `${fmt(l.totalGrams)} g` : 'no grams'}
									{#if l.replaces.length}· replaces {l.replaces.length} kit part{l.replaces
											.length === 1
											? ''
											: 's'}{/if}
								</span>
							</div>
							<button
								class="btn sm"
								type="button"
								data-testid="custom-saved-add"
								disabled={!!applying || full}
								onclick={() => startSaved(l)}>{applying === l.id ? 'Adding…' : 'Add'}</button
							>
						</li>
					{/each}
				</ul>
				<h3>Or add a file</h3>
			</div>
		{/if}
		{#if phase === 'pick' && !confirming}
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
		{:else if phase === 'uploading'}
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
		<label class="cpu-field">
			<span class="cpu-label">Name</span>
			<input
				type="text"
				bind:value={name}
				maxlength={CUSTOM_NAME_MAX}
				data-testid="custom-name"
				autocomplete="off"
				aria-describedby="cpu-name-hint"
			/>
			<span class="meta" id="cpu-name-hint">Shown on the Print tab and in saved parts.</span>
		</label>
		<p class="meta cpu-sum">
			<b>{fileName}</b>
			· {s.sliced ? 'sliced' : 'not sliced'}
			{#if s.printer}· {s.printer}{/if}
		</p>
		{#each s.warnings as w (w)}<p class="cpu-note">{w}</p>{/each}
		{#if !s.sliced}
			<p class="cpu-note" data-testid="custom-unsliced-note">
				This file has no print time or weight in it. A project saved from the slicer does not keep
				them: export the sliced file instead (in Bambu Studio, Orca or Elegoo Slicer: slice, then
				Export, Export plate sliced file, a .gcode.3mf), or type the time and grams below.
			</p>
		{/if}

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
								no time or grams in the file
							{/if}
						</span>
					</div>
					<div class="cpu-nums">
						<SlicerTimeInput
							label="Print time"
							value={times[pl.index]}
							placeholder="e.g. 2h 30m"
							title="Time of one print of this plate. Type what your slicer shows."
							disabled={!include[pl.index]}
							onsave={(sec) => (times[pl.index] = sec)}
						/>
						<label class="slicer-in cpu-grams" title="Grams of one print of this plate.">
							Grams
							<input
								type="text"
								inputmode="decimal"
								autocomplete="off"
								placeholder="g"
								class="cpu-g-in"
								aria-label="Grams of one print of plate {pl.index}"
								aria-invalid={gramsBad(pl.index)}
								data-testid="custom-plate-grams"
								disabled={!include[pl.index]}
								bind:value={gramsText[pl.index]}
							/>
						</label>
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
						<label class="cpu-slot" class:off={ignored[String(f.index)]}>
							<span class="cpu-swatch" style="background:{f.color ?? 'transparent'}"></span>
							<span class="cpu-fl">#{f.index} {f.type}{f.name ? ` · ${f.name}` : ''}</span>
							<select
								value={ignored[String(f.index)] ? IGNORE : (colours[String(f.index)] ?? '')}
								onchange={(e) => setSlot(String(f.index), e.currentTarget.value)}
								data-testid="custom-slot-color"
								aria-label="Build color for #{f.index}"
							>
								<option value="">Choose…</option>
								{#each view.filaments as r (r.key)}
									<option value={r.key}>{r.name} ({r.material})</option>
								{/each}
								<option value={IGNORE} data-testid="custom-slot-ignore"
									>Not used in this build</option
								>
							</select>
						</label>
					{/if}
				{/each}
				{#if !usedSlots.size}<p class="meta">The chosen plates use no filament weight.</p>{/if}
				{#if usedSlots.size}
					<p class="meta">
						Set a filament to "Not used in this build" to leave out its grams, for example PLA
						supports. The plate's time stays as sliced.
					</p>
				{/if}
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

		<CustomReplacesPicker groups={kitGroups} bind:selected={replaces} />

		<label class="cpu-save">
			<input type="checkbox" bind:checked={saveForLater} data-testid="custom-save-library" />
			<span>
				<b>Save for new builds</b>
				<span class="meta"
					>Keeps its plates, time and grams for this workspace. The file is not kept.</span
				>
			</span>
		</label>

		{#if saveForLater}
			<label class="cpu-save cpu-save-default">
				<input type="checkbox" bind:checked={saveDefault} data-testid="custom-save-default" />
				<span>
					<b>Add to every new build automatically</b>
					<span class="meta">Off: it is still offered when you set up a build.</span>
				</span>
			</label>
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
	.cpu-nums {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4) var(--sp-5);
		flex: 1 1 100%;
	}
	.cpu-nums :global(.slicer-in) {
		display: grid;
		gap: var(--sp-1);
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.cpu .cpu-nums :global(input[type='text']) {
		width: 9em;
		padding: 7px var(--sp-4);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--card);
		color: var(--ink);
		font-size: var(--fs-md);
		text-align: left;
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
	.cpu-saved {
		display: grid;
		gap: var(--sp-4);
	}
	.cpu-saved ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-4);
	}
	.cpu-saved-row {
		display: flex;
		align-items: center;
		gap: var(--sp-4) var(--sp-5);
		background: var(--paper);
	}
	.cpu-saved-row .cpu-info {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
		flex: 1 1 140px;
		overflow-wrap: anywhere;
	}
	.cpu-save {
		display: flex;
		gap: var(--sp-4);
		align-items: flex-start;
		min-height: 32px;
	}
	.cpu-save-default {
		margin-left: var(--sp-8);
	}
	.cpu-slot.off .cpu-fl {
		color: var(--muted);
		text-decoration: line-through;
	}
	.cpu-save > span {
		display: grid;
		gap: var(--sp-1);
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
		.cpu .cpu-nums :global(input[type='text']) {
			font-size: var(--fs-field);
			min-height: 40px;
		}
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
