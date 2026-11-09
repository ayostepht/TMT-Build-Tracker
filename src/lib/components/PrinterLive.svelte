<script lang="ts">
	import { jobAction } from '#lib/client/api.ts';
	import type { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import { fmtRemaining, type PrinterJobView } from '#lib/printers/status.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import CameraTile from './CameraTile.svelte';
	import { runInfo } from '#lib/domain/index.ts';
	import { partColor, runChoices, runOptionLabel } from './run-label.ts';

	/** Live progress of the printer running a plate's job (inside a Now printing card). */
	let { job, store }: { job: PrinterJobView; store: PrinterStore } = $props();
	const ctx = getBuildCtx();
	const st = $derived(store.status(job.printerId));
	const live = $derived(st && st.fileName === job.fileName ? st : null);
	const pct = $derived(live?.progress ?? job.progress);
	let busy = $state(false);
	/** perPartRuns plate: which part (color) this print is. */
	const choices = $derived(job.plateNumber != null ? runChoices(ctx.view, job.plateNumber) : []);
	const slug = $derived(job.partSlugs?.length === 1 ? job.partSlugs[0] : null);
	const part = $derived(slug ? ctx.view.parts.find((p) => p.slug === slug) : null);
	const runLine = $derived.by(() => {
		if (!choices.length || !slug || job.plateNumber == null) return '';
		const info = runInfo(ctx.view, job.plateNumber, slug);
		return `${part?.name ?? slug} · ${partColor(ctx, slug)}${info ? `, run ${info.run} of ${info.of}` : ''}`;
	});
	async function change(next: string) {
		if (!next || next === slug || job.buildId == null || job.plateNumber == null) return;
		busy = true;
		await ctx.act(() =>
			jobAction(job.id, {
				action: 'link',
				buildId: job.buildId!,
				plateNumber: job.plateNumber!,
				partSlugs: [next]
			})
		);
		await store.load();
		busy = false;
	}
	async function unlink() {
		busy = true;
		await ctx.act(() => jobAction(job.id, { action: 'unlink' }));
		await store.load();
		busy = false;
	}
</script>

<div class="live" data-testid="printer-live">
	<div class="live-head">
		<span class="live-name">{job.printerName}</span>
		<span class="live-state"
			>{job.status === 'paused'
				? 'Paused'
				: live?.state === 'offline'
					? 'Printer offline'
					: 'Printing'}</span
		>
	</div>
	<div class="prog">
		<div
			class="bar"
			role="progressbar"
			aria-valuenow={pct ?? 0}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-label="Printer progress"
		>
			<span style="width:{pct ?? 0}%;background:var(--accent)"></span>
		</div>
		<b class="num" data-testid="live-pct">{pct != null ? Math.round(pct) : '–'}%</b>
	</div>
	{#if choices.length}
		<div class="which" data-testid="live-part">
			<span data-testid="live-part-text">{runLine || 'Choose which run this is'}</span>
			{#if ctx.canEdit}
				<label class="chg"
					><span class="sr-only">Change run</span>
					<select
						disabled={busy}
						data-testid="live-part-change"
						value={slug ?? ''}
						onchange={(e) => change(e.currentTarget.value)}
					>
						{#if !slug}<option value="">Change…</option>{/if}
						{#each choices as c (c.slug)}
							<option value={c.slug}>{runOptionLabel(ctx, c)}</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>
	{/if}
	<div class="facts">
		{#if live?.layer !== undefined && live.totalLayers}<span data-testid="live-layer"
				>Layer {live.layer} / {live.totalLayers}</span
			>{/if}
		{#if live?.remainingSec !== undefined}<span data-testid="live-left"
				>{fmtRemaining(live.remainingSec)} left</span
			>{/if}
		{#if live?.nozzleC !== undefined}<span>Nozzle {Math.round(live.nozzleC)}°</span>{/if}
		{#if live?.bedC !== undefined}<span>Bed {Math.round(live.bedC)}°</span>{/if}
		{#if ctx.canEdit}<button class="btn ghost sm" type="button" disabled={busy} onclick={unlink}
				>Not this plate</button
			>{/if}
	</div>
	<CameraTile printerId={job.printerId} />
</div>

<style>
	.live {
		border: 1px solid var(--line);
		background: var(--accent-soft);
		border-radius: 8px;
		padding: 10px 12px;
		display: grid;
		gap: 6px;
		min-width: 0;
		box-sizing: border-box;
	}
	.live-head {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 13px;
	}
	.live-name {
		font-weight: 600;
	}
	.live-state {
		color: var(--accent);
	}
	.prog {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.prog .bar {
		flex: 1;
	}
	.which {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: center;
		font-size: 13px;
		font-weight: 600;
	}
	.chg {
		min-width: 0;
		max-width: 100%;
		flex: 0 1 auto;
	}
	.chg select {
		width: 100%;
		min-width: 0;
		text-overflow: ellipsis;
		box-sizing: border-box;
		padding: 4px 6px;
		font-size: 13px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		max-width: 100%;
	}
	.which > span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 14px;
		font-size: 13px;
		color: var(--muted);
		align-items: center;
	}
</style>
