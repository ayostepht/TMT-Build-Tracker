<script lang="ts">
	import { PART_STATUSES, type PartDef, type PrintRun } from '#lib/domain/types.ts';
	import { fmt, partGrams, plateOf } from '#lib/domain/index.ts';
	import { parseGrams, partRuns } from '#lib/domain/logrun.ts';
	import { betweenRuns, loggedPieces, printingPieces, runTargets } from '#lib/domain/actions.ts';
	import { updatePart } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import Swatch from './Swatch.svelte';
	import RunTable from './RunTable.svelte';
	import LogRunSheet from './LogRunSheet.svelte';
	import PlateControl from './PlateControl.svelte';
	import PartPiecesAction, { piecesOffered } from './PartPiecesAction.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import StartOnPrinter from './StartOnPrinter.svelte';
	import { focusIn } from '#lib/client/focus.ts';
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
	const uid = $props.id();
	let open = $state(false);
	let copied = $state('Copy');
	// Set by the Print tab when a #part-slug link points here: expand the detail and flash the row.
	$effect(() => {
		if (focus) open = true;
	});

	const st = $derived(ctx.view.state[part.slug]);
	const fil = $derived(ctx.filament(part.role));
	const plate = $derived(plateOf(ctx.view, part.slug));
	const onPrinter = $derived(printingPieces(ctx.view, part.slug));
	// Pieces a Success print log covers: ticked and locked until that log is deleted or undone.
	const locked = $derived(new Set(loggedPieces(ctx.view, part.slug)));
	const doneComps = $derived(
		part.components.filter((_, i) => st?.comps[i] || locked.has(i)).length
	);
	const log = $derived(partRuns(ctx.view, part.slug));
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	const hasPrinter = $derived(store.printers.some((p) => p.enabled));
	// The plate heading above this row already offers "Print some pieces…" when this is the only part of
	// its plate still to start (PlateControl): the row then leaves it out so there is one button.
	const plateOffersPieces = $derived(
		plateHeader &&
			!!plate &&
			plate.parts.filter(
				(s) =>
					ctx.view.state[s]?.status !== 'Printed' &&
					!(ctx.view.state[s]?.status === 'Printing' && !betweenRuns(ctx.view, s))
			).length === 1
	);
	let where = $state(false);
	let piecesPicking = $state(false);
	const canSkip = $derived(ctx.canEdit && !!st && st.status !== 'Printing');
	// Printing: with a printer connected (and the part on a plate) ask where; else mark it directly.
	function pickStatus(s: string) {
		if (s === 'Printing' && hasPrinter && plate) where = true;
		else void ctx.setPartStatus(part.slug, s as (typeof PART_STATUSES)[number]);
	}

	// Weight: typed > your slice > MakeGood BOM (domain/accounting.ts partGrams); unknown offers "Add weight".
	const gi = $derived(partGrams(ctx.view, part.slug));
	const typedG = $derived(st?.manualGrams ?? null);
	let weightOpen = $state(false);
	let wDraft = $state('');
	let wBusy = $state(false);
	const wParsed = $derived(parseGrams(wDraft));
	const wInvalid = $derived(
		wDraft.trim() !== '' && (Number.isNaN(wParsed) || (wParsed ?? 0) > 20000)
	);
	function openWeight() {
		wDraft = typedG ? String(typedG) : '';
		weightOpen = true;
	}
	async function saveWeight(e: Event) {
		e.preventDefault();
		if (wInvalid || wBusy) return;
		// Empty or 0 clears the entry, as the server reads it.
		const value = wParsed && wParsed > 0 ? wParsed : null;
		if (value === null && !typedG) {
			weightOpen = false;
			return;
		}
		wBusy = true;
		const ok = await ctx.act(() => updatePart(ctx.id, part.slug, { manualGrams: value }));
		wBusy = false;
		if (ok) weightOpen = false;
	}
	function clearWeight() {
		wDraft = '';
		void saveWeight(new Event('submit'));
	}

	function scopeOf(r: PrintRun): string {
		const pieces = r.comps?.length ? `${r.comps.length} of ${part.components.length} pieces` : '';
		if (r.plateNumber == null) return pieces;
		if (pieces) return `Plate ${r.plateNumber} · ${pieces}`;
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
				{#if gi.source === 'none'}
					{#if ctx.canEdit}
						<button
							class="pill-link wt-add"
							type="button"
							data-testid="add-weight"
							aria-label="Add the weight of {part.name}"
							onclick={openWeight}>Add weight</button
						>
					{:else}<span class="num" data-testid="part-weight">weight n/a</span>{/if}
				{:else}
					<span
						class="num"
						data-testid="part-weight"
						title="All {part.qty && part.qty > 1 ? `${part.qty} copies` : 'copies'}{gi.source ===
						'bom'
							? ', estimate from the MakeGood kit'
							: ''}"
						>{gi.source === 'bom' ? '~' : ''}{fmt(gi.total)} g{gi.source === 'user'
							? ' · your entry'
							: gi.source === 'slice'
								? ' · from your slice'
								: gi.source === 'file'
									? ' · from your slicer'
									: ''}</span
					>
				{/if}
				{#if justNow}<span class="just-now" data-testid="printed-just-now">Printed just now</span
					>{:else if st?.printedOn}<span>printed {st.printedOn}</span>{/if}
			</div>
		</div>
		<div class="settings">
			{#if part.custom}<span class="pset hot" data-testid="part-custom">Custom</span>{/if}
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
				<span class="pset" class:hot={doneComps < part.components.length} data-testid="part-pieces"
					>{doneComps}/{part.components.length} pieces{onPrinter
						? ` · ${onPrinter.length} printing`
						: ''}</span
				>
			{/if}
		</div>
		<div class="pr-actions">
			{#if part.components.length && !plateOffersPieces}
				<PartPiecesAction
					slug={part.slug}
					bind:picking={piecesPicking}
					onwhole={() => pickStatus('Printing')}
				/>
			{/if}
			<StatusBadge
				label={part.name}
				status={st?.status ?? 'To print'}
				options={[...PART_STATUSES]}
				interactive={ctx.canEdit}
				onpick={pickStatus}
				extras={[
					...(part.components.length && !plateOffersPieces && piecesOffered(ctx, part.slug)
						? [
								{
									label: 'Print some pieces…',
									testid: 'part-print-some',
									ariaLabel: `Print some pieces of ${part.name}`,
									run: () => (piecesPicking = true)
								}
							]
						: []),
					...(canSkip
						? [
								{
									label: 'Not printing this part',
									testid: 'part-skip',
									ariaLabel: `Not printing ${part.name}`,
									run: () => void ctx.skipParts([part.slug], part.name)
								}
							]
						: [])
				]}
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
	{#if weightOpen && ctx.canEdit}
		<form class="wedit" onsubmit={saveWeight} use:focusIn>
			<label for="w-{part.slug}"
				>Weight of {part.name}{part.qty && part.qty > 1 ? `, all ${part.qty} copies` : ''} (g)</label
			>
			<input
				id="w-{part.slug}"
				type="text"
				inputmode="decimal"
				autocomplete="off"
				placeholder={gi.source === 'bom' ? `~${fmt(gi.total)}` : 'g'}
				aria-invalid={wInvalid}
				data-testid="weight-input"
				bind:value={wDraft}
			/>
			<button
				class="btn sm primary"
				type="submit"
				disabled={wInvalid || wBusy}
				data-testid="weight-save">Save</button
			>
			{#if typedG}<button class="btn sm" type="button" disabled={wBusy} onclick={clearWeight}
					>Use the estimate</button
				>{/if}
			<button class="btn sm ghost" type="button" onclick={() => (weightOpen = false)}>Cancel</button
			>
			{#if wInvalid}<small class="err" role="alert"
					>Enter the grams as a number up to 20000 (for example 162.5).</small
				>{/if}
		</form>
	{/if}
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
									checked={!!st?.comps[i] || locked.has(i)}
									disabled={!ctx.canEdit || locked.has(i)}
									title={locked.has(i) ? 'Logged in the print log' : undefined}
									aria-describedby={locked.has(i) ? `${uid}-lock-${i}` : undefined}
									onchange={(e) => {
										const on = e.currentTarget.checked;
										ctx.act(() =>
											updatePart(ctx.id, part.slug, { comps: { ...st?.comps, [i]: on } })
										);
									}}
								/>
								<span
									>{c.name}
									<small
										>{c.settings}{c.file ? ` · ${c.file}` : ''}{onPrinter?.includes(i)
											? ' · on the printer'
											: ''}</small
									>{#if locked.has(i)}<span
											class="pr-logged"
											id="{uid}-lock-{i}"
											data-testid="piece-logged">logged</span
										>{/if}</span
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
					<PlateControl {plate} only={plate.perPartRuns ? part.slug : null} pieces={false} />
				{/if}
				{#if ctx.canEdit && !weightOpen && gi.source !== 'none'}
					<h3 style="margin-top:var(--sp-6)">Weight</h3>
					<div class="meta" style="margin-bottom:var(--sp-3)">
						{gi.source === 'user'
							? 'Your entry, all copies.'
							: gi.source === 'slice'
								? 'From your slice.'
								: 'Estimate from the MakeGood kit.'}
					</div>
					<button class="btn sm" type="button" onclick={openWeight}
						>{typedG ? 'Change weight' : 'Enter weight'}</button
					>
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
	.pr-logged {
		display: inline-block;
		margin-inline-start: var(--sp-3);
		padding: 0 var(--sp-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--muted, inherit);
		white-space: nowrap;
	}
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
	/* Weight editor under the row: one line on desktop, wraps on a phone; 44px targets and 16px text on touch. */
	.wedit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3) var(--sp-4);
		padding: 0 var(--sp-6) var(--sp-5);
		font-size: var(--fs-sm);
	}
	.wedit input {
		width: 8rem;
	}
	.wedit .err {
		flex-basis: 100%;
		color: var(--bad);
	}
	@media (pointer: coarse) {
		.wedit input {
			font-size: 16px;
			min-height: 44px;
		}
		.wedit :global(.btn) {
			min-height: 44px;
		}
		.wt-add {
			min-height: 44px;
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
