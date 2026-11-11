<script lang="ts">
	import type { PrintRun } from '#lib/domain/types.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import RunTable from './RunTable.svelte';
	import LogRunSheet from './LogRunSheet.svelte';

	/**
	 * A plate's print log (every run, newest first) for the Print tab: successes, failures and
	 * partial prints, with the printer, grams and time. Edit and Delete use the same sheet and
	 * in-app delete confirmation as the part rows and the Files tab. Viewers only read.
	 */
	let { plateNumber }: { plateNumber: number } = $props();
	const ctx = getBuildCtx();

	const plate = $derived(ctx.view.plates.find((p) => p.number === plateNumber));
	const runs = $derived(ctx.view.runs.filter((r) => r.plateNumber === plateNumber).toReversed());
	const partOf = (slug: string) => ctx.view.parts.find((p) => p.slug === slug);

	/** "Rim A · attempt 2 · Shop printer": which parts, which try, and where it printed. */
	function scopeOf(r: PrintRun): string {
		const bits: string[] = [];
		const total = plate?.parts.length ?? 0;
		if (r.partSlug) bits.push(partOf(r.partSlug)?.name ?? r.partSlug);
		else if (r.partSlugs?.length && r.partSlugs.length < total)
			bits.push(`${r.partSlugs.length} of ${total} parts`);
		if (plate && (plate.runs > 1 || plate.perPartRuns)) {
			const same = ctx.view.runs.filter(
				(x) => x.plateNumber === plateNumber && (x.partSlug ?? null) === (r.partSlug ?? null)
			);
			bits.push(`attempt ${same.findIndex((x) => x.id === r.id) + 1}`);
		}
		if (r.printer) bits.push(r.printer);
		return bits.join(' · ');
	}

	let editing = $state<PrintRun | null>(null);
	let editOpen = $state(false);
	let deleteFirst = $state(false);
</script>

<div class="plate-hist" data-testid="plate-history-{plateNumber}">
	<RunTable
		{runs}
		canEdit={ctx.canEdit}
		{scopeOf}
		colorOf={plate?.perPartRuns
			? (r) => (r.partSlug ? filLabel(ctx.filament(partOf(r.partSlug)?.role ?? '')) : '')
			: undefined}
		ondelete={(r) => ((editing = r), (deleteFirst = true), (editOpen = true))}
		onedit={(r) => ((editing = r), (deleteFirst = false), (editOpen = true))}
	/>
	{#if ctx.canEdit}
		<LogRunSheet bind:open={editOpen} editRun={editing} {deleteFirst} />
	{/if}
</div>

<style>
	.plate-hist {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 8px 10px;
		min-width: 0;
	}
</style>
