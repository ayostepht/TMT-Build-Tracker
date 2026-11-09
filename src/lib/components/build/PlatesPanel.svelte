<script lang="ts">
	import { page } from '$app/state';
	import { printersHrefFor } from '#lib/workspace-links.ts';
	import { fmt, fmtH, runInfo } from '#lib/domain/index.ts';
	import {
		printing,
		deleteRun,
		updatePlate,
		buildPlateLayouts,
		plateThumbnailUrl,
		arrangePlates,
		forgetPrintTemplate,
		getArrangement,
		type ArrangementDto,
		type PlateLayoutInfo
	} from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from '#lib/components/build-context.svelte.ts';
	import type { Plate, PrintRun } from '#lib/domain/types.ts';
	import RoleChip from '#lib/components/RoleChip.svelte';
	import RunTable from '#lib/components/RunTable.svelte';
	import LogRunSheet from '#lib/components/LogRunSheet.svelte';
	import PlateTime from '#lib/components/PlateTime.svelte';
	import StartOnPrinter from '#lib/components/StartOnPrinter.svelte';
	import SlicerInput from '#lib/components/SlicerInput.svelte';
	import SlicerTimeInput from '#lib/components/SlicerTimeInput.svelte';
	import PlateLayoutPicker from '#lib/components/PlateLayoutPicker.svelte';
	import PlateUpload from '#lib/components/PlateUpload.svelte';
	import PlateArrangement from '#lib/components/PlateArrangement.svelte';

	/** Setup wizard: plate pictures only, no print log or slicer grams. */
	let { wizard = false }: { wizard?: boolean } = $props();
	const ctx = getBuildCtx();
	/** Studio drafts have no tracking either: no print log, slicer grams or start buttons. */
	const draft = $derived(ctx.view.build.kind === 'draft');
	const track = $derived(!wizard && !draft);
	let uploading = $state(false);
	let notice = $state<string | null>(null);
	// A sliced project dropped in the kit drop zone opens the upload with that file.
	$effect(() => {
		if (ctx.slicedFile && ctx.canEdit) {
			uploading = true;
			notice = null;
		}
	});

	// Dropping a 3MF anywhere on the page opens the same upload flow (drop zones that handle the
	// drop themselves, like the kit import, call preventDefault and are left alone).
	let dragging = $state(false);
	const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes('Files');
	function onDragOver(e: DragEvent) {
		if (!ctx.canEdit || uploading || !hasFiles(e)) return;
		e.preventDefault();
		dragging = !(e.target as Element | null)?.closest?.('[data-testid="kit-drop"], .upload');
	}
	function onDrop(e: DragEvent) {
		dragging = false;
		if (e.defaultPrevented || !ctx.canEdit || uploading || !hasFiles(e)) return;
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (!file) return;
		if (!/\.3mf$/i.test(file.name)) {
			ctx.error = 'Only .3mf files can be used here (a .gcode.3mf from your slicer works too).';
			return;
		}
		ctx.slicedFile = file;
	}
	let layouts = $state<PlateLayoutInfo[]>([]);
	let current = $state<string | null>(null);
	// Reload the layout name whenever the plates come from somewhere else (switch, upload, other tab).
	$effect(() => {
		void ctx.view.plates[0]?.source;
		buildPlateLayouts(ctx.id)
			.then((r) => {
				layouts = r.layouts;
				current = r.current;
			})
			.catch(() => {});
	});
	const printer = $derived(ctx.view.printer);
	const tunedName = (key: string | null) => {
		const l = layouts.find((x) => x.key === (key ?? layouts.find((y) => y.isDefault)?.key));
		return l ? `MakeGood's ${l.name} profile` : null;
	};
	const layoutName = $derived(
		current === 'upload'
			? 'Your uploaded 3MF'
			: current === 'arranged'
				? `Arranged for ${printer?.name ?? 'your printer'}`
				: (tunedName(current) ?? 'MakeGood profile')
	);
	const layoutNote = $derived(
		current === 'arranged' && printer
			? `Parts grouped by filament and packed onto a ${printer.bedX} × ${printer.bedY} mm bed${printer.mmSlots > 1 ? `, up to ${printer.mmSlots} filaments per plate` : ''}. You still slice in your slicer.`
			: (layouts.find((l) => l.key === current)?.printerNote ?? null)
	);

	// Arrangement (positions, warnings, stale flag), reloaded whenever plates, printer or colors change.
	let arr = $state<ArrangementDto | null>(null);
	let arrRev = $state(0); // bumped after the picker arranged or switched, to reload for sure
	const arrKey = $derived(
		JSON.stringify([
			ctx.view.plates.map((p) => [p.number, p.parts, p.source, p.runs]),
			ctx.view.printer,
			ctx.view.parts.map((p) => [p.slug, p.role]),
			ctx.view.runs.filter((r) => r.plateNumber != null).length,
			arrRev
		])
	);
	$effect(() => {
		void arrKey;
		getArrangement(ctx.id)
			.then((r) => (arr = r))
			.catch(() => {});
	});
	const arranged = (n: number) => arr?.plates.find((p) => p.number === n);
	const planWarnings = $derived(
		printer && arr?.fresh && (current === 'arranged' || !current) ? arr.fresh.warnings : []
	);
	let rearranging = $state(false);
	const tpl = $derived(ctx.view.printTemplate ?? null);
	const tplWhen = $derived(
		tpl
			? new Date(tpl.learnedAt).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				})
			: ''
	);
	let removingTpl = $state(false);
	async function removeTemplate() {
		if (
			!confirm(
				'Forget the print times and grams learned from this file? Your plates stay as they are; times go back to estimates.'
			)
		)
			return;
		removingTpl = true;
		try {
			await forgetPrintTemplate(ctx.id);
			notice = 'Print template removed.';
			await ctx.refresh();
		} catch (e) {
			ctx.error = e instanceof Error ? e.message : 'Could not remove the print template.';
		} finally {
			removingTpl = false;
		}
	}

	async function rearrange() {
		rearranging = true;
		try {
			try {
				await arrangePlates(ctx.id);
			} catch (e) {
				if (e instanceof Error && /print log/.test(e.message)) {
					if (!confirm(`${e.message}\n\nRe-arrange and convert them?`)) return;
					await arrangePlates(ctx.id, true);
				} else throw e;
			}
			notice = 'Plates re-arranged.';
			await ctx.refresh();
		} catch (e) {
			ctx.error = e instanceof Error ? e.message : 'Could not re-arrange.';
		} finally {
			rearranging = false;
		}
	}
	let logOpen = $state<Record<number, boolean>>({});
	// Plates that have both a slicer thumbnail and an arrangement: which one to show.
	let diagramOn = $state<Record<number, boolean>>({});
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
	function saveTime(pl: Plate, seconds: number | null) {
		return ctx.act(() => updatePlate(ctx.id, pl.number, { manualEstSeconds: seconds }));
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
	const printersHref = $derived(
		printersHrefFor(
			(page.data as { teams?: { id: string; slug: string }[] }).teams,
			ctx.view.build.organizationId
		)
	);

	function start(slugs: string[]) {
		return ctx.act(() => printing(ctx.id, { action: 'start', slugs }));
	}
</script>

<svelte:window
	ondragover={onDragOver}
	ondragleave={(e) => {
		if (e.relatedTarget === null) dragging = false;
	}}
	ondrop={onDrop}
/>

{#if dragging}
	<div class="drop-overlay" data-testid="sliced-drop-overlay" role="presentation">
		<div>
			<b>Drop your sliced .3mf here</b>
			<span>Real print times and grams per plate, read from your slicer's file.</span>
		</div>
	</div>
{/if}

{#if ctx.canEdit && !uploading}
	<section class="card sliced-card" aria-label="Use my own sliced file">
		<div class="sliced-text">
			<h2>Use my own sliced file</h2>
			<p class="muted">
				A .3mf or .gcode.3mf from your slicer: real print times and grams. Use its plates as they
				are, or use it as a print template for your own plates. You can also drop the file anywhere
				on this page.
			</p>
		</div>
		<button
			class="btn"
			type="button"
			data-testid="use-own-sliced"
			onclick={() => ((uploading = true), (notice = null))}>Choose a sliced file…</button
		>
	</section>
{/if}

{#if tpl}
	<section class="card tpl-card" aria-label="Print template" data-testid="print-template">
		<div class="tpl-text">
			<h2>Print template</h2>
			<p class="meta" data-testid="print-template-line">
				<b>{tpl.fileName ?? 'Your sliced file'}</b>
				{#if tpl.plates}· {tpl.plates} sliced plate{tpl.plates === 1 ? '' : 's'}{/if}
				{#if tpl.printer}· {tpl.printer}{/if}
				· {tplWhen} ·
				{tpl.method === 'exact'
					? 'measured per object'
					: tpl.method === 'mixed'
						? 'partly measured, partly shared by volume'
						: 'shared by part volume'}
				· {tpl.parts} part{tpl.parts === 1 ? '' : 's'}
				{#if tpl.remapped}· {tpl.remapped} recolored since{/if}
			</p>
			<p class="meta">
				Print times and grams for arranged plates come from your slice, not from estimates.
			</p>
		</div>
		{#if ctx.canEdit}
			<div class="tpl-actions">
				<button
					class="btn sm"
					type="button"
					data-testid="template-replace"
					onclick={() => ((uploading = true), (notice = null))}>Replace…</button
				>
				<button
					class="btn sm"
					type="button"
					data-testid="template-remove"
					disabled={removingTpl}
					onclick={removeTemplate}>Remove</button
				>
			</div>
		{/if}
	</section>
{/if}

<section class="card layout-card" aria-label="Plate layout">
	<div class="group-head">
		<h2>Plate layout: <span data-testid="layout-name">{layoutName}</span></h2>
		<span class="meta num">{ctx.view.plates.length} plates</span>
	</div>
	{#if layoutNote && current !== 'upload'}<p class="muted">{layoutNote}</p>{/if}
	<div class="printer-line" data-testid="printer-line">
		{#if printer}
			<span
				><b>Printer:</b> <span data-testid="printer-name">{printer.name}</span>, bed {printer.bedX} ×
				{printer.bedY}
				mm{printer.mmSlots > 1 ? `, ${printer.mmSlots} filaments per plate` : ''}</span
			>
		{:else}
			<span class="muted">No bed chosen yet. Choose "Arrange for my bed" below.</span>
		{/if}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		{#if printersHref}<a class="btn sm go" href={printersHref} data-testid="manage-printers"
				>Manage printers <span class="btn-arrow" aria-hidden="true">→</span></a
			>{/if}
	</div>
	{#if arr?.stale && ctx.canEdit && printer}
		<div class="stale" role="status" data-testid="stale-banner">
			<span data-testid="stale-text">
				{#if arr.template}
					Colors changed: re-arrange for your new colors using your print template (times and
					orientations from {arr.template.fileName ?? 'your sliced file'})?
				{:else}
					Colors changed: re-arrange plates?
				{/if}
			</span>
			<button class="btn sm primary" type="button" disabled={rearranging} onclick={rearrange}
				>Re-arrange plates</button
			>
		</div>
	{/if}
	{#if planWarnings.length}
		<details
			class="warns"
			data-testid="arrange-warnings"
			open={planWarnings.some((w) => w.code === 'oversize')}
		>
			<summary
				>{planWarnings.length} thing{planWarnings.length === 1 ? '' : 's'} to check for this bed</summary
			>
			<ul>
				{#each planWarnings as w (w.code + w.slug)}<li class={w.code}>{w.message}</li>{/each}
			</ul>
		</details>
	{/if}
	{#if ctx.canEdit}
		<PlateLayoutPicker
			buildId={ctx.id}
			orgId={ctx.view.build.organizationId}
			{printer}
			allowUpload
			plateCount={ctx.view.plates.length}
			onchanged={() => (arrRev++, ctx.refresh())}
			onupload={() => ((uploading = true), (notice = null))}
		/>
	{/if}
	<p class="meta">
		Unsliced files do not carry print times or grams. Use your own sliced file (above) to get them
		per plate, or type the slicer grams on each plate.
	</p>
	{#if notice}<p class="ok-note" role="status">{notice}</p>{/if}
</section>

{#if uploading && ctx.canEdit}
	<div class="upload-backdrop" role="dialog" aria-modal="true" aria-label="Use my own sliced file">
		<div class="upload-sheet" data-testid="upload-dialog">
			<PlateUpload
				view={ctx.view}
				initialFile={ctx.slicedFile}
				oninitial={() => (ctx.slicedFile = null)}
				onclose={() => (uploading = false)}
				ondone={(msg) => {
					uploading = false;
					notice = msg;
					ctx.refresh();
				}}
			/>
		</div>
	</div>
{/if}

{#each ctx.view.plates as pl (pl.number)}
	{@const runs = ctx.view.runs.filter((r) => r.plateNumber === pl.number)}
	{@const idle = pl.parts.filter((s) => !['Printed', 'Printing'].includes(status(s) ?? ''))}
	{@const done = pl.parts.filter((s) => status(s) === 'Printed').length}
	{@const ri = runInfo(ctx.view, pl.number)}
	{@const logged = runs.reduce((a, r) => a + (r.grams ?? 0), 0)}
	<section class="plate-card" aria-label="Plate {pl.number}">
		<div class="group-head">
			<h2>Plate {pl.number} · {pl.name}</h2>
			<span class="meta num"
				>{draft ? `${pl.parts.length} parts` : `${done}/${pl.parts.length} printed`}</span
			>
			{#each rolesOf(pl) as r (r)}<RoleChip filament={ctx.filament(r)} role={r} />{/each}
			{#if slicerTotal(pl)}
				<span class="meta num" title="From your slicer grams"
					>~{fmt(slicerTotal(pl))} g (slicer)</span
				>
			{/if}
			<PlateTime plate={pl} />
			{#if pl.runNote || pl.runs > 1}
				<span class="meta" style="color:var(--warn);font-weight:600"
					>{pl.runNote ?? `Print ${pl.runs} times`}{ri ? ` · run ${ri.run} of ${ri.of}` : ''}</span
				>
			{/if}
			{#if logged}
				<span class="meta num" style="color:var(--ok);font-weight:600">{fmt(logged)} g logged</span>
			{/if}
		</div>

		{#if arranged(pl.number) && arr}
			{@const ap = arranged(pl.number)!}
			{#if pl.thumbnailPath}
				<div class="view-toggle" role="group" aria-label="Plate {pl.number} view">
					<button
						type="button"
						class="seg"
						aria-pressed={!diagramOn[pl.number]}
						onclick={() => (diagramOn[pl.number] = false)}>Slicer preview</button
					>
					<button
						type="button"
						class="seg"
						aria-pressed={!!diagramOn[pl.number]}
						onclick={() => (diagramOn[pl.number] = true)}>Diagram</button
					>
				</div>
			{/if}
			{#if !pl.thumbnailPath || diagramOn[pl.number]}
				<PlateArrangement
					plate={ap}
					footprints={arr.footprints}
					silhouettes={arr.silhouettes ?? {}}
					colorOf={(r) => ctx.filament(r)?.hex ?? '#888888'}
					nameOf={(s) => partOf(s)?.name ?? s}
					filamentLabel={(r) => filLabel(ctx.filament(r), r)}
					perRun={pl.runs > 1}
					bedLabel="{arr.printer?.bedX} × {arr.printer?.bedY} mm"
				/>
			{/if}
		{/if}
		{#if pl.thumbnailPath && !(arranged(pl.number) && arr && diagramOn[pl.number])}
			<img
				class="plate-thumb"
				src={plateThumbnailUrl(ctx.id, pl.number, pl.source)}
				alt="Plate {pl.number} preview"
				loading="lazy"
				width="160"
				height="160"
			/>
		{/if}
		{#if Object.keys(pl.filamentGrams).length}
			<div class="fil-grams">
				{#each Object.entries(pl.filamentGrams) as [role, g] (role)}
					<span class="meta num"
						>{filLabel(ctx.filament(role), role)} {fmt(g)} g{pl.runs > 1 ? ' per run' : ''}</span
					>
				{/each}
			</div>
		{/if}
		<div class="now-parts">
			{#each pl.parts as slug (slug)}
				<button
					class="now-part"
					type="button"
					title="Open in the build guide"
					onclick={() => ctx.openGuide(slug)}
					>{partOf(slug)?.name ?? slug}
					{#if !draft}<span class="meta">· {status(slug)}</span>{/if}</button
				>
			{/each}
		</div>

		{#if ctx.canEdit && track}
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
				<SlicerTimeInput
					label={pl.runs > 1 ? 'Slicer time per run' : 'Slicer time'}
					value={pl.estSource === 'manual' ? pl.estSeconds : null}
					placeholder={pl.baseEstSeconds || pl.estSeconds
						? fmtH(pl.baseEstSeconds || pl.estSeconds || 0)
						: 'e.g. 14h 20m'}
					onsave={(s) => saveTime(pl, s)}
				/>
				{#if pl.estSource === 'manual' && pl.baseEstSeconds}
					<span class="meta" data-testid="time-override"
						>overrides {pl.baseEstSource === 'slicer' ? 'file' : 'estimate'}
						{fmtH(pl.baseEstSeconds)}</span
					>
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
						<StartOnPrinter slugs={idle} plateNumber={pl.number} />
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

		{#if runs.length && track}
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

<style>
	.layout-card {
		margin-bottom: 12px;
	}
	.layout-card p {
		margin: 0;
	}
	.ok-note {
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--ok-soft);
		color: var(--ok);
		font-size: 13px;
	}
	.plate-thumb {
		justify-self: start;
		max-width: 100%;
		height: auto;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		object-fit: contain;
	}
	.printer-line {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		margin: 6px 0;
		font-size: 14px;
	}
	.tpl-card {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		justify-content: space-between;
		align-items: center;
	}
	.tpl-text {
		min-width: 0;
		flex: 1 1 280px;
		overflow-wrap: anywhere;
	}
	.tpl-text h2,
	.tpl-text p {
		margin: 0;
	}
	.tpl-actions {
		display: flex;
		gap: 8px;
	}
	.stale {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		margin: 8px 0;
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--warn-soft);
		color: var(--warn);
		font-size: 14px;
		font-weight: 600;
	}
	.warns {
		margin: 8px 0;
		font-size: 13px;
	}
	.warns summary {
		cursor: pointer;
		color: var(--warn);
		font-weight: 600;
	}
	.warns ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
	.warns li.oversize {
		color: var(--bad);
	}
	.view-toggle {
		display: inline-flex;
		justify-self: start;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}
	.seg {
		border: 0;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		padding: 5px 12px;
		cursor: pointer;
	}
	.seg[aria-pressed='true'] {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}
	.fil-grams {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
	}
	.sliced-card {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
		margin-bottom: 14px;
		border-style: dashed;
	}
	.sliced-text {
		flex: 1 1 260px;
		min-width: 0;
	}
	.sliced-text h2 {
		margin: 0 0 2px;
		font-size: 17px;
	}
	.sliced-text p {
		margin: 0;
		font-size: 13px;
	}
	.drop-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 16px;
		text-align: center;
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		border: 3px dashed var(--accent);
		pointer-events: none;
	}
	.drop-overlay > div {
		display: grid;
		gap: 4px;
		padding: 18px 22px;
		border-radius: 12px;
		background: var(--card);
		color: var(--ink);
		box-shadow: 0 4px 24px rgb(0 0 0 / 0.25);
	}
	.drop-overlay span {
		font-size: 13px;
		color: var(--muted);
	}
	.upload-backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		align-items: start;
		justify-items: center;
		padding: 12px;
		overflow-y: auto;
		background: rgb(0 0 0 / 0.5);
	}
	.upload-sheet {
		width: min(760px, 100%);
		margin: 4vh 0;
	}
</style>
