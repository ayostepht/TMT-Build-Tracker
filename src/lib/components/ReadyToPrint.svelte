<script lang="ts">
	import { logRun, undoRun } from '#lib/client/api.ts';
	import { snapshotParts, today } from '#lib/domain/index.ts';
	import type { Plate, PrintRunInput } from '#lib/domain/types.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import LogPlateButton from './LogPlateButton.svelte';
	import PlateStart from './PlateStart.svelte';
	import PlateTime from './PlateTime.svelte';
	import Swatch from './Swatch.svelte';
	import { toasts } from './toast.svelte.ts';

	/** The next plates with nothing printed or printing yet, each with Start printing. */
	const MAX = 3;
	const ctx = getBuildCtx();

	const ready = $derived(
		ctx.view.plates.filter((pl) =>
			pl.parts.every((s) => ['To print', 'Reprint'].includes(ctx.view.state[s]?.status ?? ''))
		)
	);
	const shown = $derived(ready.slice(0, MAX));
	const partOf = (slug: string) => ctx.view.parts.find((p) => p.slug === slug);

	// Bulk "log N plates printed": single-run, one-color-per-print plates only (others need the sheet).
	const bulkable = (pl: Plate) => !pl.perPartRuns && pl.runs <= 1;
	let picked = $state<number[]>([]);
	let busy = $state(false);
	const chosen = $derived(shown.filter((p) => bulkable(p) && picked.includes(p.number)));
	function toggle(n: number, on: boolean) {
		picked = on ? [...picked, n] : picked.filter((x) => x !== n);
	}
	async function logChosen() {
		if (busy || !chosen.length) return;
		busy = true;
		const buildId = ctx.id;
		const done: { runId: string; before: ReturnType<typeof snapshotParts> }[] = [];
		try {
			for (const pl of chosen) {
				const g =
					pl.slicerGrams ?? (Object.values(pl.filamentGrams).reduce((a, b) => a + b, 0) || null);
				const input: PrintRunInput = {
					plateNumber: pl.number,
					partSlug: null,
					partSlugs: null,
					date: today(),
					result: 'Success',
					grams: g ? Math.round(g) : null,
					hours: null,
					printer: null,
					note: ''
				};
				const before = snapshotParts(ctx.view, pl.parts);
				const runId = await logRun(buildId, input);
				done.push({ runId, before });
				await ctx.refresh();
			}
		} catch (err) {
			toasts.push(err instanceof Error ? err.message : 'That did not save.');
		} finally {
			busy = false;
			picked = [];
		}
		if (!done.length) return;
		toasts.push(`Logged ${done.length} plate${done.length === 1 ? '' : 's'} · Success`, {
			label: 'Undo',
			run: async () => {
				for (const d of [...done].reverse()) {
					await ctx.act(() => undoRun(buildId, d.runId, d.before));
				}
				toasts.push('Undone');
			}
		});
	}
</script>

{#if ctx.canEdit && shown.length}
	<section class="group ready" aria-label="Ready to print" data-testid="ready-to-print">
		<div class="group-head">
			<h2>Ready to print</h2>
			<span class="meta num">{ready.length} plate{ready.length === 1 ? '' : 's'} not started</span>
			{#if chosen.length > 1}
				<button
					class="btn sm primary"
					type="button"
					disabled={busy}
					style="margin-left:auto"
					onclick={logChosen}>Log {chosen.length} plates printed</button
				>
			{/if}
		</div>
		<div class="rows">
			{#each shown as pl (pl.number)}
				<div class="ready-row" data-plate={pl.number}>
					{#if bulkable(pl)}
						<input
							type="checkbox"
							class="pick"
							aria-label="Select plate {pl.number}"
							checked={picked.includes(pl.number)}
							onchange={(e) => toggle(pl.number, e.currentTarget.checked)}
						/>
					{/if}
					<div class="ready-info">
						<div class="pname">Plate {pl.number} · {pl.name}</div>
						<div class="psub">
							{#each [...new Set(pl.parts.map((s) => partOf(s)?.role ?? ''))] as r (r)}
								{@const f = ctx.filament(r)}
								{#if f}<Swatch hex={f.hex} tpu={f.tpu} size="mini" />{/if}
							{/each}
							<span>{pl.parts.map((s) => partOf(s)?.name ?? s).join(', ')}</span>
							<PlateTime plate={pl} />
						</div>
					</div>
					<span class="acts">
						<PlateStart plate={pl} />
						<LogPlateButton plate={pl} />
					</span>
				</div>
			{/each}
		</div>
		{#if ready.length > shown.length}
			<div class="meta" style="padding:6px 2px">
				{ready.length - shown.length} more not shown. Group by Plate to see them all.
			</div>
		{/if}
	</section>
{/if}

<style>
	.ready {
		margin-bottom: 14px;
	}
	.ready-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		border-bottom: 1px solid var(--line);
	}
	.ready-row:last-child {
		border-bottom: 0;
	}
	.acts {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.pick {
		width: 20px;
		height: 20px;
	}
	.ready-info {
		min-width: 0;
		flex: 1 1 220px;
	}
</style>
