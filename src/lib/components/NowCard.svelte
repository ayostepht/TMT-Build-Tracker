<script lang="ts">
	import {
		fmt,
		fmtH,
		fmtDur,
		fmtHM,
		paceOf,
		parseDur,
		toLocalInput,
		type nowPrinting
	} from '#lib/domain/index.ts';
	import { printing, updatePlate } from '#lib/client/api.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import type { Plate } from '#lib/domain/types.ts';
	import RoleChip from './RoleChip.svelte';
	import LogRunSheet from './LogRunSheet.svelte';
	import PlateTime from './PlateTime.svelte';
	import PrinterLive from './PrinterLive.svelte';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';

	type Item = ReturnType<typeof nowPrinting>[number];
	let { item }: { item: Item } = $props();

	const ctx = getBuildCtx();
	const slugs = $derived(item.parts.map((p) => p.slug));
	const plate = $derived(ctx.view.plates.find((p) => p.number === item.plate));
	// While printing, the header shows this run's time (printer- or user-set), not the plate's file time.
	function headPlate(p: Plate): Plate {
		return {
			...p,
			estSeconds: item.estSeconds ?? p.estSeconds,
			estSource: item.estSource === 'template' ? 'profile' : (item.estSource ?? p.estSource)
		};
	}
	const fid = $derived(`now-${item.plate}`);
	let sheetOpen = $state(false);
	const pstore = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	$effect(() => pstore.acquire());
	const liveJobs = $derived(
		pstore.jobs.filter(
			(j) =>
				j.buildId === ctx.id &&
				j.plateNumber === item.plate &&
				(j.status === 'printing' || j.status === 'paused')
		)
	);

	const slicerShown = $derived(item.slicerGrams);
	const bomRun = $derived(
		item.parts.reduce((a, p) => a + (p.bomGrams ?? 0) / Math.max(1, plate?.runs ?? 1), 0)
	);
	const elapsedMs = $derived(item.startedAt ? ctx.now - Date.parse(item.startedAt) : 0);
	// Pace-adjusted when the time is the slicer's, learned or an estimate and no printer reports its own.
	const pace = $derived(
		!liveJobs.length && ['manual', 'slicer', 'learned', 'estimate'].includes(item.estSource ?? '')
			? paceOf(ctx.view)
			: null
	);
	const estMs = $derived((item.estSeconds ?? 0) * 1000 * (pace?.ratio ?? 1));
	const leftMs = $derived(estMs - elapsedMs);
	const etaTxt = $derived.by(() => {
		if (!item.startedAt || !estMs) return '';
		const eta = new Date(Date.parse(item.startedAt) + estMs);
		const same = eta.toDateString() === new Date(ctx.now).toDateString();
		return (
			eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
			(same ? '' : ' ' + eta.toLocaleDateString([], { weekday: 'short' }))
		);
	});
	function setStart(v: string) {
		if (!v) return;
		const when = new Date(v);
		if (isNaN(when.getTime())) return;
		const iso = new Date(Math.min(when.getTime(), Date.now())).toISOString();
		ctx.act(() => printing(ctx.id, { action: 'setStart', slugs, when: iso }));
	}
	function setEstimate(v: string) {
		const seconds = parseDur(v);
		ctx.act(() =>
			printing(ctx.id, { action: 'setEstimate', slugs, seconds: seconds ?? undefined })
		);
	}
	function saveSlicer(v: number | null) {
		if (!plate) return;
		if (plate.perPartRuns) {
			const by = { ...plate.slicerByPart };
			for (const s of slugs) {
				if (v == null) delete by[s];
				else by[s] = v;
			}
			ctx.act(() => updatePlate(ctx.id, plate.number, { slicerByPart: by }));
		} else {
			ctx.act(() => updatePlate(ctx.id, plate.number, { slicerGrams: v }));
		}
	}
</script>

<article
	class="now-card"
	style="border-left-color:{ctx.filament(item.roles[0])?.hex ?? 'var(--accent)'}"
>
	<div class="now-head">
		<div>
			<div class="now-plate">
				Plate {item.plate}{#if item.run}<span class="now-run"
						>Run {item.run.run} of {item.run.of}</span
					>{/if}
			</div>
			<h3>{item.name}</h3>
		</div>
		<div class="now-meta">
			{#each item.roles as r (r)}<RoleChip filament={ctx.filament(r)} role={r} />{/each}
			{#if item.gramsPerRun}<span class="num">~{fmt(item.gramsPerRun)} g</span>{/if}
			{#if plate}<PlateTime plate={headPlate(plate)} />{/if}
		</div>
	</div>
	<div class="now-parts">
		{#each item.parts as p (p.slug)}
			<button
				class="now-part"
				type="button"
				title="Open in the build guide"
				onclick={() => ctx.openGuide(p.slug)}
				>{p.name}{p.qty && p.qty > 1 ? ` ×${p.qty}` : ''}</button
			>
		{/each}
	</div>

	{#each liveJobs as j (j.id)}<PrinterLive job={j} store={pstore} />{/each}
	{#if pstore.error}
		<p class="muted" role="status" data-testid="printer-status-error">
			Printer status unavailable ·
			<button type="button" class="btn sm" onclick={() => void pstore.load()}>Retry</button>
		</p>
	{/if}

	<div class="now-step">
		<div class="now-step-title">1 · Sent to printer</div>
		<div class="now-grid">
			<label for="{fid}-st"
				>Started
				<input
					type="datetime-local"
					id="{fid}-st"
					value={item.startedAt ? toLocalInput(new Date(item.startedAt)) : ''}
					disabled={!ctx.canEdit}
					onchange={(e) => setStart(e.currentTarget.value)}
				/>
			</label>
			<label for="{fid}-sg"
				>Slicer grams
				<input
					type="number"
					id="{fid}-sg"
					min="0"
					step="1"
					value={slicerShown ?? ''}
					placeholder={bomRun ? `BOM ~${fmt(bomRun)}` : 'g'}
					disabled={!ctx.canEdit}
					onchange={(e) => {
						const raw = e.currentTarget.value;
						saveSlicer(raw === '' ? null : Math.max(0, Number(raw)));
					}}
				/>
			</label>
			<label for="{fid}-se"
				>Slicer time
				<input
					type="text"
					id="{fid}-se"
					inputmode="text"
					value={item.estSource === 'slicer' && item.estSeconds ? fmtHM(item.estSeconds) : ''}
					placeholder={item.estSeconds ? `e.g. ${fmtHM(item.estSeconds)}` : 'e.g. 12h 30m'}
					disabled={!ctx.canEdit}
					onchange={(e) => setEstimate(e.currentTarget.value)}
				/>
			</label>
		</div>
		{#if !item.startedAt && ctx.canEdit}
			<button class="btn ghost sm" type="button" onclick={() => setStart(toLocalInput(new Date()))}
				>Started just now</button
			>
		{/if}
	</div>

	<div class="now-timer">
		{#if item.startedAt}
			<span class="now-elapsed">{fmtDur(elapsedMs)}</span> elapsed ·
			{#if estMs}
				{#if leftMs > 0}~{fmtDur(leftMs)} left{pace ? ' at your pace' : ''}, done around {etaTxt}{:else}past
					the ~{fmtH(estMs / 1000)} estimate{/if}
			{/if}
		{:else}
			Estimate {item.estSource === 'manual'
				? 'you entered'
				: item.estSource === 'slicer'
					? 'from your slicer'
					: item.estSource === 'learned'
						? 'from your slice'
						: "from the template's profile"}: ~{fmtH(estMs / 1000)}. Set the start time to see a
			countdown.
		{/if}
	</div>

	<div class="now-foot">
		<span
			>A success marks these printed{item.run ? ' once all runs are in' : ''}; a failure flags them
			for reprint.</span
		>
		{#if ctx.canEdit}
			<div class="now-actions">
				<button class="btn primary" type="button" onclick={() => (sheetOpen = true)}
					>Finish &amp; log print…</button
				>
				<button
					class="btn"
					type="button"
					onclick={async () => {
						await ctx.act(() => printing(ctx.id, { action: 'stop', slugs }));
						// the printer's running job is unlinked now: show it in "Link to plate…" at once
						void pstore.load();
					}}>Take off printer</button
				>
			</div>
		{/if}
	</div>
	{#if ctx.canEdit}
		<LogRunSheet
			bind:open={sheetOpen}
			quick
			plateNumber={item.plate}
			{slugs}
			startedAt={item.startedAt}
			title="Finish & log print"
		/>
	{/if}
</article>

<style>
	.now-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
</style>
