<script lang="ts">
	import { fmt, fmtH, runInfo } from '#lib/domain/index.ts';
	import { printing, logRun, deleteRun, updatePlate } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from '#lib/components/build-context.svelte.ts';
	import type { Plate } from '#lib/domain/types.ts';
	import RoleChip from '#lib/components/RoleChip.svelte';
	import RunTable from '#lib/components/RunTable.svelte';
	import RunForm, { type RunFormValues } from '#lib/components/RunForm.svelte';
	import SlicerInput from '#lib/components/SlicerInput.svelte';

	const ctx = getBuildCtx();
	let logOpen = $state<Record<number, boolean>>({});

	const partOf = (slug: string) => ctx.view.parts.find((p) => p.slug === slug);
	const roleOf = (slug: string) => partOf(slug)?.role ?? '';
	const rolesOf = (pl: Plate) => [...new Set(pl.parts.map(roleOf))];
	const status = (slug: string) => ctx.view.state[slug]?.status;

	function slicerTotal(pl: Plate): number {
		const per = pl.perPartRuns
			? Object.values(pl.slicerByPart).reduce((a, b) => a + b, 0)
			: (pl.slicerGrams ?? 0);
		return per * pl.runs;
	}
	function saveSlicer(pl: Plate, slug: string | null, v: number | null) {
		if (slug) {
			const by = { ...pl.slicerByPart };
			if (v == null) delete by[slug];
			else by[slug] = v;
			return ctx.act(() => updatePlate(ctx.id, pl.number, { slicerByPart: by }));
		}
		return ctx.act(() => updatePlate(ctx.id, pl.number, { slicerGrams: v }));
	}
	function start(slugs: string[]) {
		return ctx.act(() => printing(ctx.id, { action: 'start', slugs }));
	}
	async function addLog(pl: Plate, v: RunFormValues) {
		const ok = await ctx.act(() =>
			logRun(ctx.id, {
				plateNumber: pl.number,
				partSlug: pl.perPartRuns ? v.partSlug : null,
				partSlugs: null,
				date: v.date,
				result: v.result,
				grams: v.grams,
				hours: v.hours,
				printer: null,
				note: v.note
			})
		);
		if (ok) logOpen[pl.number] = false;
		return ok;
	}
</script>

{#each ctx.view.plates as pl (pl.number)}
	{@const runs = ctx.view.runs.filter((r) => r.plateNumber === pl.number)}
	{@const idle = pl.parts.filter((s) => !['Printed', 'Printing'].includes(status(s) ?? ''))}
	{@const done = pl.parts.filter((s) => status(s) === 'Printed').length}
	{@const ri = runInfo(ctx.view, pl.number)}
	{@const logged = runs.reduce((a, r) => a + (r.grams ?? 0), 0)}
	<section class="plate-card" aria-label="Plate {pl.number}">
		<div class="group-head">
			<h2>Plate {pl.number} · {pl.name}</h2>
			<span class="meta num">{done}/{pl.parts.length} printed</span>
			{#each rolesOf(pl) as r (r)}<RoleChip filament={ctx.filament(r)} role={r} />{/each}
			{#if slicerTotal(pl)}
				<span class="meta num" title="From your slicer grams"
					>~{fmt(slicerTotal(pl))} g (slicer)</span
				>
			{/if}
			{#if pl.estSeconds}
				<span class="meta num">~{fmtH(pl.estSeconds)}{pl.runs > 1 ? ' per run' : ''}</span>
			{/if}
			{#if pl.runNote || pl.runs > 1}
				<span class="meta" style="color:var(--warn);font-weight:600"
					>{pl.runNote ?? `Print ${pl.runs} times`}{ri ? ` · run ${ri.run} of ${ri.of}` : ''}</span
				>
			{/if}
			{#if logged}
				<span class="meta num" style="color:var(--ok);font-weight:600">{fmt(logged)} g logged</span>
			{/if}
		</div>

		<div class="now-parts">
			{#each pl.parts as slug (slug)}
				<button
					class="now-part"
					type="button"
					title="Open in the build guide"
					onclick={() => ctx.openGuide(slug)}
					>{partOf(slug)?.name ?? slug} <span class="meta">· {status(slug)}</span></button
				>
			{/each}
		</div>

		{#if ctx.canEdit}
			<div class="slicer-row">
				{#if pl.perPartRuns}
					{#each pl.parts as slug (slug)}
						<SlicerInput
							label="Slicer {filLabel(ctx.filament(roleOf(slug)), partOf(slug)?.name)} per run"
							value={pl.slicerByPart[slug]}
							onsave={(v) => saveSlicer(pl, slug, v)}
						/>
					{/each}
				{:else}
					<SlicerInput
						label={pl.runs > 1 ? 'Slicer per run' : 'Slicer'}
						value={pl.slicerGrams}
						title="Grams your slicer shows for this plate{pl.runs > 1 ? ' (one run)' : ''}"
						onsave={(v) => saveSlicer(pl, null, v)}
					/>
				{/if}
				{#if !pl.slicerGrams && !Object.keys(pl.slicerByPart).length}
					<span class="meta">Using BOM weights until you enter slicer grams.</span>
				{/if}
				{#if idle.length}
					{#if pl.perPartRuns}
						{#each idle as slug (slug)}
							<button class="btn sm" type="button" onclick={() => start([slug])}
								>Start {filLabel(ctx.filament(roleOf(slug)), partOf(slug)?.name)} run</button
							>
						{/each}
					{:else}
						<button class="btn sm" type="button" onclick={() => start(idle)}>Start printing</button>
					{/if}
				{/if}
				<button
					class="btn sm"
					class:primary={!logOpen[pl.number]}
					type="button"
					style="margin-left:auto"
					aria-expanded={!!logOpen[pl.number]}
					onclick={() => (logOpen[pl.number] = !logOpen[pl.number])}
					>{logOpen[pl.number] ? 'Close' : 'Log plate print'}</button
				>
			</div>
		{/if}

		{#if runs.length || logOpen[pl.number]}
			<div class="plate-log">
				{#if runs.length}
					<RunTable
						{runs}
						canEdit={ctx.canEdit}
						colorOf={pl.perPartRuns
							? (r) => (r.partSlug ? filLabel(ctx.filament(roleOf(r.partSlug))) : '')
							: undefined}
						ondelete={(r) => ctx.act(() => deleteRun(ctx.id, r.id))}
					/>
				{/if}
				{#if logOpen[pl.number] && ctx.canEdit}
					<RunForm
						idPrefix="plate-{pl.number}"
						gramsLabel="plate grams"
						submitLabel="Log plate"
						parts={pl.perPartRuns
							? pl.parts.map((s) => ({
									slug: s,
									label: `${partOf(s)?.name} (${filLabel(ctx.filament(roleOf(s)))})`
								}))
							: undefined}
						onsubmit={(v) => addLog(pl, v)}
					/>
				{/if}
			</div>
		{/if}
	</section>
{:else}
	<p class="empty">This template has no plates yet.</p>
{/each}
<p class="foot">
	3MF upload, to organize plates from your own slicer project, comes in a later version.
</p>
