<script lang="ts">
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { fmtRemaining } from '#lib/printers/status.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import ConfirmPrintLog from './ConfirmPrintLog.svelte';
	import JobLinkControl from './JobLinkControl.svelte';

	/**
	 * Above the Now printing cards: running jobs no one has linked to a plate yet ("Link to
	 * plate…") and finished jobs waiting for their print log ("Confirm print log").
	 */
	const ctx = getBuildCtx();
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	$effect(() => store.acquire());

	const unlinked = $derived(
		store.jobs.filter((j) => !j.buildId && (j.status === 'printing' || j.status === 'paused'))
	);
	const pending = $derived(store.jobs.filter((j) => j.pendingConfirm && j.buildId === ctx.id));
</script>

{#each unlinked as j (j.id)}
	{@const live = store.status(j.printerId)}
	<div class="jobbox" data-testid="unlinked-job">
		<div>
			<b>{j.printerName}</b> is printing <span class="file">{j.fileName}</span>
			{#if j.progress != null}({Math.round(j.progress)}%{#if live?.remainingSec !== undefined}, {fmtRemaining(
						live.remainingSec
					)} left{/if}){/if}
			<div class="muted">Not linked to a plate yet.</div>
		</div>
		{#if ctx.canEdit}
			<JobLinkControl
				job={j}
				{ctx}
				exp={store.expected.find((e) => e.jobId === j.id && e.buildId === ctx.id)}
				onlinked={() => store.load()}
			/>
		{/if}
	</div>
{/each}

{#each pending as j (j.id)}
	<ConfirmPrintLog job={j} ondone={() => store.load()} />
{/each}

<style>
	.jobbox {
		border: 1px solid var(--line);
		border-left: 4px solid var(--accent);
		background: var(--card);
		border-radius: 8px;
		padding: 12px 14px;
		display: grid;
		gap: 10px;
		font-size: 14px;
		margin-bottom: 10px;
	}
	.file {
		font-family: var(--f-mono);
		font-size: 12px;
		overflow-wrap: anywhere;
	}
</style>
