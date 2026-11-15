<script lang="ts">
	import { untrack } from 'svelte';
	import { jobAction } from '#lib/client/api.ts';
	import { plateRunGrams, progressGrams } from '#lib/domain/index.ts';
	import { parseGrams, partialPrefill, partialTicksOk } from '#lib/domain/logrun.ts';
	import type { PrinterJobView } from '#lib/printers/status.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import PartialParts from './PartialParts.svelte';

	/** "Confirm print log" for a finished printer job: pre-filled result, grams and hours. */
	let { job, ondone }: { job: PrinterJobView; ondone: () => Promise<void> | void } = $props();
	const ctx = getBuildCtx();

	const roundGrams = (g: number | null | undefined) =>
		g == null || !Number.isFinite(g) ? '' : String(Math.round(g * 100) / 100);
	// Prefilled once from the job; the user edits from there.
	const total = untrack(() =>
		plateRunGrams(ctx.view, job.plateNumber ?? 0, job.partSlugs ?? undefined)
	);
	const init = untrack(() => ({
		result: job.status === 'done' ? 'Success' : 'Failed',
		// A finished print used its plate's grams; one that stopped part-way only an estimate of them.
		grams: roundGrams(job.status === 'done' ? total : progressGrams(total, job.progress)),
		hours:
			job.startedAt && job.finishedAt
				? String(
						Math.round(((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 3600000) * 10) /
							10
					)
				: ''
	}));
	let result = $state(init.result);
	let grams = $state(init.grams);
	let hours = $state(init.hours);
	// Partial = "some parts of the plate printed OK": offered where those parts can be told apart (a
	// single-run plate with two or more parts).
	const plate = $derived(ctx.view.plates.find((p) => p.number === job.plateNumber));
	const targets = $derived(
		(job.partSlugs ?? plate?.parts ?? []).filter((s) => ctx.view.state[s] !== undefined)
	);
	const splittable = $derived(
		!!plate && !plate.perPartRuns && plate.runs <= 1 && targets.length >= 2
	);
	const splitMode = $derived(result === 'Partial' && splittable);
	let ticked = $state<string[]>([]);
	let keptG = $state('');
	let lostG = $state('');
	let keptEdited = $state(false);
	let lostEdited = $state(false);
	// A finished job ran to 100%; a stopped one only as far as its last progress.
	const progressNow = $derived(job.status === 'done' ? 100 : (job.progress ?? 0));
	const splitPre = $derived(
		splitMode ? partialPrefill(ctx.view, targets, ticked, total, progressNow) : null
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
	const ticksOk = $derived(partialTicksOk(targets, ticked));
	let busy = $state(false);
	let err = $state('');

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		err = '';
		try {
			await fn();
			await ctx.refresh();
			await ondone();
		} catch (e) {
			err = e instanceof Error ? e.message : 'That did not work.';
		}
		busy = false;
	}
	const gramsParsed = $derived(parseGrams(String(grams)));
	const gramsInvalid = $derived(gramsParsed !== null && Number.isNaN(gramsParsed));
	let gramsEl: HTMLInputElement | undefined = $state();
	const log = () => {
		if (splitMode) {
			if (!ticksOk) return;
			if (keptInvalid || lostInvalid) {
				document.getElementById(keptInvalid ? `gk-${job.id}` : `gl-${job.id}`)?.focus();
				return;
			}
			return run(async () => {
				const r = await jobAction(job.id, {
					action: 'confirm',
					result: 'Partial',
					split: {
						keptSlugs: targets.filter((s) => ticked.includes(s)),
						keptGrams: keptParsed,
						lostGrams: lostParsed
					},
					hours: hours === '' ? null : Number(hours)
				});
				if (r.spoolmanWarning) ctx.error = r.spoolmanWarning;
			});
		}
		if (gramsInvalid) {
			gramsEl?.focus();
			return;
		}
		return run(async () => {
			const r = await jobAction(job.id, {
				action: 'confirm',
				result: result as 'Success' | 'Failed' | 'Partial',
				grams: gramsParsed,
				hours: hours === '' ? null : Number(hours)
			});
			if (r.spoolmanWarning) ctx.error = r.spoolmanWarning;
		});
	};
</script>

<div class="jobbox confirm" id="confirm-log-{job.id}" tabindex="-1" data-testid="confirm-print-log">
	<div>
		<b>Confirm print log</b>
		<div>
			Plate {job.plateNumber}
			{job.status === 'done' ? 'finished' : job.status === 'failed' ? 'failed' : 'was stopped'} on
			{job.printerName}
			<span class="file">{job.fileName}</span>
		</div>
	</div>
	{#if ctx.canEdit}
		<div class="cf">
			<label class="field"
				>Result
				<select bind:value={result} data-testid="confirm-result">
					<option>Success</option><option>Failed</option
					>{#if splittable || result === 'Partial'}<option>Partial</option>{/if}
				</select>
			</label>
			{#if !splitMode}
				<label class="field"
					>Grams
					<input
						type="text"
						inputmode="decimal"
						autocomplete="off"
						aria-invalid={gramsInvalid}
						bind:this={gramsEl}
						bind:value={grams}
						placeholder={job.status === 'done' ? 'g' : 'optional'}
						data-testid="confirm-grams"
					/>
					{#if gramsInvalid}<small class="err" role="alert"
							>Enter the grams as a number, 0 or more (for example 162.5).</small
						>{/if}
					{#if job.status !== 'done' && init.grams !== ''}<small class="hint"
							>Estimated from {Math.round(job.progress ?? 0)}% progress; edit if different.</small
						>{/if}
				</label>
			{/if}
			<label class="field"
				>Hours
				<input type="number" min="0" step="0.1" inputmode="decimal" bind:value={hours} />
			</label>
		</div>
		{#if splitMode}
			<PartialParts
				bind:ticked
				parts={targets.map((s) => ({
					slug: s,
					name: ctx.view.parts.find((p) => p.slug === s)?.name ?? s
				}))}
			/>
			<div class="cf pair">
				<label class="field"
					>Kept (g)
					<input
						id="gk-{job.id}"
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
						data-testid="confirm-grams-kept"
					/>
				</label>
				<label class="field"
					>Lost (g)
					<input
						id="gl-{job.id}"
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
						data-testid="confirm-grams-lost"
					/>
				</label>
			</div>
			{#if keptInvalid || lostInvalid}<small class="err" role="alert"
					>Enter the grams as a number, 0 or more (for example 162.5).</small
				>
			{:else if splitPre && (splitPre.keptGrams ?? splitPre.lostGrams) != null && (!keptEdited || !lostEdited)}<small
					class="hint"
					>Kept is the ticked parts' full weight; Lost is the others' share at {Math.round(
						progressNow
					)}% progress. Edit if different.</small
				>{/if}
		{/if}
		<div class="acts">
			<button
				class="btn primary"
				type="button"
				disabled={busy || (splitMode && !ticksOk)}
				data-testid="confirm-log"
				onclick={log}>Log print</button
			>
			<button
				class="btn"
				type="button"
				disabled={busy}
				data-testid="confirm-dismiss"
				onclick={() => run(() => jobAction(job.id, { action: 'dismiss' }))}
				>{job.status === 'done' ? 'Dismiss' : 'Don’t log'}</button
			>
		</div>
		{#if err}<div class="error" role="alert" style="white-space:normal">{err}</div>{/if}
	{/if}
</div>

<style>
	.jobbox {
		border: 1px solid var(--line);
		border-left: 4px solid var(--ok);
		background: var(--card);
		border-radius: var(--r-lg);
		padding: var(--sp-6) var(--sp-7);
		display: grid;
		gap: var(--sp-5);
		font-size: var(--fs-md);
		margin-bottom: var(--sp-5);
	}
	.file {
		font-family: var(--f-mono);
		font-size: var(--fs-xs);
		overflow-wrap: anywhere;
	}
	.cf {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--sp-5);
	}
	.cf select,
	.cf input {
		padding: var(--sp-4);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		min-width: 0;
		font-size: var(--fs-base);
	}
	.pair {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.hint {
		color: var(--muted);
		font-size: var(--fs-xs);
	}
	.acts {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
</style>
