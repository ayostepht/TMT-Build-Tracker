<script lang="ts">
	import { jobAction } from '#lib/client/api.ts';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { fmtRemaining, type PrinterJobView } from '#lib/printers/status.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import ConfirmPrintLog from './ConfirmPrintLog.svelte';

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

	let busy = $state<string | null>(null);
	let err = $state('');

	async function link(j: PrinterJobView, n: string) {
		busy = j.id;
		err = '';
		try {
			await jobAction(j.id, { action: 'link', buildId: ctx.id, plateNumber: Number(n) });
			await ctx.refresh();
			await store.load();
		} catch (e) {
			err = e instanceof Error ? e.message : 'That did not work.';
		}
		busy = null;
	}
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
			<label class="sel"
				><span class="sr-only">Link to plate</span>
				<select
					disabled={busy === j.id}
					data-testid="link-plate"
					onchange={(e) => e.currentTarget.value && link(j, e.currentTarget.value)}
				>
					<option value="">Link to plate…</option>
					{#each ctx.view.plates as p (p.number)}
						<option value={p.number}>Plate {p.number}{p.name ? ` · ${p.name}` : ''}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>
{/each}

{#each pending as j (j.id)}
	<ConfirmPrintLog job={j} ondone={() => store.load()} />
{/each}
{#if err}<div class="error" role="alert" style="white-space:normal">{err}</div>{/if}

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
	.sel select {
		padding: 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		max-width: 100%;
	}
</style>
