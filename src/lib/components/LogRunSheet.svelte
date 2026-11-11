<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		RUN_RESULTS,
		type PrintRun,
		type PrintRunInput,
		type RunResult
	} from '#lib/domain/types.ts';
	import {
		durText,
		elapsedSeconds,
		fmt,
		hoursFromSeconds,
		parseDur,
		recomputeParts,
		runInfo,
		runTargets,
		runOutcomeSummary,
		snapshotParts,
		toLocalInput,
		today
	} from '#lib/domain/index.ts';
	import { deleteRun, logRun, undoRun, updateRun } from '#lib/client/api.ts';
	import { focusIn } from '#lib/client/focus-trap.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import { toasts } from './toast.svelte.ts';

	let {
		open = $bindable(false),
		plateNumber: plateNumberIn = null,
		slugs: slugsIn = [],
		startedAt = null,
		title: titleIn = 'Log print',
		editRun = null,
		deleteFirst = false,
		quick = false
	}: {
		open?: boolean;
		/** Plate this run belongs to; null logs against a single part. */
		plateNumber?: number | null;
		/** Parts the run concerns (those on the printer, or the whole plate, or one part). */
		slugs?: string[];
		/** When the print started, if known: prefills the total time. */
		startedAt?: string | null;
		title?: string;
		/** Edit this past log instead of creating a new one. */
		editRun?: PrintRun | null;
		/** With `editRun`: open straight at the delete confirmation (from a Delete button in a log table). */
		deleteFirst?: boolean;
		/**
		 * "Log a whole plate" shortcut: Success preselected, time prefilled from the plate's
		 * slicer/learned time (or started to now), grams from the slicer/learned grams per run.
		 */
		quick?: boolean;
	} = $props();

	const ctx = getBuildCtx();
	const title = $derived(editRun ? 'Edit print log' : titleIn);
	const plateNumber = $derived(editRun ? editRun.plateNumber : plateNumberIn);
	const slugs = $derived(editRun ? runTargets(ctx.view, editRun) : slugsIn);
	const uid = $props.id();

	let dlg = $state<HTMLDialogElement>();
	let trigger: HTMLElement | null = null;

	let result = $state<RunResult | null>(null);
	let fin = $state('');
	let dur = $state('');
	let durEdited = $state(false);
	let grams = $state('');
	let gramsEdited = $state(false);
	let note = $state('');
	let picked = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let editDate = $state('');
	let confirmDelete = $state(false);
	let keepStatuses = $state(false);

	const plate = $derived(
		plateNumber == null ? null : (ctx.view.plates.find((p) => p.number === plateNumber) ?? null)
	);
	const pickable = $derived(!!plate?.perPartRuns && slugs.length > 1);
	const partOf = (slug: string) => ctx.view.parts.find((p) => p.slug === slug);
	const pickedSlug = $derived(plate?.perPartRuns ? picked || slugs[0] : null);

	const finDate = $derived.by(() => {
		const d = fin ? new Date(fin) : new Date();
		return isNaN(d.getTime()) ? new Date() : new Date(Math.min(d.getTime(), Date.now()));
	});

	const slicerDefault = $derived.by(() => {
		if (!plate) return null;
		const v = plate.perPartRuns ? plate.slicerByPart[pickedSlug ?? slugs[0]] : plate.slicerGrams;
		if (typeof v === 'number' && v > 0) return v;
		if (quick && !plate.perPartRuns) {
			const sum = Object.values(plate.filamentGrams).reduce((a, b) => a + b, 0);
			if (sum > 0) return Math.round(sum);
		}
		return null;
	});
	const gramsSource = $derived(
		plate?.estSource === 'learned' && plate.slicerGrams == null
			? 'From your slice; edit if different.'
			: 'From your slicer; edit if different.'
	);
	/** The plate's own time per run, used when the print has no start time. */
	const planned = $derived(quick && !startedAt && plate?.estSeconds ? plate.estSeconds : null);
	const plannedLabel = $derived(
		plate?.estSource === 'manual'
			? 'Your entered time'
			: plate?.estSource === 'slicer'
				? 'From your slicer'
				: plate?.estSource === 'learned'
					? 'From your slice'
					: plate?.estSource === 'profile'
						? "From the template's profile"
						: "Estimate from MakeGood's X/P/A times"
	);
	const runLine = $derived.by(() => {
		if (!quick || !plate) return '';
		const info = runInfo(
			ctx.view,
			plate.number,
			plate.perPartRuns ? pickedSlug || undefined : undefined
		);
		return info ? `Print ${info.run} of ${info.of}. ` : '';
	});
	const bomEstimate = $derived.by(() => {
		if (plate?.perPartRuns) {
			const g = partOf(pickedSlug ?? slugs[0])?.bomGrams ?? 0;
			return g / Math.max(1, plate.runs);
		}
		const runs = Math.max(1, plate?.runs ?? 1);
		return slugs.reduce((a, s) => a + (partOf(s)?.bomGrams ?? 0), 0) / (plate ? runs : 1);
	});
	// A failed print did not use the plate's grams: leave it empty (counts as 0 g) unless typed.
	const gramsShown = $derived(
		gramsEdited
			? grams
			: slicerDefault != null && result !== 'Failed' && !editRun
				? String(slicerDefault)
				: ''
	);

	const durSeconds = $derived(dur.trim() === '' ? null : parseDur(dur));
	const durInvalid = $derived(dur.trim() !== '' && durSeconds == null);
	const gramsInvalid = $derived(gramsShown !== '' && !(Number(gramsShown) >= 0));

	function buildInput(
		res: RunResult | null
	): Omit<PrintRunInput, 'result'> & { result: RunResult | null } {
		const subset = plate && !plate.perPartRuns && slugs.length < plate.parts.length ? slugs : null;
		return {
			plateNumber: plate ? plate.number : null,
			partSlug: plate ? pickedSlug : (slugs[0] ?? null),
			partSlugs: subset,
			date: editRun ? editDate : toLocalInput(finDate).slice(0, 10) || today(),
			result: res,
			grams: gramsShown === '' ? null : Number(gramsShown),
			hours: hoursFromSeconds(durSeconds),
			printer: null,
			note: note.trim()
		};
	}
	const nameOf = (s: string) => partOf(s)?.name ?? s;
	const statusChange = (patches: ReturnType<typeof recomputeParts>) =>
		patches
			.filter((p) => p.status && p.status !== ctx.view.state[p.slug]?.status)
			.map(
				(p) =>
					`${nameOf(p.slug)} ${p.status === 'To print' ? 'goes back to' : 'becomes'} ${p.status}`
			);
	const sentence = (l: string[]) =>
		l.length < 2 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
	/** Edit mode: parts whose status the saved edit would change. */
	const editNext = $derived.by((): PrintRun | null => {
		if (!editRun || !result) return null;
		return {
			...editRun,
			result,
			date: editDate || editRun.date,
			grams: gramsShown === '' ? null : Number(gramsShown),
			hours: hoursFromSeconds(durSeconds),
			note: note.trim()
		};
	});
	const editChanges = $derived.by(() => {
		if (!editRun || !editNext) return [];
		const touched = editNext.result !== editRun.result || editNext.date !== editRun.date;
		if (!touched) return [];
		const runs = ctx.view.runs
			.map((r) => (r.id === editRun.id ? editNext : r))
			.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
		return statusChange(recomputeParts(ctx.view, runs, slugs));
	});
	const deleteChanges = $derived.by(() => {
		if (!editRun) return [];
		return statusChange(
			recomputeParts(
				ctx.view,
				ctx.view.runs.filter((r) => r.id !== editRun.id),
				slugs
			)
		);
	});
	const summary = $derived(
		editRun
			? editChanges.length
				? `Saving: ${sentence(editChanges)}.`
				: 'Saving changes the log only; part statuses stay as they are.'
			: runLine + runOutcomeSummary(ctx.view, buildInput(result))
	);
	const canSave = $derived(!!result && !durInvalid && !gramsInvalid && !busy);

	function recalc() {
		if (!durEdited) dur = durText(startedAt ? elapsedSeconds(startedAt, finDate) : planned);
	}
	function setFin(v: string) {
		fin = v;
		recalc();
	}
	function setNow() {
		setFin(toLocalInput(new Date()));
	}

	function init() {
		result = null;
		note = '';
		grams = '';
		gramsEdited = false;
		durEdited = false;
		confirmDelete = !!editRun && deleteFirst;
		keepStatuses = false;
		editDate = today();
		picked = slugs[0] ?? '';
		error = null;
		busy = false;
		fin = toLocalInput(new Date());
		dur = durText(startedAt ? elapsedSeconds(startedAt, new Date()) : planned);
		if (quick && !editRun) result = 'Success';
		if (editRun) {
			result = editRun.result;
			note = editRun.note;
			grams = editRun.grams == null ? '' : String(editRun.grams);
			gramsEdited = true;
			dur = durText(editRun.hours == null ? null : Math.round(editRun.hours * 3600));
			durEdited = true;
			editDate = editRun.date;
		}
	}

	$effect(() => {
		if (!dlg) return;
		if (open && !dlg.open) {
			untrack(init);
			trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			dlg.showModal();
		} else if (!open && dlg.open) {
			dlg.close();
		}
	});

	function onclose() {
		open = false;
		const t = trigger;
		trigger = null;
		if (t?.isConnected) t.focus();
	}
	// Escape while the delete confirmation is up cancels only the confirmation, not the sheet.
	function oncancel(e: Event) {
		if (confirmDelete && editRun) {
			e.preventDefault();
			keepLog();
		}
	}
	let delBtn = $state<HTMLButtonElement>();
	async function keepLog() {
		confirmDelete = false;
		await tick();
		delBtn?.focus();
	}
	function onbackdrop(e: MouseEvent) {
		if (e.target === dlg) open = false;
	}

	function label(): string {
		if (plate) return `plate ${plate.number}`;
		return partOf(slugs[0])?.name ?? 'part';
	}

	async function remove() {
		if (!editRun) return;
		busy = true;
		error = null;
		try {
			await deleteRun(ctx.id, editRun.id, { recompute: !keepStatuses });
			await ctx.refresh();
			open = false;
			toasts.push('Print log deleted');
		} catch (err) {
			error = err instanceof Error ? err.message : 'That did not delete.';
			await ctx.refresh();
		} finally {
			busy = false;
		}
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!canSave || !result) return;
		busy = true;
		error = null;
		if (editRun) {
			const d = editNext;
			if (!d) return;
			const patch: Parameters<typeof updateRun>[2] = {};
			if (d.result !== editRun.result) patch.result = d.result;
			if (d.date !== editRun.date) patch.date = d.date;
			if (d.grams !== editRun.grams) patch.grams = d.grams;
			if (d.hours !== editRun.hours) patch.hours = d.hours;
			if (d.note !== editRun.note) patch.note = d.note;
			try {
				if (Object.keys(patch).length) await updateRun(ctx.id, editRun.id, patch);
				await ctx.refresh();
				open = false;
				toasts.push('Print log updated');
			} catch (err) {
				error = err instanceof Error ? err.message : 'That did not save.';
				await ctx.refresh();
			} finally {
				busy = false;
			}
			return;
		}
		const input = { ...buildInput(result), result } as PrintRunInput;
		const before = snapshotParts(ctx.view, slugs);
		try {
			const runId = await logRun(ctx.id, input);
			await ctx.refresh();
			const buildId = ctx.id;
			open = false;
			toasts.push(`Logged ${label()} · ${result}`, {
				label: 'Undo',
				run: async () => {
					const ok = await ctx.act(() => undoRun(buildId, runId, before));
					if (ok) toasts.push('Undone');
				}
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'That did not save.';
			await ctx.refresh();
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	bind:this={dlg}
	class="sheet"
	aria-labelledby="{uid}-t"
	{onclose}
	{oncancel}
	onclick={onbackdrop}
>
	{#if open}
		<form onsubmit={save}>
			<header>
				<h2 id="{uid}-t">{title}</h2>
				<button class="x" type="button" aria-label="Cancel" onclick={() => (open = false)}>×</button
				>
			</header>

			<fieldset class="res">
				<legend>Result</legend>
				<div class="segbtns" role="group" aria-label="Result">
					{#each RUN_RESULTS as r (r)}
						<button
							type="button"
							data-v={r}
							aria-pressed={result === r}
							onclick={() => (result = r)}>{r}</button
						>
					{/each}
				</div>
			</fieldset>

			{#if pickable}
				<label class="f" for="{uid}-part"
					>Which color/part was this print
					<select id="{uid}-part" bind:value={picked}>
						{#each slugs as s (s)}
							<option value={s}
								>{partOf(s)?.name} ({filLabel(
									ctx.filament(partOf(s)?.role ?? ''),
									partOf(s)?.role
								)})</option
							>
						{/each}
					</select>
				</label>
			{/if}

			{#if editRun}
				<label class="f" for="{uid}-date"
					>Date
					<input id="{uid}-date" type="date" max={today()} required bind:value={editDate} />
				</label>
			{:else}
				<label class="f" for="{uid}-fin"
					>Finished at
					<span class="inline">
						<input
							id="{uid}-fin"
							type="datetime-local"
							max={toLocalInput(new Date())}
							value={fin}
							onchange={(e) => setFin(e.currentTarget.value)}
						/>
						<button class="btn sm" type="button" onclick={setNow}>Now</button>
					</span>
				</label>
			{/if}

			<label class="f" for="{uid}-dur"
				>Total print time
				<input
					id="{uid}-dur"
					type="text"
					inputmode="text"
					autocomplete="off"
					placeholder="e.g. 13h 07m, 13:07 or 1.5"
					aria-invalid={durInvalid}
					value={dur}
					oninput={(e) => {
						dur = e.currentTarget.value;
						durEdited = true;
					}}
				/>
				{#if durInvalid}<small class="err">Try 13h 07m, 13:07 or 1.5 (hours).</small>
				{:else if startedAt && !durEdited}<small>From the start time to finish.</small>
				{:else if planned && !durEdited}<small>{plannedLabel}; edit if different.</small>{/if}
			</label>

			<label class="f" for="{uid}-g"
				>Filament used (g)
				<input
					id="{uid}-g"
					type="number"
					min="0"
					step="1"
					inputmode="decimal"
					placeholder={result === 'Failed'
						? 'optional'
						: bomEstimate > 0
							? `BOM ~${fmt(bomEstimate)}`
							: 'g'}
					value={gramsShown}
					oninput={(e) => {
						grams = e.currentTarget.value;
						gramsEdited = true;
					}}
				/>
				{#if result === 'Failed' && !gramsEdited}<small
						>Optional: grams actually used. Left empty it counts as 0 g.</small
					>
				{:else if slicerDefault != null && !gramsEdited && !editRun}<small>{gramsSource}</small
					>{/if}
			</label>

			<label class="f" for="{uid}-n"
				>Notes
				<textarea
					id="{uid}-n"
					rows="3"
					placeholder="Warping, stringing, fit…"
					maxlength="2000"
					bind:value={note}></textarea>
			</label>

			<p class="summary" aria-live="polite">
				{summary || 'Choose a result to see what saving will do.'}
			</p>
			{#if error}<p class="err" role="alert">{error}</p>{/if}

			{#if editRun && confirmDelete}
				<div
					class="confirm"
					role="alertdialog"
					aria-label="Confirm delete"
					use:focusIn={'[data-keep]'}
				>
					<p>
						Delete this log?
						{#if deleteChanges.length && !keepStatuses}{sentence(deleteChanges)}.{:else}Part
							statuses stay as they are.{/if}
					</p>
					{#if deleteChanges.length}
						<label class="chk"
							><input type="checkbox" bind:checked={keepStatuses} /> Keep part statuses as they are</label
						>
					{/if}
					<div class="confirm-acts">
						<button class="btn" type="button" data-keep onclick={keepLog}>Keep it</button>
						<button class="btn danger" type="button" disabled={busy} onclick={remove}
							>Delete log</button
						>
					</div>
				</div>
			{/if}

			<footer>
				{#if editRun && !confirmDelete}
					<button
						bind:this={delBtn}
						class="btn danger del"
						type="button"
						onclick={() => (confirmDelete = true)}>Delete</button
					>
				{/if}
				<button class="btn" type="button" onclick={() => (open = false)}>Cancel</button>
				<button class="btn primary" type="submit" disabled={!canSave}>Save</button>
			</footer>
		</form>
	{/if}
</dialog>

<style>
	.sheet {
		border: 1px solid var(--line);
		border-radius: var(--r-xl);
		background: var(--card);
		color: var(--ink);
		padding: 0;
		width: min(480px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow: auto;
	}
	.sheet::backdrop {
		background: var(--scrim);
	}
	form {
		display: grid;
		gap: var(--sp-7);
		padding: var(--sp-8);
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-family: var(--f-display);
		font-size: var(--fs-xl);
	}
	.x {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: var(--fs-xl);
		line-height: 1;
		padding: var(--sp-2) var(--sp-5);
		cursor: pointer;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	legend,
	.f {
		font-size: var(--fs-sm);
		color: var(--muted);
		padding: 0;
	}
	.f {
		display: grid;
		gap: var(--sp-2);
		min-width: 0;
	}
	legend {
		margin-bottom: var(--sp-2);
	}
	input,
	select,
	textarea {
		width: 100%;
		min-width: 0;
		padding: var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: var(--fs-field);
	}
	textarea {
		resize: vertical;
	}
	.inline {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
	}
	.segbtns {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		overflow: hidden;
	}
	.segbtns button {
		border: 0;
		border-right: 1px solid var(--line);
		background: var(--paper);
		color: var(--ink);
		padding: var(--sp-6) var(--sp-3);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.segbtns button:last-child {
		border-right: 0;
	}
	.segbtns button[aria-pressed='true'][data-v='Success'] {
		background: var(--ok-soft);
		color: var(--ok);
	}
	.segbtns button[aria-pressed='true'][data-v='Failed'] {
		background: var(--bad-soft);
		color: var(--bad);
	}
	.segbtns button[aria-pressed='true'][data-v='Partial'] {
		background: var(--warn-soft);
		color: var(--warn);
	}
	/* Colour is not the only cue for the chosen result: an underline in the text colour too. */
	.segbtns button[aria-pressed='true'] {
		box-shadow: inset 0 -3px 0 currentColor;
	}
	small {
		color: var(--muted);
	}
	.err {
		color: var(--bad);
		font-size: var(--fs-sm);
		margin: 0;
	}
	.summary {
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--r-lg);
		background: var(--accent-soft);
		color: var(--ink);
		font-size: var(--fs-md);
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-4);
	}
	.del {
		margin-right: auto;
	}
	.confirm {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border-radius: var(--r-lg);
		background: var(--bad-soft);
		color: var(--ink);
	}
	.confirm p {
		margin: 0;
		font-size: var(--fs-md);
	}
	.confirm .confirm-acts {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-4);
	}
	.chk {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		font-size: var(--fs-sm);
	}
	.chk input {
		width: auto;
	}
	@media (max-width: 760px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			margin: auto 0 0;
			border-radius: var(--r-xl) var(--r-xl) 0 0;
			max-height: 92dvh;
		}
		footer .btn {
			flex: 1;
			padding: var(--sp-6) var(--sp-7);
		}
	}
</style>
