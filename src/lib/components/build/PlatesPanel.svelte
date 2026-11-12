<script lang="ts">
	import { page } from '$app/state';
	import { printersHrefFor } from '#lib/workspace-links.ts';
	import { onMount, tick } from 'svelte';
	import { fmt, fmtH, runInfo } from '#lib/domain/index.ts';
	import {
		updatePlate,
		buildPlateLayouts,
		plateThumbnailUrl,
		arrangePlates,
		forgetPrintTemplate,
		getArrangement,
		exportDownloadUrl,
		type ArrangementDto,
		type PlateLayoutInfo
	} from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from '#lib/components/build-context.svelte.ts';
	import type { Plate, PrintRun } from '#lib/domain/types.ts';
	import RoleChip from '#lib/components/RoleChip.svelte';
	import RunTable from '#lib/components/RunTable.svelte';
	import LogRunSheet from '#lib/components/LogRunSheet.svelte';
	import PlateTime from '#lib/components/PlateTime.svelte';
	import PlateControl from '#lib/components/PlateControl.svelte';
	import SlicerInput from '#lib/components/SlicerInput.svelte';
	import SlicerTimeInput from '#lib/components/SlicerTimeInput.svelte';
	import PlateLayoutPicker from '#lib/components/PlateLayoutPicker.svelte';
	import PlateUpload from '#lib/components/PlateUpload.svelte';
	import { exportPref, FLAVOR_OPTIONS } from '#lib/client/export-flavor.svelte.ts';
	import PlateArrangement from '#lib/components/PlateArrangement.svelte';
	import AskDialog from '#lib/components/AskDialog.svelte';
	import { createAsk } from '#lib/client/ask.svelte.ts';

	/** Setup wizard: plate pictures only, no print log or slicer grams. */
	let { wizard = false }: { wizard?: boolean } = $props();
	const ctx = getBuildCtx();
	const asking = createAsk();
	/** Studio drafts have no tracking either: no print log, slicer grams or start buttons. */
	const draft = $derived(ctx.view.build.kind === 'draft');
	const track = $derived(!wizard && !draft);
	let uploading = $state(false);
	let notice = $state<string | null>(null);
	let upload = $state<PlateUpload>();
	// The control that opened the upload sheet. The "Use my own sliced file" card is replaced while
	// the sheet is open, so focus goes back to the control with the same test id when it closes.
	let openerId: string | null = null;
	let openerEl: HTMLElement | null = null;
	function openUpload() {
		const a = document.activeElement;
		openerEl = a instanceof HTMLElement && a !== document.body ? a : null;
		openerId = a instanceof HTMLElement ? (a.dataset.testid ?? null) : null;
		uploading = true;
		notice = null;
	}
	async function closeUpload() {
		uploading = false;
		await tick();
		const a = document.activeElement;
		if (openerId && (!a || a === document.body))
			document.querySelector<HTMLElement>(`[data-testid="${openerId}"]`)?.focus();
	}
	/** Opens the upload sheet as a modal <dialog>: native focus trap, inert page and Escape. */
	function modal(node: HTMLDialogElement) {
		// Remember the opener: an unmounted <dialog> does not get native focus restore.
		const active = document.activeElement;
		const opener =
			openerEl ?? (active instanceof HTMLElement && active !== document.body ? active : null);
		openerEl = null;
		node.showModal();
		return {
			destroy() {
				if (node.open) node.close();
				// Give focus back unless something outside the dialog already took it on purpose.
				const restore = () => {
					const a = document.activeElement;
					const lost = !a || a === document.body || node.contains(a);
					if (!lost) return;
					const target = opener?.isConnected
						? opener
						: openerId
							? document.querySelector<HTMLElement>(`[data-testid="${openerId}"]`)
							: null;
					target?.focus({ preventScroll: true });
				};
				restore();
				// The opener card is re-rendered a tick later; closeUpload's lookup covers the rest.
				setTimeout(restore, 0);
			}
		};
	}
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
	// The layout choice is fetched once, here, and handed to the picker (which used to fetch it on
	// its own: two identical requests, answered at different times, left heading and select
	// disagreeing until the slower one landed).
	let layouts = $state<PlateLayoutInfo[]>([]);
	let current = $state<string | null>(null);
	let layoutsLoaded = $state(false);
	// One object per fetch, so the picker re-applies it only when a new answer arrives.
	let preload = $state.raw<{ layouts: PlateLayoutInfo[]; current: string | null } | null>(null);
	/** What the plates themselves say about the layout, so the heading is right before the fetch lands. */
	const sourceLayout = (source: string | undefined): string | null | undefined =>
		source === undefined
			? undefined
			: source === 'arranged'
				? 'arranged'
				: source.startsWith('upload:')
					? 'upload'
					: source.startsWith('layout:')
						? source.slice('layout:'.length)
						: null; // 'template': the default layout
	// Reload the layout name whenever the plates come from somewhere else (switch, upload, other tab).
	$effect(() => {
		const seed = sourceLayout(ctx.view.plates[0]?.source);
		if (seed !== undefined) current = seed;
		buildPlateLayouts(ctx.id)
			.then((r) => {
				layouts = r.layouts;
				current = r.current;
				layoutsLoaded = true;
				preload = r;
			})
			.catch(() => {});
	});
	const printer = $derived(ctx.view.printer);
	const tunedName = (key: string | null) => {
		const l = layouts.find((x) => x.key === (key ?? layouts.find((y) => y.isDefault)?.key));
		return l ? `MakeGood's ${l.name} profile` : null;
	};
	// Until the layout is known the heading says nothing rather than a wrong name.
	const layoutName = $derived(
		current === 'upload'
			? 'Your uploaded 3MF'
			: current === 'arranged'
				? `Arranged for ${printer?.name ?? 'your printer'}`
				: layoutsLoaded
					? (tunedName(current) ?? 'MakeGood profile')
					: null
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
		const yes = await asking.ask(
			'Forget the print times and grams learned from this file? Your plates stay as they are; times go back to estimates.',
			{ title: 'Remove print template', confirmLabel: 'Remove', danger: true }
		);
		if (!yes) return;
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
					if (
						!(await asking.ask(`${e.message}\n\nRe-arrange and convert them?`, {
							title: 'Re-arrange plates',
							confirmLabel: 'Re-arrange and convert'
						}))
					)
						return;
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
	// Finished plates (every part Printed) collapse to one line, behind a toggle that is closed by
	// default; the choice is remembered per build on this device.
	const isFinished = (pl: Plate) =>
		track && pl.parts.length > 0 && pl.parts.every((s) => status(s) === 'Printed');
	const finishedCount = $derived(ctx.view.plates.filter(isFinished).length);
	const printedKey = $derived(`tmt-files-printed:${ctx.id}`);
	let printedOpen = $state(false);
	let expandedPl = $state<Record<number, boolean>>({});
	onMount(() => {
		exportPref.load();
		try {
			printedOpen = localStorage.getItem(printedKey) === '1';
		} catch {
			/* storage unavailable: closed */
		}
		void openFromHash();
	});
	const printedLabel = $derived(
		`${printedOpen ? 'Hide' : 'Show'} ${finishedCount} printed plate${finishedCount === 1 ? '' : 's'}`
	);
	function togglePrinted() {
		printedOpen = !printedOpen;
		try {
			if (printedOpen) localStorage.setItem(printedKey, '1');
			else localStorage.removeItem(printedKey);
		} catch {
			/* still works for this visit */
		}
	}
	/** A link to #plate-N opens that plate even when it is finished and collapsed. */
	async function openFromHash() {
		const m = /^#plate-(\d+)$/.exec(location.hash);
		if (!m) return;
		const n = Number(m[1]);
		const pl = ctx.view.plates.find((x) => x.number === n);
		if (!pl) return;
		if (isFinished(pl)) {
			printedOpen = true;
			expandedPl[n] = true;
		}
		await tick();
		document.getElementById(`plate-${n}`)?.scrollIntoView({ block: 'start' });
	}
	const flavorShort = $derived(FLAVOR_OPTIONS.find((f) => f.key === exportPref.flavor)?.short);
	const plateSecs = (pl: Plate) => (pl.estSeconds ? pl.estSeconds * Math.max(1, pl.runs) : 0);

	// Plates that have both a slicer thumbnail and an arrangement: which one to show.
	let diagramOn = $state<Record<number, boolean>>({});
	let editing = $state<PrintRun | null>(null);
	let deleteFirst = $state(false);
	let editOpen = $state(false);

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
</script>

<AskDialog ask={asking} />

<svelte:window
	onhashchange={() => void openFromHash()}
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
		<button class="btn" type="button" data-testid="use-own-sliced" onclick={openUpload}
			>Choose a sliced file…</button
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
				<button class="btn sm" type="button" data-testid="template-replace" onclick={openUpload}
					>Replace…</button
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
		<h2>
			Plate layout: <span data-testid="layout-name" aria-busy={layoutName === null}
				>{layoutName ?? 'Loading…'}</span
			>
		</h2>
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
			{preload}
			plateCount={ctx.view.plates.length}
			onchanged={() => (arrRev++, ctx.refresh())}
			onupload={openUpload}
		/>
	{/if}
	<p class="meta">
		Unsliced files do not carry print times or grams. Use your own sliced file (above) to get them
		per plate, or type the slicer grams on each plate.
	</p>
	{#if notice}<p class="ok-note" role="status">{notice}</p>{/if}
</section>

{#if uploading && ctx.canEdit}
	<!-- Escape asks the upload first (it discards a parsed file); a confirmation inside is its own
	     dialog on top and takes the Escape itself -->
	<dialog
		class="ds-modal ds-modal--sheet upload-sheet"
		aria-label="Use my own sliced file"
		data-testid="upload-dialog"
		use:modal
		oncancel={(e) => {
			e.preventDefault();
			upload?.close();
		}}
	>
		<PlateUpload
			bind:this={upload}
			view={ctx.view}
			initialFile={ctx.slicedFile}
			oninitial={() => (ctx.slicedFile = null)}
			onclose={closeUpload}
			ondone={(msg) => {
				void closeUpload();
				notice = msg;
				ctx.refresh();
			}}
		/>
	</dialog>
{/if}

{#snippet plateExport(pl: Plate)}
	{#if printer}
		<span class="plate-export" data-testid="plate-export">
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				class="btn sm"
				href={exportDownloadUrl(ctx.id, exportPref.flavor, [pl.number])}
				download
				data-sveltekit-reload
				data-testid="plate-export-btn"
				aria-label="Export plate {pl.number} for {flavorShort}">Export · {flavorShort}</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</span>
	{/if}
{/snippet}

<div class="plates-bar">
	{#if finishedCount}
		<button
			class="btn sm printed-toggle"
			type="button"
			aria-expanded={printedOpen}
			data-testid="printed-plates-toggle"
			onclick={togglePrinted}>{printedLabel}</button
		>
	{/if}
	{#if printer}
		<label class="plates-fmt">
			<span class="meta">Export format</span>
			<select data-testid="plate-export-format" bind:value={exportPref.flavor}>
				{#each FLAVOR_OPTIONS as f (f.key)}<option value={f.key}>{f.label}</option>{/each}
			</select>
		</label>
	{/if}
</div>

{#each ctx.view.plates as pl (pl.number)}
	{@const fin = isFinished(pl)}
	{@const runs = ctx.view.runs.filter((r) => r.plateNumber === pl.number)}
	{@const done = pl.parts.filter((s) => status(s) === 'Printed').length}
	{@const ri = runInfo(ctx.view, pl.number)}
	{@const logged = runs.reduce((a, r) => a + (r.grams ?? 0), 0)}
	{#if fin && !printedOpen}
		<!-- finished plates are collapsed -->
	{:else if fin && !expandedPl[pl.number]}
		<div class="plate-row" id="plate-{pl.number}" data-testid="plate-row">
			<span class="pr-name"><b>Plate {pl.number}</b> · {pl.name}</span>
			<span class="meta pr-ok">Printed</span>
			{#if plateSecs(pl)}<span class="meta num">{fmtH(plateSecs(pl))}</span>{/if}
			<span class="pr-actions">
				{@render plateExport(pl)}
				<button
					class="btn sm ghost"
					type="button"
					aria-expanded="false"
					aria-label="Show details for plate {pl.number}"
					onclick={() => (expandedPl[pl.number] = true)}>Details</button
				>
			</span>
		</div>
	{:else}
		<section
			class="ds-card ds-card--compact plate-card"
			id="plate-{pl.number}"
			aria-label="Plate {pl.number}"
		>
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
						>{pl.runNote ?? `Print ${pl.runs} times`}{ri
							? ` · run ${ri.run} of ${ri.of}`
							: ''}</span
					>
				{/if}
				{#if logged}
					<span class="meta num" style="color:var(--ok);font-weight:600"
						>{fmt(logged)} g logged</span
					>
				{/if}
			</div>

			{#if arranged(pl.number) && arr}
				{@const ap = arranged(pl.number)!}
				{#if pl.thumbnailPath}
					<div class="ds-seg view-toggle" role="group" aria-label="Plate {pl.number} view">
						<button
							type="button"
							aria-pressed={!diagramOn[pl.number]}
							onclick={() => (diagramOn[pl.number] = false)}>Slicer preview</button
						>
						<button
							type="button"
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
			<div class="plate-tools">
				{@render plateExport(pl)}
				{#if fin}
					<button class="btn sm ghost" type="button" onclick={() => (expandedPl[pl.number] = false)}
						>Collapse</button
					>
				{/if}
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
					<span style="margin-left:auto"><PlateControl plate={pl} alwaysLog /></span>
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
						ondelete={(r) => ((editing = r), (deleteFirst = true), (editOpen = true))}
						onedit={(r) => ((editing = r), (deleteFirst = false), (editOpen = true))}
					/>
				</div>
			{/if}
		</section>
	{/if}
{:else}
	<p class="empty">This template has no plates yet.</p>
{/each}
{#if ctx.canEdit}
	<LogRunSheet bind:open={editOpen} editRun={editing} {deleteFirst} />
{/if}

<style>
	.plates-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4) var(--sp-8);
		margin-bottom: var(--sp-5);
	}
	.plates-bar:empty {
		display: none;
	}
	.plates-fmt {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-4);
		min-width: 0;
	}
	.plates-fmt select {
		width: auto;
		max-width: 100%;
		min-height: 36px;
		padding: var(--sp-2) var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--card);
		color: var(--ink);
		font: inherit;
		font-size: var(--fs-md);
	}
	.plate-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-2) var(--sp-6);
		margin-bottom: var(--sp-4);
		padding: var(--sp-4) var(--sp-6);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--card);
		scroll-margin-top: 56px;
	}
	.pr-name {
		min-width: 0;
		flex: 1 1 200px;
		overflow-wrap: anywhere;
	}
	.pr-ok {
		color: var(--ok);
		font-weight: 600;
	}
	.pr-actions,
	.plate-tools,
	.plate-export {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
	}
	.pr-actions :global(.btn),
	.plate-tools :global(.btn) {
		min-height: 40px;
	}
	@media (max-width: 760px) {
		.pr-actions {
			flex: 1 1 100%;
		}
	}
	@media (pointer: coarse) {
		.plates-fmt select {
			font-size: var(--fs-field);
			min-height: 40px;
		}
	}
	.plate-card {
		scroll-margin-top: 56px;
	}
	.layout-card {
		margin-bottom: var(--sp-6);
	}
	.layout-card p {
		margin: 0;
	}
	.ok-note {
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--r-md);
		background: var(--ok-soft);
		color: var(--ok);
		font-size: var(--fs-sm);
	}
	.plate-thumb {
		justify-self: start;
		max-width: 100%;
		height: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: #fff; /* slicer thumbnails are drawn for a white page: no token, stays white in dark */
		object-fit: contain;
	}
	.printer-line {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4) var(--sp-6);
		align-items: center;
		margin: var(--sp-3) 0;
		font-size: var(--fs-md);
	}
	.tpl-card {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-5) var(--sp-8);
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
		gap: var(--sp-4);
	}
	.stale {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4) var(--sp-6);
		align-items: center;
		margin: var(--sp-4) 0;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--r-md);
		background: var(--warn-soft);
		color: var(--warn);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.warns {
		margin: var(--sp-4) 0;
		font-size: var(--fs-sm);
	}
	.warns summary {
		cursor: pointer;
		color: var(--warn);
		font-weight: 600;
	}
	.warns ul {
		margin: var(--sp-3) 0 0;
		padding-left: var(--sp-9);
	}
	.warns li.oversize {
		color: var(--bad);
	}
	.view-toggle {
		justify-self: start;
	}
	.fil-grams {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-6);
	}
	.sliced-card {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-5) var(--sp-8);
		margin-bottom: var(--sp-7);
		border-style: dashed;
	}
	.sliced-text {
		flex: 1 1 260px;
		min-width: 0;
	}
	.sliced-text h2 {
		margin: 0 0 var(--sp-1);
		font-size: var(--fs-lg);
	}
	.sliced-text p {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.drop-overlay {
		position: fixed;
		inset: 0 0 var(--bottom-bar-h, 0px) 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: var(--sp-8);
		text-align: center;
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		border: 3px dashed var(--accent);
		pointer-events: none;
	}
	.drop-overlay > div {
		display: grid;
		gap: var(--sp-2);
		padding: var(--sp-9) 22px;
		border-radius: var(--r-xl);
		background: var(--card);
		color: var(--ink);
		box-shadow: var(--shadow-2);
	}
	.drop-overlay span {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	@media (min-width: 761px) {
		.upload-sheet {
			width: min(760px, calc(100vw - 32px));
		}
	}
</style>
