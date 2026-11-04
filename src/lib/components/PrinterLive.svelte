<script lang="ts">
	import { jobAction } from '#lib/client/api.ts';
	import type { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import { fmtRemaining, type PrinterJobView } from '#lib/printers/status.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	/** Live progress of the printer running a plate's job (inside a Now printing card). */
	let { job, store }: { job: PrinterJobView; store: PrinterStore } = $props();
	const ctx = getBuildCtx();
	const st = $derived(store.status(job.printerId));
	const live = $derived(st && st.fileName === job.fileName ? st : null);
	const pct = $derived(live?.progress ?? job.progress);
	let busy = $state(false);
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
	<div class="facts">
		{#if live?.layer !== undefined && live.totalLayers}<span data-testid="live-layer"
				>Layer {live.layer} / {live.totalLayers}</span
			>{/if}
		{#if live?.remainingSec !== undefined}<span data-testid="live-left"
				>{fmtRemaining(live.remainingSec)} left</span
			>{/if}
		{#if live?.nozzleC !== undefined}<span>Nozzle {Math.round(live.nozzleC)}°</span>{/if}
		{#if live?.bedC !== undefined}<span>Bed {Math.round(live.bedC)}°</span>{/if}
		{#if ctx.canEdit}<button class="linkbtn" type="button" disabled={busy} onclick={unlink}
				>Not this plate</button
			>{/if}
	</div>
</div>

<style>
	.live {
		border: 1px solid var(--line);
		background: var(--accent-soft);
		border-radius: 8px;
		padding: 10px 12px;
		display: grid;
		gap: 6px;
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
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 14px;
		font-size: 13px;
		color: var(--muted);
		align-items: center;
	}
</style>
