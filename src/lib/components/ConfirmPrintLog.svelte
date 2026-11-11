<script lang="ts">
	import { untrack } from 'svelte';
	import { jobAction } from '#lib/client/api.ts';
	import { plateRunGrams, progressGrams } from '#lib/domain/index.ts';
	import type { PrinterJobView } from '#lib/printers/status.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	/** "Confirm print log" for a finished printer job: pre-filled result, grams and hours. */
	let { job, ondone }: { job: PrinterJobView; ondone: () => Promise<void> | void } = $props();
	const ctx = getBuildCtx();

	// Prefilled once from the job; the user edits from there.
	const total = untrack(() =>
		plateRunGrams(ctx.view, job.plateNumber ?? 0, job.partSlugs ?? undefined)
	);
	const init = untrack(() => ({
		result: job.status === 'done' ? 'Success' : 'Failed',
		// A finished print used its plate's grams; one that stopped part-way only an estimate of them.
		grams: String((job.status === 'done' ? total : progressGrams(total, job.progress)) ?? ''),
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
	const log = () =>
		run(async () => {
			const r = await jobAction(job.id, {
				action: 'confirm',
				result: result as 'Success' | 'Failed' | 'Partial',
				grams: grams === '' ? null : Number(grams),
				hours: hours === '' ? null : Number(hours)
			});
			if (r.spoolmanWarning) ctx.error = r.spoolmanWarning;
		});
</script>

<div class="jobbox confirm" data-testid="confirm-print-log">
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
					<option>Success</option><option>Failed</option><option>Partial</option>
				</select>
			</label>
			<label class="field"
				>Grams
				<input
					type="number"
					min="0"
					step="1"
					inputmode="decimal"
					bind:value={grams}
					placeholder={job.status === 'done' ? 'g' : 'optional'}
					data-testid="confirm-grams"
				/>
				{#if job.status !== 'done' && init.grams !== ''}<small class="hint"
						>Estimated from {Math.round(job.progress ?? 0)}% progress; edit if different.</small
					>{/if}
			</label>
			<label class="field"
				>Hours
				<input type="number" min="0" step="0.1" inputmode="decimal" bind:value={hours} />
			</label>
		</div>
		<div class="acts">
			<button
				class="btn primary"
				type="button"
				disabled={busy}
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
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--paper);
		min-width: 0;
		font-size: var(--fs-base);
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
