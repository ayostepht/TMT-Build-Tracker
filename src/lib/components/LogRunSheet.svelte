<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		RUN_RESULTS,
		type GramsInfo,
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
		partGrams,
		partialPrefill,
		partialTicksOk,
		plateGrams,
		progressGrams,
		recomputeParts,
		runInfo,
		runTargets,
		runOutcomeSummary,
		snapshotParts,
		startedOnPrinter,
		toLocalInput,
		today,
		weakestGramsSource
	} from '#lib/domain/index.ts';
	import { parseGrams } from '#lib/domain/logrun.ts';
	import { deleteRun, logRun, undoRun, updateRun, type PartialSplitBody } from '#lib/client/api.ts';
	import { focusIn } from '#lib/client/focus.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import PartialParts from './PartialParts.svelte';
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
	const pstore = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	$effect(() => pstore.acquire());

	let dlg = $state<HTMLDialogElement>();
	let trigger: HTMLElement | null = null;

	let result = $state<RunResult | null>(null);
	let fin = $state('');
	let dur = $state('');
	let durEdited = $state(false);
	let grams = $state('');
	let gramsEdited = $state(false);
	/** Partial: which parts printed OK, and the grams of each half. */
	let ticked = $state<string[]>([]);
	let keptG = $state('');
	let keptEdited = $state(false);
	let lostG = $state('');
	let lostEdited = $state(false);
	/** "How far did it get?" (%), typed when no printer reported progress. */
	let pct = $state('');
	let pctEdited = $state(false);
	let note = $state('');
	let picked = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let editDate = $state('');
	let confirmDelete = $state(false);
	let keepStatuses = $state(false);
	/** Printer name for the log; '' = not set. */
	let printer = $state('');
	const printerNames = $derived(
		[...new Set(pstore.printers.filter((p) => p.enabled).map((p) => p.name))].sort((a, b) =>
			a.localeCompare(b)
		)
	);
	// A saved or remembered name that is no longer a listed printer stays selectable.
	const printerOptions = $derived(
		printer && !printerNames.includes(printer) ? [...printerNames, printer] : printerNames
	);
	const showPrinter = $derived(printerNames.length > 0 || !!printer);
	/** Where this plate was started ("Where is it printing?"), else the connected printer running its job. */
	function guessPrinter(): string {
		const a = startedOnPrinter(ctx.view, slugs, plateNumber);
		if (a) return a;
		const job = pstore.jobs.find(
			(j) =>
				j.buildId === ctx.id &&
				(j.status === 'printing' || j.status === 'paused') &&
				(plateNumber != null
					? j.plateNumber === plateNumber
					: (j.partSlugs ?? []).some((s) => slugs.includes(s)))
		);
		return job?.printerName ?? '';
	}

	const plate = $derived(
		plateNumber == null ? null : (ctx.view.plates.find((p) => p.number === plateNumber) ?? null)
	);
	const pickable = $derived(!!plate?.perPartRuns && slugs.length > 1);
	const partOf = (slug: string) => ctx.view.parts.find((p) => p.slug === slug);
	const pickedSlug = $derived(plate?.perPartRuns ? picked || slugs[0] : null);
	// Partial = "some parts of the plate printed OK": offered where those parts can be told apart (a
	// single-run plate of two or more parts), and when editing an older Partial row.
	const splittable = $derived(
		!editRun && !!plate && !plate.perPartRuns && slugs.length >= 2 && plate.runs <= 1
	);
	const resultOptions = $derived(
		RUN_RESULTS.filter((r) => r !== 'Partial' || splittable || editRun?.result === 'Partial')
	);
	const splitMode = $derived(result === 'Partial' && splittable);
	const ticksOk = $derived(partialTicksOk(slugs, ticked));
	/** The linked or most recent printer job of this plate that is not logged yet, with its progress. */
	const progressJob = $derived.by(() => {
		const jobs = pstore.jobs.filter(
			(j) =>
				j.buildId === ctx.id &&
				j.runId == null &&
				j.progress != null &&
				(plateNumber != null
					? j.plateNumber === plateNumber
					: (j.partSlugs ?? []).some((s) => slugs.includes(s)))
		);
		return jobs.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0] ?? null;
	});

	const finDate = $derived.by(() => {
		const d = fin ? new Date(fin) : new Date();
		return isNaN(d.getTime()) ? new Date() : new Date(Math.min(d.getTime(), Date.now()));
	});

	// The grams this print is expected to use, from the one source order (see domain/accounting.ts).
	const gramsInfo = $derived.by((): GramsInfo => {
		if (plate) {
			return plate.perPartRuns
				? partGrams(ctx.view, pickedSlug ?? slugs[0])
				: plateGrams(ctx.view, plate);
		}
		const infos = slugs.map((s) => partGrams(ctx.view, s));
		return {
			perRun: infos.reduce((a, i) => a + i.total, 0),
			total: infos.reduce((a, i) => a + i.total, 0),
			source: weakestGramsSource(infos.map((i) => i.source)),
			approx: infos.some((i) => i.approx),
			unknown: infos.flatMap((i) => i.unknown)
		};
	});
	// Prefill only a real number (typed, slicer or your slice), never a BOM guess or a partial total.
	const slicerDefault = $derived.by(() => {
		const i = gramsInfo;
		if (!plate || !(i.perRun > 0) || i.unknown.length) return null;
		if (i.source === 'bom' || i.source === 'none') return null;
		// Grams are stored as decimals; keep two places so the prefill is a tidy number.
		return Math.round(i.perRun * 100) / 100;
	});
	const gramsSource = $derived(
		gramsInfo.source === 'user'
			? 'Your entered weight; edit if different.'
			: gramsInfo.source === 'slice'
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
	// How far the print got (0 to 100): the printer's progress, else what the maker types (empty for
	// Failed, 100 for Partial).
	const jobProgress = $derived(progressJob?.progress ?? null);
	const pctShown = $derived(pctEdited ? pct : result === 'Partial' ? '100' : '');
	const pctNum = $derived.by(() => {
		const t = pctShown.trim().replace(',', '.');
		if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
		return Math.min(100, Number(t));
	});
	const progressNow = $derived(jobProgress ?? pctNum);
	const showPct = $derived(
		!editRun &&
			!!plate &&
			slicerDefault != null &&
			jobProgress == null &&
			(result === 'Failed' || splitMode)
	);
	// A failed print did not use all of the plate's grams: prefill the share that went by (printer
	// progress or the typed %), else leave it empty (counts as 0 g) unless typed.
	const failedPrefill = $derived(
		result === 'Failed' && !editRun ? progressGrams(slicerDefault, progressNow) : null
	);
	const gramsShown = $derived(
		gramsEdited
			? grams
			: failedPrefill != null
				? String(failedPrefill)
				: slicerDefault != null && result !== 'Failed' && !editRun
					? String(slicerDefault)
					: ''
	);
	const splitPre = $derived(
		splitMode ? partialPrefill(ctx.view, slugs, ticked, slicerDefault, progressNow) : null
	);
	const keptShown = $derived(
		keptEdited ? keptG : splitPre?.keptGrams != null ? String(splitPre.keptGrams) : ''
	);
	const lostShown = $derived(
		lostEdited ? lostG : splitPre?.lostGrams != null ? String(splitPre.lostGrams) : ''
	);
	const keptParsed = $derived(parseGrams(keptShown));
	const lostParsed = $derived(parseGrams(lostShown));
	const keptInvalid = $derived(keptParsed !== null && Number.isNaN(keptParsed));
	const lostInvalid = $derived(lostParsed !== null && Number.isNaN(lostParsed));
	const fromProgress = $derived(
		(failedPrefill != null && !gramsEdited) ||
			(splitPre != null &&
				(!keptEdited || !lostEdited) &&
				(splitPre.keptGrams ?? splitPre.lostGrams) != null)
	);

	const durSeconds = $derived(dur.trim() === '' ? null : parseDur(dur));
	const durInvalid = $derived(dur.trim() !== '' && durSeconds == null);
	const gramsParsed = $derived(parseGrams(gramsShown));
	const gramsInvalid = $derived(gramsParsed !== null && Number.isNaN(gramsParsed));

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
			grams: splitMode ? null : gramsParsed,
			hours: hoursFromSeconds(durSeconds),
			printer: printer || null,
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
			grams: gramsParsed,
			hours: hoursFromSeconds(durSeconds),
			printer: printer || null,
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
			: runLine +
					(splitMode && !ticksOk
						? 'Tick the parts that printed OK, or choose Success or Failed.'
						: runOutcomeSummary(ctx.view, buildInput(result), splitMode ? ticked : null))
	);
	const canSave = $derived(!!result && !durInvalid && !busy && (!splitMode || ticksOk));

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
		ticked = [];
		keptG = '';
		keptEdited = false;
		lostG = '';
		lostEdited = false;
		pct = '';
		pctEdited = false;
		durEdited = false;
		confirmDelete = !!editRun && deleteFirst;
		keepStatuses = false;
		printer = editRun ? (editRun.printer ?? '') : guessPrinter();
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
	let errEl = $state<HTMLParagraphElement>();
	/** A rejected save shows its reason in the sheet and moves focus to it. */
	async function showError(msg: string) {
		error = msg;
		await tick();
		errEl?.focus();
	}
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
			void showError(err instanceof Error ? err.message : 'That did not delete.');
			await ctx.refresh();
		} finally {
			busy = false;
		}
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!canSave || !result) return;
		if (splitMode ? keptInvalid || lostInvalid : gramsInvalid) {
			document.getElementById(`${uid}-${splitMode ? (keptInvalid ? 'gk' : 'gl') : 'g'}`)?.focus();
			return;
		}
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
			if (d.printer !== editRun.printer) patch.printer = d.printer;
			if (d.note !== editRun.note) patch.note = d.note;
			try {
				if (Object.keys(patch).length) await updateRun(ctx.id, editRun.id, patch);
				await ctx.refresh();
				open = false;
				toasts.push('Print log updated');
			} catch (err) {
				void showError(err instanceof Error ? err.message : 'That did not save.');
				await ctx.refresh();
			} finally {
				busy = false;
			}
			return;
		}
		const input = {
			...buildInput(result),
			result,
			...(splitMode
				? {
						split: {
							keptSlugs: slugs.filter((s) => ticked.includes(s)),
							keptGrams: keptParsed,
							lostGrams: lostParsed
						}
					}
				: {})
		} as PrintRunInput & { split?: PartialSplitBody };
		const before = snapshotParts(ctx.view, slugs);
		try {
			const { id: runId, ids } = await logRun(ctx.id, input);
			await ctx.refresh();
			const buildId = ctx.id;
			open = false;
			toasts.push(`Logged ${label()} · ${result}`, {
				label: 'Undo',
				run: async () => {
					const ok = await ctx.act(() => undoRun(buildId, runId, before, ids));
					if (ok) toasts.push('Undone');
				}
			});
		} catch (err) {
			void showError(err instanceof Error ? err.message : 'That did not save.');
			await ctx.refresh();
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	bind:this={dlg}
	class="ds-modal ds-modal--sheet"
	aria-labelledby="{uid}-t"
	{onclose}
	{oncancel}
	onclick={onbackdrop}
>
	{#if open}
		<form onsubmit={save} novalidate>
			<header class="ds-modal__head lrs-head">
				<h2 id="{uid}-t">{title}</h2>
				<button class="x" type="button" aria-label="Cancel" onclick={() => (open = false)}>×</button
				>
			</header>

			<div class="ds-modal__body lrs-body">
				<fieldset class="res">
					<legend>Result</legend>
					<div class="ds-seg ds-seg--fill lrs-seg" role="group" aria-label="Result">
						{#each resultOptions as r (r)}
							<button
								type="button"
								data-v={r}
								aria-pressed={result === r}
								onclick={() => {
									// Each result starts its own "how far" (empty for Failed, 100 for Partial).
									if (result !== r) pctEdited = false;
									result = r;
								}}>{r}</button
							>
						{/each}
					</div>
				</fieldset>

				{#if splitMode}
					<PartialParts
						bind:ticked
						parts={slugs.map((s) => ({
							slug: s,
							name: partOf(s)?.name ?? s,
							label: filLabel(ctx.filament(partOf(s)?.role ?? ''), partOf(s)?.role)
						}))}
					/>
				{/if}

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

				{#if showPct}
					<label class="f" for="{uid}-pct"
						>{result === 'Partial'
							? 'How far did the failed parts get? (%)'
							: 'How far did it get? (%)'}
						<input
							id="{uid}-pct"
							data-testid="log-progress"
							type="text"
							inputmode="decimal"
							autocomplete="off"
							placeholder={result === 'Failed' ? 'e.g. 40' : '100'}
							value={pctShown}
							oninput={(e) => {
								pct = e.currentTarget.value;
								pctEdited = true;
							}}
						/>
						<small>Used to estimate the grams; edit them below if you know better.</small>
					</label>
				{/if}

				{#if splitMode}
					<div class="pair">
						<label class="f" for="{uid}-gk"
							>Kept (g)
							<input
								id="{uid}-gk"
								data-testid="log-grams-kept"
								type="text"
								inputmode="decimal"
								autocomplete="off"
								placeholder="g"
								aria-invalid={keptInvalid}
								value={keptShown}
								oninput={(e) => {
									keptG = e.currentTarget.value;
									keptEdited = true;
								}}
							/>
						</label>
						<label class="f" for="{uid}-gl"
							>Lost (g)
							<input
								id="{uid}-gl"
								data-testid="log-grams-lost"
								type="text"
								inputmode="decimal"
								autocomplete="off"
								placeholder="g"
								aria-invalid={lostInvalid}
								value={lostShown}
								oninput={(e) => {
									lostG = e.currentTarget.value;
									lostEdited = true;
								}}
							/>
						</label>
					</div>
					{#if keptInvalid || lostInvalid}<small class="err" role="alert"
							>Enter the grams as a number, 0 or more (for example 162.5).</small
						>
					{:else if fromProgress}<small
							>Kept is the ticked parts' full weight; Lost is the others' share at {fmt(
								progressNow ?? 0
							)}%. Edit if different.</small
						>
					{:else}<small
							>Kept: filament in the parts that printed OK. Lost: what the others used.</small
						>{/if}
				{:else}
					<label class="f" for="{uid}-g"
						>Filament used (g)
						<input
							id="{uid}-g"
							type="text"
							inputmode="decimal"
							autocomplete="off"
							placeholder={result === 'Failed'
								? 'optional'
								: gramsInfo.perRun > 0
									? `${gramsInfo.source === 'bom' ? 'BOM ' : gramsInfo.unknown.length ? '≥ ' : ''}~${fmt(gramsInfo.perRun)}`
									: 'g'}
							aria-invalid={gramsInvalid}
							aria-describedby={gramsInvalid ? `${uid}-gerr` : undefined}
							value={gramsShown}
							oninput={(e) => {
								grams = e.currentTarget.value;
								gramsEdited = true;
							}}
						/>
						{#if gramsInvalid}<small class="err" id="{uid}-gerr" role="alert"
								>Enter the grams as a number, 0 or more (for example 162.5).</small
							>
						{:else if result === 'Failed' && !gramsEdited && failedPrefill != null}<small
								>Estimated from {fmt(progressNow ?? 0)}% progress; edit if different.</small
							>
						{:else if result === 'Failed' && !gramsEdited}<small
								>Optional: grams actually used. Left empty it counts as 0 g.</small
							>
						{:else if slicerDefault != null && !gramsEdited && !editRun}<small>{gramsSource}</small
							>{/if}
					</label>
				{/if}

				{#if showPrinter}
					<label class="f" for="{uid}-pr"
						>Printer
						<select id="{uid}-pr" data-testid="log-printer" bind:value={printer}>
							<option value="">Not set</option>
							{#each printerOptions as n (n)}<option value={n}>{n}</option>{/each}
						</select>
					</label>
				{/if}

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
				{#if error}<p class="err" role="alert" tabindex="-1" bind:this={errEl}>{error}</p>{/if}

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
			</div>

			<footer class="ds-modal__foot">
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
	form {
		min-width: 0;
	}
	.lrs-body {
		display: grid;
		gap: var(--sp-7);
		min-width: 0;
	}
	.lrs-head {
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
		border: 1px solid var(--field-line);
		border-radius: var(--r-lg);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: var(--fs-field);
	}
	textarea {
		resize: vertical;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-5);
	}
	.inline {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
	}
	/* The chosen result is not shown by colour alone: the raised option also gets an underline. */
	.lrs-seg button[aria-pressed='true'] {
		box-shadow:
			var(--shadow-1),
			inset 0 -3px 0 currentColor;
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
		footer .btn {
			flex: 1;
			padding: var(--sp-6) var(--sp-7);
		}
	}
</style>
