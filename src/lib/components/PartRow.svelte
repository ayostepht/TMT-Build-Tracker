<script lang="ts">
	import { PART_STATUSES, type PartDef, type PrintRun } from '#lib/domain/types.ts';
	import { fmt, plateOf } from '#lib/domain/index.ts';
	import { partRuns } from '#lib/domain/logrun.ts';
	import { runTargets } from '#lib/domain/actions.ts';
	import { updatePart } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import Swatch from './Swatch.svelte';
	import RunTable from './RunTable.svelte';
	import LogRunSheet from './LogRunSheet.svelte';
	import PlateControl from './PlateControl.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import StartOnPrinter from './StartOnPrinter.svelte';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';

	let {
		part,
		focus = false,
		justNow = false,
		plateHeader = false
	}: {
		part: PartDef;
		focus?: boolean;
		/** Became Printed during this visit while Printed parts are hidden. */ justNow?: boolean;
		/** The page shows this part's plate heading (with its own printer confirmation). */
		plateHeader?: boolean;
	} = $props();

	const ctx = getBuildCtx();
	let open = $state(false);
	let copied = $state('Copy');
	// Set by the Print tab when a #part-slug link points here: expand the detail and flash the row.
	$effect(() => {
		if (focus) open = true;
	});

	const st = $derived(ctx.view.state[part.slug]);
	const fil = $derived(ctx.filament(part.role));
	const plate = $derived(plateOf(ctx.view, part.slug));
	const doneComps = $derived(part.components.filter((_, i) => st?.comps[i]).length);
	const log = $derived(partRuns(ctx.view, part.slug));
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	const hasPrinter = $derived(store.printers.some((p) => p.enabled));
	let where = $state(false);
	// Printing: with a printer connected (and the part on a plate) ask where; else mark it directly.
	function pickStatus(s: string) {
		if (s === 'Printing' && hasPrinter && plate) where = true;
		else void ctx.setPartStatus(part.slug, s as (typeof PART_STATUSES)[number]);
	}

	function scopeOf(r: PrintRun): string {
		if (r.plateNumber == null) return '';
		const n = runTargets(ctx.view, r).length;
		const total = ctx.view.plates.find((p) => p.number === r.plateNumber)?.parts.length ?? n;
		return `Plate ${r.plateNumber} · ${n >= total ? 'whole plate' : `${n} of ${total} parts`}`;
	}

	// Delete goes through the edit sheet's in-app confirmation (same as the plate history and Files tab).
	function removeRun(r: PrintRun) {
		editing = r;
		deleteFirst = true;
		editOpen = true;
	}
	function editRun(r: PrintRun) {
		editing = r;
		deleteFirst = false;
		editOpen = true;
	}
	const pages = $derived(
		part.guideRefs.map((g) => ({
			...g,
			title: ctx.view.guidePages.find((p) => p.page === g.page)?.title ?? ''
		}))
	);

	async function copy() {
		try {
			await navigator.clipboard.writeText(part.sourceFile);
			copied = 'Copied';
		} catch {
			copied = 'Select and copy';
		}
		setTimeout(() => (copied = 'Copy'), 1500);
	}

	let logOpen = $state(false);
	let editing = $state<PrintRun | null>(null);
	let editOpen = $state(false);
	let deleteFirst = $state(false);
</script>

<div
	class="row"
	class:flash={focus}
	class:just-now-row={justNow}
	id="part-{part.slug}"
	data-s={st?.status}
	data-id={part.slug}
>
	<div class="row-main">
		<div>
			<div class="pname">
				<button
					class="pbtn"
					type="button"
					title="Open in the build guide"
					onclick={() => ctx.openGuide(part.slug)}>{part.name}</button
				>
			</div>
			<div class="psub">
				<span>
					{#if fil}<Swatch hex={fil.hex} tpu={fil.tpu} size="mini" />{/if}
					{filLabel(fil, part.role)}
				</span>
				<span class="num">{part.bomGrams ? `~${fmt(part.bomGrams)} g` : 'weight n/a'}</span>
				{#if justNow}<span class="just-now" data-testid="printed-just-now">Printed just now</span
					>{:else if st?.printedOn}<span>printed {st.printedOn}</span>{/if}
			</div>
		</div>
		<div class="settings">
			{#if plate}<span class="pset plate" title="Plate in the print profile"
					>Plate {plate.number}</span
				>{/if}
			{#if part.qty}<span class="pset">×{part.qty}</span>{/if}
			{#if part.walls != null}<span class="pset">{part.walls} walls</span>{/if}
			{#if part.infill}<span class="pset">{part.infill}</span>{/if}
			{#if part.supports}<span class="pset"
					>{part.supports === 'Yes' ? 'supports' : 'no supports'}</span
				>{/if}
			{#if part.brim}<span class="pset hot">{part.brim} brim</span>{/if}
			{#if part.components.length}
				<span class="pset" class:hot={doneComps < part.components.length}
					>{doneComps}/{part.components.length} pieces</span
				>
			{/if}
		</div>
		<div class="pr-actions">
			<StatusBadge
				label={part.name}
				status={st?.status ?? 'To print'}
				options={[...PART_STATUSES]}
				interactive={ctx.canEdit}
				onpick={pickStatus}
				testid="part-status"
				small
			/>
			<button
				class="more pr-more"
				type="button"
				aria-expanded={open}
				aria-label="Details for {part.name}"
				onclick={() => (open = !open)}>{open ? '−' : '+'}</button
			>
		</div>
	</div>
	{#if ctx.canEdit && plate}
		<StartOnPrinter
			bind:open={where}
			slugs={[part.slug]}
			plateNumber={plate.number}
			label={part.name}
			confirm={!open && !plateHeader}
		/>
	{/if}
	{#if open}
		<div class="detail">
			<div>
				<h3>File</h3>
				<div class="file">
					<code>{part.sourceFile}</code>
					{#if part.sourceFile.includes('.')}
						<button class="btn sm" type="button" onclick={copy}>{copied}</button>
					{/if}
				</div>
				{#if part.notes.length}
					<h3 style="margin-top:var(--sp-6)">Notes</h3>
					<ul class="notes">
						{#each part.notes as n (n)}<li>{n}</li>{/each}
					</ul>
				{/if}
				{#if part.components.length}
					<h3 style="margin-top:var(--sp-6)">Pieces</h3>
					<div class="comps">
						{#each part.components as c, i (i)}
							<label>
								<input
									type="checkbox"
									checked={!!st?.comps[i]}
									disabled={!ctx.canEdit}
									onchange={(e) => {
										const on = e.currentTarget.checked;
										ctx.act(() =>
											updatePart(ctx.id, part.slug, { comps: { ...st?.comps, [i]: on } })
										);
									}}
								/>
								<span
									>{c.name}
									<small>{c.settings}{c.file ? ` · ${c.file}` : ''}</small></span
								>
							</label>
						{/each}
					</div>
				{/if}
				{#if pages.length}
					<h3 style="margin-top:var(--sp-6)">Guide</h3>
					<div class="chips">
						{#each pages as g (g.page)}
							<button
								class="ds-badge"
								type="button"
								title={g.text}
								onclick={() => ctx.openGuide(part.slug)}
								>p{g.page}{g.title ? ` · ${g.title.replace(/:.*/, '')}` : ''}</button
							>
						{/each}
					</div>
				{/if}
				{#if plate && ctx.canEdit}
					<h3 style="margin-top:var(--sp-6)">Plate {plate.number}</h3>
					<div class="meta" style="margin-bottom:var(--sp-3)">
						{plate.parts.map((s) => ctx.view.parts.find((x) => x.slug === s)?.name ?? s).join(', ')}
					</div>
					<PlateControl {plate} only={plate.perPartRuns ? part.slug : null} />
				{/if}
				<h3 style="margin-top:var(--sp-6)">Assigned to</h3>
				<select
					aria-label="Assigned to"
					disabled={!ctx.canEdit}
					value={st?.assigneeUserId ?? ''}
					onchange={(e) => {
						const v = e.currentTarget.value || null;
						ctx.act(() => updatePart(ctx.id, part.slug, { assigneeUserId: v }));
					}}
				>
					<option value="">Nobody</option>
					{#each ctx.view.members as m (m.userId)}<option value={m.userId}>{m.name}</option>{/each}
				</select>
			</div>
			<div>
				<h3>Print log</h3>
				{#if log.length}
					<RunTable
						runs={log}
						canEdit={ctx.canEdit}
						{scopeOf}
						ondelete={removeRun}
						onedit={editRun}
					/>
				{:else}
					<div class="empty">
						No prints logged yet. Logging a success marks the part printed; a failure flags it for
						reprint.
					</div>
				{/if}
				{#if ctx.canEdit}
					<button class="btn sm" type="button" onclick={() => (logOpen = true)}>Log a print…</button
					>
					<LogRunSheet
						bind:open={logOpen}
						slugs={[part.slug]}
						startedAt={st?.status === 'Printing' ? st.startedAt : null}
						title="Log print: {part.name}"
					/>
					<LogRunSheet bind:open={editOpen} editRun={editing} {deleteFirst} />
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Touch sizes on phones (coarse pointer only, so desktop rows stay as tall as before). The part
	   name keeps its font; its button grows to 44px and the negative margin cancels the extra height. */
	@media (pointer: coarse) {
		.pbtn {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			margin-block: -11px;
		}
		.pr-more {
			width: 44px;
			height: 44px;
		}
	}
	/* Status badge and the details toggle share one cell: one line of height on a phone. */
	.pr-actions {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		justify-self: end;
	}

	/* Part settings tags (was the global .set). */
	.pset {
		font: 500 var(--fs-xs) / 1 var(--f-mono);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: var(--sp-2) var(--sp-3);
	}
	.pset.plate {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: transparent;
		font-weight: 600;
	}
	.pset.hot {
		background: var(--warn-soft);
		color: var(--warn);
		border-color: transparent;
	}
	.just-now {
		font-weight: 600;
		color: var(--ink);
	}
	.just-now-row .row-main {
		opacity: 0.7;
	}
</style>
