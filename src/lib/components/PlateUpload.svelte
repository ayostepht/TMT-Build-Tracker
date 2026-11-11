<script lang="ts">
	import {
		applyPlateUpload,
		discardPlateUpload,
		uploadThreeMf,
		uploadThumbnailUrl,
		type UploadResult
	} from '#lib/client/api.ts';
	import { untrack } from 'svelte';
	import AskDialog from './AskDialog.svelte';
	import { createAsk } from '#lib/client/ask.svelte.ts';
	import { objectKey } from '#lib/domain/plates-match.ts';
	import { planPlateParts, type PlatePartsPlan } from '#lib/domain/twins.ts';
	import { inactiveSlugs, resolveChoices } from '#lib/domain/variants.ts';
	import { fmt, fmtH } from '#lib/domain/index.ts';
	import type { BuildView, PartDef } from '#lib/domain/types.ts';

	/**
	 * Upload a slicer 3MF and organize this build's plates from it: pick a file,
	 * wait for the parse, check the suggested object → part mapping, then apply.
	 */
	let {
		view,
		onclose,
		ondone,
		initialFile = null,
		oninitial
	}: {
		view: BuildView;
		onclose: () => void;
		ondone: (msg: string) => void;
		/** A file already chosen elsewhere (the kit drop zone); uploaded right away. */
		initialFile?: File | null;
		/** Called once `initialFile` was taken, so the owner can clear it. */
		oninitial?: () => void;
	} = $props();

	const asking = createAsk();

	type Phase = 'pick' | 'uploading' | 'review' | 'applying';
	let phase = $state<Phase>('pick');
	let fileName = $state('');
	let progress = $state(0);
	let error = $state<string | null>(null);
	let up = $state<UploadResult | null>(null);
	let mapping = $state<Record<string, string | null>>({});
	let filamentMap = $state<Record<string, string | null>>({});
	let accept = $state<Record<string, boolean>>({});
	let drag = $state(false);
	/** What to do with the file: take its plates as sliced, or learn per-part data and keep my plates. */
	let outcome = $state<'plates' | 'template'>('plates');
	let arrangeNow = $state(false);
	/** Object keys the user keeps to the one mapped part instead of all its twins. */
	let single = $state<Record<string, boolean>>({});
	const hasArranged = $derived(view.plates.some((p) => p.source === 'arranged'));
	const defaultOutcome = (sliced: boolean): 'plates' | 'template' =>
		sliced && (hasArranged || view.printer) ? 'template' : 'plates';

	const sections = $derived.by(() => {
		const out: { section: string; parts: PartDef[] }[] = [];
		for (const p of view.allParts) {
			let g = out.find((x) => x.section === p.section);
			if (!g) out.push((g = { section: p.section, parts: [] }));
			g.parts.push(p);
		}
		return out;
	});
	const attachedRuns = $derived(
		outcome === 'template' && !arrangeNow
			? 0
			: view.runs.filter((r) => r.plateNumber != null).length
	);
	const groupName = (k: string) => view.variantGroups.find((g) => g.key === k)?.name ?? k;
	const optionName = (g: string, o: string) =>
		view.variantGroups.find((x) => x.key === g)?.options.find((x) => x.key === o)?.name ?? o;
	const variantChanges = $derived(
		outcome === 'template'
			? []
			: Object.entries(up?.suggestions.variantChoices ?? {}).filter(
					([g, o]) => view.variantChoices[g] !== o
				)
	);
	const measured = $derived(
		up ? up.summary.plates.filter((p) => (p.exact?.length ?? 0) > 0).length : 0
	);

	/** Parts that are active once the accepted option changes are applied (plates mode). */
	const inactiveNow = $derived.by(() => {
		const choices = { ...view.variantChoices };
		if (outcome === 'plates') for (const [g, o] of variantChanges) if (accept[g]) choices[g] = o;
		return inactiveSlugs(view.variantGroups, resolveChoices(view.variantGroups, choices));
	});
	const partName = (slug: string) => view.allParts.find((p) => p.slug === slug)?.name ?? slug;
	const roleLabel = (slug: string) => {
		const r = view.allParts.find((p) => p.slug === slug)?.role ?? '';
		return r ? r.charAt(0).toUpperCase() + r.slice(1) : '';
	};
	/** "3DTMT O WHEEL RIM REV B.STEP" -> "Wheel Rim" */
	const shortName = (n: string) =>
		n
			.replace(/\.(step|stp|stl|3mf|obj)$/i, '')
			.replace(/_/g, ' ')
			.replace(/\brev\.?\s*\w+/gi, ' ')
			.split(/\s+/)
			.filter((w) => w && !/^(3dtmt|tmt3d|mg|kit)$/i.test(w) && !/^[a-z]\d?$/i.test(w))
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
			.join(' ');
	const planFor = (
		pl: { index: number; objects: { id: string }[]; runsHint: number },
		singles: Record<string, boolean>
	): PlatePartsPlan =>
		planPlateParts({
			plateIndex: pl.index,
			objects: pl.objects,
			mapping,
			single: singles,
			groups: up?.suggestions.twinGroups ?? [],
			isActive: (s) => !inactiveNow.has(s),
			runsHint: pl.runsHint
		});
	/** The twin assignment of a plate as shown: parts with their color and runs each. */
	const twinText = (plan: PlatePartsPlan) =>
		plan.parts.map((s) => `${partName(s)} (${roleLabel(s)}) ×${plan.runs}`).join(' and ');
	const objectTotal = $derived(
		up ? up.summary.plates.reduce((a, p) => a + p.objects.length, 0) : 0
	);
	const mappedTotal = $derived(
		up
			? up.summary.plates.reduce(
					(a, p) => a + p.objects.filter((o) => mapping[objectKey(p.index, o.id)]).length,
					0
				)
			: 0
	);

	async function pick(file: File | null | undefined) {
		if (!file) return;
		error = null;
		fileName = file.name;
		progress = 0;
		phase = 'uploading';
		try {
			up = await uploadThreeMf(view.build.id, file, (f) => (progress = f));
			mapping = { ...up.suggestions.mapping };
			filamentMap = { ...up.suggestions.filamentMap };
			outcome = defaultOutcome(up.summary.sliced);
			arrangeNow = false;
			single = {};
			accept = Object.fromEntries(variantChanges.map(([g]) => [g, true]));
			phase = 'review';
		} catch (e) {
			error = e instanceof Error ? e.message : 'The upload failed.';
			phase = 'pick';
		}
	}

	$effect(() => {
		const f = initialFile;
		if (f && untrack(() => phase) === 'pick') {
			oninitial?.();
			untrack(() => void pick(f));
		}
	});

	const badge = (key: string) => {
		const m = up?.suggestions.matches[key];
		if (!mapping[key]) return { cls: 'none', text: 'No match' };
		if (mapping[key] !== m?.slug) return { cls: 'manual', text: 'Your pick' };
		return m.confidence >= 0.8 ? { cls: 'high', text: 'Match' } : { cls: 'check', text: 'Check' };
	};

	async function apply() {
		if (!up) return;
		if (
			attachedRuns > 0 &&
			!(await asking.ask(
				`${attachedRuns} print log${attachedRuns === 1 ? ' is' : 's are'} attached to the current plates. ` +
					'They will be converted to part logs (part statuses stay as they are). Continue?',
				{ title: 'Convert print logs', confirmLabel: 'Convert and continue' }
			))
		)
			return;
		phase = 'applying';
		error = null;
		try {
			const r = await applyPlateUpload(view.build.id, up.uploadId, {
				mapping,
				filamentMap,
				variantChoices: Object.fromEntries(variantChanges.filter(([g]) => accept[g])),
				convertRuns: attachedRuns > 0,
				mode: outcome,
				arrange: outcome === 'template' && arrangeNow,
				single
			});
			const twinNote = r.twinPlates.length
				? ` Shared source objects were split between their parts on plate${r.twinPlates.length === 1 ? '' : 's'} ${r.twinPlates.map((t) => t.plate).join(', ')}.`
				: '';
			const warnNote = r.warnings.length ? ` Check: ${r.warnings.join(' ')}` : '';
			ondone(
				(r.mode === 'template'
					? `Print template learned from ${fileName}: print time and grams for ${r.learned} part${r.learned === 1 ? '' : 's'}${r.arranged ? '; plates re-arranged with it' : '; your plates are unchanged'}.`
					: `Plates organized from ${fileName}: ${r.plates} plate${r.plates === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} without mapped parts skipped` : ''}.`) +
					twinNote +
					warnNote
			);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not apply the plates.';
			phase = 'review';
		}
	}

	async function cancel() {
		if (up && phase === 'review') {
			try {
				await discardPlateUpload(view.build.id, up.uploadId);
			} catch {
				/* the server clears stale uploads on the next one */
			}
		}
		onclose();
	}
</script>

<AskDialog ask={asking} />
<section class="card upload" aria-label="Upload a 3MF">
	<div class="head">
		<h2>Upload my sliced 3MF</h2>
		<button class="btn sm" type="button" onclick={cancel} disabled={phase === 'applying'}
			>Cancel</button
		>
	</div>

	{#if error}<div class="error" role="alert">{error}</div>{/if}

	{#if phase === 'pick' || phase === 'uploading'}
		<p class="muted">
			Choose the 3MF project from Bambu Studio, OrcaSlicer, Elegoo Slicer or similar. Your plates,
			print times and grams per filament are read from it; the file itself is not kept. A file that
			is only saved, not sliced, has plates and objects but no times or grams. Large files (up to 1
			GB, such as a project sliced with G-code for every plate) are fine.
		</p>
		{#if phase === 'pick'}
			<label
				class="drop"
				class:drag
				ondragover={(e) => {
					e.preventDefault();
					drag = true;
				}}
				ondragleave={() => (drag = false)}
				ondrop={(e) => {
					e.preventDefault();
					drag = false;
					pick(e.dataTransfer?.files?.[0]);
				}}
			>
				<input
					type="file"
					accept=".3mf,model/3mf"
					data-testid="3mf-file"
					onchange={(e) => pick(e.currentTarget.files?.[0])}
				/>
				<span>Choose a .3mf file, or drop it here</span>
			</label>
		{:else}
			<div class="progress" role="status">
				<div class="bar"><span style="width:{Math.round(progress * 100)}%"></span></div>
				<span class="meta"
					>{progress < 1
						? `Uploading ${fileName}… ${Math.round(progress * 100)}%`
						: `Reading ${fileName}…`}</span
				>
			</div>
		{/if}
	{:else if up}
		{@const s = up.summary}
		<p class="meta sum">
			<b>{fileName}</b>
			· {s.kind === 'project' ? 'slicer project' : 'plain 3MF (objects only)'}
			{#if s.app}· {s.app}{/if}
			{#if s.printer}· {s.printer}{/if}
			{#if s.nozzle}· {s.nozzle} mm nozzle{/if}
			· {s.sliced ? 'sliced' : 'not sliced'}
		</p>
		{#if !s.sliced}
			<p class="note">
				This file is not sliced, so it carries no print times or grams. Plates, names and objects
				are imported; slice it and upload again (or type the slicer grams on each plate) for
				estimates.
			</p>
		{/if}
		{#each s.warnings as w (w)}<p class="note">{w}</p>{/each}

		<h3>What should this file do?</h3>
		<div class="outcome" role="radiogroup" aria-label="What this file is used for">
			<label class="opt" class:on={outcome === 'plates'}>
				<input
					type="radio"
					name="outcome"
					value="plates"
					bind:group={outcome}
					data-testid="outcome-plates"
				/>
				<span>
					<b>Use these plates</b>
					<span class="meta">Your file's plates become this build's plates, exactly as sliced.</span
					>
				</span>
			</label>
			<label class="opt" class:on={outcome === 'template'} class:off={!s.sliced}>
				<input
					type="radio"
					name="outcome"
					value="template"
					bind:group={outcome}
					disabled={!s.sliced}
					data-testid="outcome-template"
				/>
				<span>
					<b>Use as print template</b>
					<span class="meta"
						>Keep your own plates (or arrange new ones); learn print times, grams, orientations and
						supports from your file for every part.{#if !s.sliced}
							Needs a sliced file.{/if}</span
					>
				</span>
			</label>
		</div>
		{#if outcome === 'template'}
			<p class="meta" data-testid="template-note">
				{measured
					? `Per-object time and grams were measured from the G-code of ${measured} plate${measured === 1 ? '' : 's'}; the others are shared by part volume.`
					: "Each plate's time and grams are shared among its parts by part volume."}
				Orientations and painted supports stay as in the kit; parts are only turned flat on the bed.
			</p>
			{#if view.printer}
				<label class="chk">
					<input type="checkbox" bind:checked={arrangeNow} data-testid="arrange-now" />
					Re-arrange my plates for {view.printer.name} now, using this data
				</label>
			{/if}
		{/if}

		{#if s.filaments.length}
			<h3>Filaments</h3>
			<div class="fil-map">
				{#each s.filaments as f (f.index)}
					<label class="fil">
						<span class="swatch" style="background:{f.color ?? 'transparent'}"></span>
						<span class="fl">#{f.index} {f.type}{f.name ? ` · ${f.name}` : ''}</span>
						<select
							bind:value={filamentMap[String(f.index)]}
							aria-label="Build filament for #{f.index}"
						>
							<option value={null}>Not tracked</option>
							{#each view.filaments as r (r.key)}
								<option value={r.key}>{r.name} ({r.material})</option>
							{/each}
						</select>
					</label>
				{/each}
			</div>
		{/if}

		{#if variantChanges.length}
			<h3>Options this file suggests</h3>
			<div class="variants">
				{#each variantChanges as [g, o] (g)}
					<label class="chk">
						<input type="checkbox" bind:checked={accept[g]} />
						Switch <b>{groupName(g)}</b> to <b>{optionName(g, o)}</b>
						<span class="meta">(now {optionName(g, view.variantChoices[g])})</span>
					</label>
				{/each}
			</div>
		{/if}

		<h3>Plates in the file ({s.plates.length})</h3>
		<p class="meta">
			{mappedTotal} of {objectTotal} objects matched to parts. Objects left on “No match” are ignored;
			plates with no matched part are skipped.
		</p>
		<div class="plates">
			{#each s.plates as pl (pl.index)}
				<article class="rp">
					<div class="rp-head">
						{#if pl.hasThumbnail}
							<img
								src={uploadThumbnailUrl(view.build.id, up.uploadId, pl.index)}
								alt="Plate {pl.index} preview"
								loading="lazy"
								width="72"
								height="72"
							/>
						{/if}
						<div>
							<h4>Plate {pl.index} · {pl.name}</h4>
							<div class="meta">
								{#if pl.runsHint > 1}<b class="warn">Print {pl.runsHint} times</b>{/if}
								{#if pl.estSeconds}~{fmtH(pl.estSeconds)}{/if}
								{#if pl.grams}· {fmt(pl.grams)} g{/if}
							</div>
						</div>
					</div>
					<ul class="objs">
						{#each pl.objects as o (o.id)}
							{@const key = objectKey(pl.index, o.id)}
							{@const b = badge(key)}
							<li class:unmatched={!mapping[key]}>
								<div class="oname" title={up.suggestions.matches[key]?.reason}>
									{o.name}{#if o.count > 1}<b> ×{o.count}</b>{/if}
									<span class="badge {b.cls}">{b.text}</span>
								</div>
								<select bind:value={mapping[key]} aria-label="Part for {o.name}">
									<option value={null}>No match (skip)</option>
									{#each sections as g (g.section)}
										<optgroup label={g.section}>
											{#each g.parts as p (p.slug)}
												<option value={p.slug}>{p.name}{p.variantGroup ? ' (option)' : ''}</option>
											{/each}
										</optgroup>
									{/each}
								</select>
							</li>
						{/each}
					</ul>
					{#if outcome === 'plates'}
						{@const base = planFor(pl, {})}
						{#if base.perPartRuns}
							{@const plan = planFor(pl, single)}
							<div class="twin" data-testid="twin-plan">
								{#each base.expansions as e (e.key)}
									{@const o = pl.objects.find((x) => objectKey(pl.index, x.id) === e.key)}
									<div class="twin-line">
										<b>{shortName(o?.name ?? '')}</b> →
										{#if plan.perPartRuns}
											{twinText(plan)}
										{:else}
											{partName(e.from)} ({roleLabel(e.from)}) only
										{/if}
									</div>
									<label class="chk">
										<input
											type="checkbox"
											checked={single[e.key] === true}
											onchange={(ev) => (single[e.key] = ev.currentTarget.checked)}
											data-testid="twin-single"
										/>
										Use only {partName(e.from)} (these parts share one source object)
									</label>
								{/each}
								{#if plan.warning}<p class="note">{plan.warning}</p>{/if}
							</div>
						{:else if base.warning}
							<p class="note">{base.warning}</p>
						{/if}
					{/if}
				</article>
			{/each}
		</div>

		{#if attachedRuns > 0}
			<p class="note">
				{attachedRuns} print log{attachedRuns === 1 ? ' is' : 's are'} attached to the current plates.
				They are converted to part logs when you apply; part statuses stay as they are.
			</p>
		{/if}
		<div class="actions">
			<button class="btn" type="button" onclick={cancel} disabled={phase === 'applying'}
				>Cancel</button
			>
			<button
				class="btn primary"
				type="button"
				onclick={apply}
				disabled={phase === 'applying' || mappedTotal === 0}
				data-testid="apply-upload"
				>{phase === 'applying'
					? 'Applying…'
					: outcome === 'template'
						? 'Use as print template'
						: 'Use these plates'}</button
			>
		</div>
	{/if}
</section>

<style>
	.upload {
		gap: 14px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	h2,
	h3,
	h4 {
		margin: 0;
	}
	h3 {
		font-size: 15px;
	}
	h4 {
		font-size: 14px;
	}
	.drop {
		display: grid;
		place-items: center;
		padding: 28px 12px;
		border: 2px dashed var(--line);
		border-radius: 10px;
		color: var(--muted);
		cursor: pointer;
		text-align: center;
	}
	.drop.drag {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.progress {
		display: grid;
		gap: 6px;
	}
	.bar {
		height: 8px;
		background: var(--line);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.15s;
	}
	.note {
		margin: 0;
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--warn-soft);
		color: var(--ink);
		font-size: 13px;
	}
	.sum {
		overflow-wrap: anywhere;
	}
	.outcome {
		display: grid;
		gap: 8px;
	}
	.opt {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		align-items: start;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		cursor: pointer;
	}
	.opt.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.opt.off {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.opt > span {
		display: grid;
		gap: 2px;
	}
	.fil-map,
	.variants,
	.plates {
		display: grid;
		gap: 8px;
	}
	.fil {
		display: grid;
		grid-template-columns: 16px 1fr;
		gap: 4px 8px;
		align-items: center;
	}
	.fil select {
		grid-column: 1 / -1;
	}
	.swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--line);
	}
	.chk {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.rp {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 10px;
		display: grid;
		gap: 8px;
		background: var(--paper);
	}
	.rp-head {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.rp-head img {
		border-radius: 6px;
		border: 1px solid var(--line);
		background: #fff;
		object-fit: contain;
		flex: none;
	}
	.warn {
		color: var(--warn);
	}
	.twin {
		display: grid;
		gap: 6px;
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--accent-soft);
		font-size: 13px;
	}
	.twin-line {
		overflow-wrap: anywhere;
	}
	.objs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.objs li {
		display: grid;
		gap: 4px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid transparent;
	}
	.objs li.unmatched {
		background: var(--warn-soft);
		border-color: var(--warn);
	}
	.oname {
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	select {
		width: 100%;
		min-width: 0;
		padding: 7px 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--card);
		color: var(--ink);
		font-size: 14px;
	}
	.badge {
		display: inline-block;
		font-size: 11px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 8px;
		margin-left: 4px;
		vertical-align: 1px;
	}
	.badge.high {
		background: var(--ok-soft);
		color: var(--ok);
	}
	.badge.check,
	.badge.none {
		background: var(--warn-soft);
		color: var(--warn);
	}
	.badge.manual {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		position: sticky;
		bottom: 0;
		padding: 8px 0;
		background: var(--card);
	}
	@media (min-width: 640px) {
		.fil {
			grid-template-columns: 16px 1fr minmax(180px, 1fr);
		}
		.fil select {
			grid-column: auto;
		}
		.objs li {
			grid-template-columns: 1fr minmax(200px, 1fr);
			align-items: center;
		}
	}
</style>
