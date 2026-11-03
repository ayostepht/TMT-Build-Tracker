<script lang="ts">
	import { fmt, fmtH, runInfo } from '#lib/domain/index.ts';
	import { printing, deleteRun, updatePlate } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from '#lib/components/build-context.svelte.ts';
	import type { Plate, PrintRun } from '#lib/domain/types.ts';
	import RoleChip from '#lib/components/RoleChip.svelte';
	import RunTable from '#lib/components/RunTable.svelte';
	import LogRunSheet from '#lib/components/LogRunSheet.svelte';
	import SlicerInput from '#lib/components/SlicerInput.svelte';

	const ctx = getBuildCtx();
	let logOpen = $state<Record<number, boolean>>({});
	let editing = $state<PrintRun | null>(null);
	let editOpen = $state(false);
	const startedOf = (pl: Plate) =>
		pl.parts
			.map((s) => (ctx.view.state[s]?.status === 'Printing' ? ctx.view.state[s].startedAt : null))
			.filter((s): s is string => !!s)
			.sort()[0] ?? null;
	// Slugs a plate log covers: what is on the printer when something is, else the whole plate.
	const loggable = (pl: Plate) => {
		const on = pl.parts.filter((s) => status(s) === 'Printing');
		return on.length ? on : pl.parts;
	};

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
					class="btn sm primary"
					type="button"
					style="margin-left:auto"
					onclick={() => (logOpen[pl.number] = true)}>Log a print…</button
				>
				<LogRunSheet
					bind:open={() => !!logOpen[pl.number], (v) => (logOpen[pl.number] = v)}
					plateNumber={pl.number}
					slugs={loggable(pl)}
					startedAt={startedOf(pl)}
					title="Log print: plate {pl.number}"
				/>
			</div>
		{/if}

		{#if runs.length}
			<div class="plate-log">
				<RunTable
					{runs}
					canEdit={ctx.canEdit}
					colorOf={pl.perPartRuns
						? (r) => (r.partSlug ? filLabel(ctx.filament(roleOf(r.partSlug))) : '')
						: undefined}
					ondelete={(r) => ctx.act(() => deleteRun(ctx.id, r.id))}
					onedit={(r) => ((editing = r), (editOpen = true))}
				/>
			</div>
		{/if}
	</section>
{:else}
	<p class="empty">This template has no plates yet.</p>
{/each}
{#if ctx.canEdit}
	<LogRunSheet bind:open={editOpen} editRun={editing} />
{/if}
<p class="foot">
	3MF upload, to organize plates from your own slicer project, comes in a later version.
</p>
