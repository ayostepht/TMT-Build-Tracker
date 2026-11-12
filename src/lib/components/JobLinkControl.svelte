<script lang="ts">
	import { jobAction } from '#lib/client/api.ts';
	import type { PrinterExpectedView, PrinterJobView } from '#lib/printers/status.ts';
	import { defaultRunParts } from '#lib/domain/index.ts';
	import type { BuildCtx } from './build-context.svelte.ts';
	import ExpectedConfirm from './ExpectedConfirm.svelte';
	import { runChoices, runOptionLabel } from './run-label.ts';

	/**
	 * Link one running job to a plate of the build in `ctx`: "Confirm X is printing on <printer>?"
	 * when the user sent a plate there ("Start on <printer>"), otherwise choose plate (and, for a
	 * per-part plate, the run). Never guesses a plate. Used by the build's Print tab
	 * (`PrinterJobs`) and by the Printers page (`PrinterJobLink`).
	 */
	let {
		job,
		ctx,
		exp,
		onlinked
	}: {
		job: PrinterJobView;
		ctx: BuildCtx;
		exp?: PrinterExpectedView;
		/** Called after the link succeeded and the build was refreshed. */
		onlinked: () => void | Promise<void>;
	} = $props();

	let other = $state(false);
	const suggestion = $derived(other ? undefined : exp);

	let busy = $state(false);
	let err = $state('');
	/** A perPartRuns plate was picked and the run (part) still has to be chosen. */
	let picking = $state<{ plate: number; slug: string } | null>(null);

	function pickPlate(n: string) {
		const plate = ctx.view.plates.find((p) => p.number === Number(n));
		if (plate?.perPartRuns) {
			picking = {
				plate: plate.number,
				slug: defaultRunParts(ctx.view, plate.number)?.[0] ?? plate.parts[0]
			};
		} else {
			picking = null;
			void link(Number(n));
		}
	}

	async function link(n: number, partSlugs?: string[]) {
		busy = true;
		err = '';
		try {
			await jobAction(job.id, { action: 'link', buildId: ctx.id, plateNumber: n, partSlugs });
			picking = null;
			await ctx.refresh();
			await onlinked();
		} catch (e) {
			err = e instanceof Error ? e.message : 'That did not work.';
		}
		busy = false;
	}
</script>

{#if suggestion}
	<ExpectedConfirm exp={suggestion} {ctx} {onlinked} onother={() => (other = true)} />
{:else}
	<label class="sel"
		><span class="sr-only">Link to plate</span>
		<select
			disabled={busy}
			data-testid="link-plate"
			onchange={(e) => e.currentTarget.value && pickPlate(e.currentTarget.value)}
		>
			<option value="">Link to plate…</option>
			{#each ctx.view.plates as p (p.number)}
				<option value={p.number} selected={picking?.plate === p.number}
					>Plate {p.number}{p.name ? ` · ${p.name}` : ''}</option
				>
			{/each}
		</select>
	</label>
	{#if picking}
		<div class="runpick" data-testid="run-chooser">
			<label class="sel"
				><span class="lbl">Which run?</span>
				<select data-testid="link-run" bind:value={picking.slug} disabled={busy}>
					{#each runChoices(ctx.view, picking.plate) as c (c.slug)}
						<option value={c.slug}>{runOptionLabel(ctx, c)}</option>
					{/each}
				</select>
			</label>
			<button
				class="btn sm primary"
				type="button"
				data-testid="link-run-go"
				disabled={busy}
				onclick={() => picking && link(picking.plate, [picking.slug])}>Link</button
			>
		</div>
	{/if}
{/if}
{#if err}<div class="error" role="alert" style="white-space:normal">{err}</div>{/if}

<style>
	.runpick {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
		align-items: flex-end;
	}
	.lbl {
		display: block;
		font-size: var(--fs-xs);
		color: var(--muted);
		margin-bottom: var(--sp-1);
	}
	.sel select {
		padding: var(--sp-4);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		max-width: 100%;
	}
</style>
