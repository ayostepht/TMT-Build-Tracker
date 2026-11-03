<script lang="ts">
	import { untrack } from 'svelte';
	import { RUN_RESULTS, type PrintRunInput, type RunResult } from '#lib/domain/types.ts';
	import {
		durText,
		elapsedSeconds,
		fmt,
		hoursFromSeconds,
		parseDur,
		runOutcomeSummary,
		snapshotParts,
		toLocalInput,
		today
	} from '#lib/domain/index.ts';
	import { logRun, undoRun } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import { toasts } from './toast.svelte.ts';

	let {
		open = $bindable(false),
		plateNumber = null,
		slugs,
		startedAt = null,
		title = 'Log print'
	}: {
		open?: boolean;
		/** Plate this run belongs to; null logs against a single part. */
		plateNumber?: number | null;
		/** Parts the run concerns (those on the printer, or the whole plate, or one part). */
		slugs: string[];
		/** When the print started, if known: prefills the total time. */
		startedAt?: string | null;
		title?: string;
	} = $props();

	const ctx = getBuildCtx();
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
		return typeof v === 'number' && v > 0 ? v : null;
	});
	const bomEstimate = $derived.by(() => {
		if (plate?.perPartRuns) {
			const g = partOf(pickedSlug ?? slugs[0])?.bomGrams ?? 0;
			return g / Math.max(1, plate.runs);
		}
		const runs = Math.max(1, plate?.runs ?? 1);
		return slugs.reduce((a, s) => a + (partOf(s)?.bomGrams ?? 0), 0) / (plate ? runs : 1);
	});
	const gramsShown = $derived(
		gramsEdited ? grams : slicerDefault != null ? String(slicerDefault) : ''
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
			date: toLocalInput(finDate).slice(0, 10) || today(),
			result: res,
			grams: gramsShown === '' ? null : Number(gramsShown),
			hours: hoursFromSeconds(durSeconds),
			printer: null,
			note: note.trim()
		};
	}
	const summary = $derived(runOutcomeSummary(ctx.view, buildInput(result)));
	const canSave = $derived(!!result && !durInvalid && !gramsInvalid && !busy);

	function recalc() {
		if (!durEdited) dur = durText(elapsedSeconds(startedAt, finDate));
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
		picked = slugs[0] ?? '';
		error = null;
		busy = false;
		fin = toLocalInput(new Date());
		dur = durText(elapsedSeconds(startedAt, new Date()));
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
	function onbackdrop(e: MouseEvent) {
		if (e.target === dlg) open = false;
	}

	function label(): string {
		if (plate) return `plate ${plate.number}`;
		return partOf(slugs[0])?.name ?? 'part';
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!canSave || !result) return;
		busy = true;
		error = null;
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

<dialog bind:this={dlg} class="sheet" aria-labelledby="{uid}-t" {onclose} onclick={onbackdrop}>
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
					>Which color/part was this run
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
				{:else if startedAt && !durEdited}<small>From the start time to finish.</small>{/if}
			</label>

			<label class="f" for="{uid}-g"
				>Filament used (g)
				<input
					id="{uid}-g"
					type="number"
					min="0"
					step="1"
					inputmode="decimal"
					placeholder={bomEstimate > 0 ? `BOM ~${fmt(bomEstimate)}` : 'g'}
					value={gramsShown}
					oninput={(e) => {
						grams = e.currentTarget.value;
						gramsEdited = true;
					}}
				/>
				{#if slicerDefault != null && !gramsEdited}<small
						>From your slicer; edit if different.</small
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

			<footer>
				<button class="btn" type="button" onclick={() => (open = false)}>Cancel</button>
				<button class="btn primary" type="submit" disabled={!canSave}>Save</button>
			</footer>
		</form>
	{/if}
</dialog>

<style>
	.sheet {
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--card);
		color: var(--ink);
		padding: 0;
		width: min(480px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow: auto;
	}
	.sheet::backdrop {
		background: rgb(10 12 24 / 0.55);
	}
	form {
		display: grid;
		gap: 14px;
		padding: 16px;
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
		font-size: 24px;
	}
	.x {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 24px;
		line-height: 1;
		padding: 4px 10px;
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
		font-size: 13px;
		color: var(--muted);
		padding: 0;
	}
	.f {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	legend {
		margin-bottom: 4px;
	}
	input,
	select,
	textarea {
		width: 100%;
		min-width: 0;
		padding: 9px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 16px;
	}
	textarea {
		resize: vertical;
	}
	.inline {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.segbtns {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}
	.segbtns button {
		border: 0;
		border-right: 1px solid var(--line);
		background: var(--paper);
		color: var(--ink);
		padding: 11px 6px;
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
	small {
		color: var(--muted);
	}
	.err {
		color: var(--bad);
		font-size: 13px;
		margin: 0;
	}
	.summary {
		margin: 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--accent-soft);
		color: var(--ink);
		font-size: 14px;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	@media (max-width: 760px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			margin: auto 0 0;
			border-radius: 16px 16px 0 0;
			max-height: 92dvh;
		}
		footer .btn {
			flex: 1;
			padding: 12px 14px;
		}
	}
</style>
