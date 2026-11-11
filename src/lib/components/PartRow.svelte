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

	let {
		part,
		focus = false,
		justNow = false
	}: {
		part: PartDef;
		focus?: boolean;
		/** Became Printed during this visit while Printed parts are hidden. */ justNow?: boolean;
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
			{#if plate}<span class="set plate" title="Plate in the print profile"
					>Plate {plate.number}</span
				>{/if}
			{#if part.qty}<span class="set">×{part.qty}</span>{/if}
			{#if part.walls != null}<span class="set">{part.walls} walls</span>{/if}
			{#if part.infill}<span class="set">{part.infill}</span>{/if}
			{#if part.supports}<span class="set"
					>{part.supports === 'Yes' ? 'supports' : 'no supports'}</span
				>{/if}
			{#if part.brim}<span class="set hot">{part.brim} brim</span>{/if}
			{#if part.components.length}
				<span class="set" class:hot={doneComps < part.components.length}
					>{doneComps}/{part.components.length} pieces</span
				>
			{/if}
		</div>
		<div class="seg part-seg" role="group" aria-label="Status for {part.name}">
			{#each PART_STATUSES as s (s)}
				<button
					type="button"
					data-v={s}
					aria-pressed={st?.status === s}
					disabled={!ctx.canEdit}
					onclick={() => st?.status !== s && ctx.setPartStatus(part.slug, s)}>{s}</button
				>
			{/each}
		</div>
		<button
			class="more"
			type="button"
			aria-expanded={open}
			aria-label="Details for {part.name}"
			onclick={() => (open = !open)}>{open ? '−' : '+'}</button
		>
	</div>
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
								class="chip"
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
	/* The current status is not shown by colour alone: an underline in the text colour marks it. */
	.part-seg button[aria-pressed='true'] {
		box-shadow: inset 0 -2px 0 currentColor;
	}
	.just-now {
		font-weight: 600;
		color: var(--ink);
	}
	.just-now-row .row-main {
		opacity: 0.7;
	}
</style>
