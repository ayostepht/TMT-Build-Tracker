<script lang="ts">
	import { RUN_RESULTS, type RunResult } from '#lib/domain/types.ts';
	import {
		fmt,
		fmtH,
		fmtDur,
		fmtHM,
		parseDur,
		toLocalInput,
		today,
		type nowPrinting
	} from '#lib/domain/index.ts';
	import { printing, logRun, updatePlate } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import RoleChip from './RoleChip.svelte';

	type Item = ReturnType<typeof nowPrinting>[number];
	let { item }: { item: Item } = $props();

	const ctx = getBuildCtx();
	const slugs = $derived(item.parts.map((p) => p.slug));
	const plate = $derived(ctx.view.plates.find((p) => p.number === item.plate));
	const fid = $derived(`now-${item.plate}`);

	// Finish-form state lives here, so refreshes (which keep this component alive via the keyed
	// each in NowPrinting) never wipe what someone is typing.
	let fin = $state('');
	let hours = $state('');
	let hoursManual = $state(false);
	let grams = $state('');
	let gramsManual = $state(false);
	let result = $state<RunResult>('Success');
	let note = $state('');
	let runPart = $state('');
	let busy = $state(false);

	const slicerShown = $derived(item.slicerGrams);
	const bomRun = $derived(
		item.parts.reduce((a, p) => a + (p.bomGrams ?? 0) / Math.max(1, plate?.runs ?? 1), 0)
	);
	const elapsedMs = $derived(item.startedAt ? ctx.now - Date.parse(item.startedAt) : 0);
	const estMs = $derived((item.estSeconds ?? 0) * 1000);
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
	const hoursPlaceholder = $derived(
		item.startedAt ? `Hours (${(elapsedMs / 3600000).toFixed(1)} so far)` : 'Hours'
	);

	function hoursFrom(finVal: string): string {
		if (!item.startedAt || !finVal) return '';
		const h =
			(Math.min(new Date(finVal).getTime(), Date.now()) - Date.parse(item.startedAt)) / 3600000;
		return h > 0 ? h.toFixed(1) : '';
	}
	function setFin(v: string) {
		fin = v;
		if (!hoursManual) hours = hoursFrom(v);
	}

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

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!ctx.canEdit || busy || !plate) return;
		busy = true;
		const finAt = fin ? new Date(Math.min(new Date(fin).getTime(), Date.now())) : new Date();
		const h = hours !== '' ? hours : hoursFrom(toLocalInput(finAt));
		const g = grams !== '' ? grams : slicerShown != null ? String(slicerShown) : '';
		const picked = plate.perPartRuns ? runPart || slugs[0] : null;
		const subset = !picked && slugs.length < plate.parts.length ? slugs : null;
		const ok = await ctx.act(() =>
			logRun(ctx.id, {
				plateNumber: plate.number,
				partSlug: picked,
				partSlugs: subset,
				date: toLocalInput(finAt).slice(0, 10) || today(),
				result,
				grams: g === '' ? null : Number(g),
				hours: h === '' ? null : Number(h),
				printer: null,
				note: note.trim()
			})
		);
		busy = false;
		if (ok) {
			fin = hours = grams = note = '';
			hoursManual = gramsManual = false;
			result = 'Success';
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
			<button class="linkbtn" type="button" onclick={() => setStart(toLocalInput(new Date()))}
				>Started just now</button
			>
		{/if}
	</div>

	<div class="now-timer">
		{#if item.startedAt}
			<span class="now-elapsed">{fmtDur(elapsedMs)}</span> elapsed ·
			{#if estMs}
				{#if leftMs > 0}~{fmtDur(leftMs)} left, done around {etaTxt}{:else}past the ~{fmtH(
						estMs / 1000
					)} estimate{/if}
			{/if}
		{:else}
			Estimate {item.estSource === 'slicer' ? 'from your slicer' : "from the template's profile"}: ~{fmtH(
				estMs / 1000
			)}. Set the start time to see a countdown.
		{/if}
	</div>

	{#if ctx.canEdit}
		<form class="logform now-form" onsubmit={submit}>
			<div class="now-step-title span2">2 · Finished</div>
			<label class="span2 now-fin" for="{fid}-fin"
				>Finished at
				<input
					type="datetime-local"
					id="{fid}-fin"
					value={fin}
					onchange={(e) => setFin(e.currentTarget.value)}
				/>
				<button class="btn" type="button" onclick={() => setFin(toLocalInput(new Date()))}
					>Now</button
				>
			</label>
			<label class="now-lab" for="{fid}-g"
				>{slicerShown != null ? 'Actual grams (from slicer, edit if different)' : 'Actual grams'}
				<input
					type="number"
					id="{fid}-g"
					min="0"
					step="1"
					placeholder="g"
					value={gramsManual ? grams : grams !== '' ? grams : (slicerShown ?? '')}
					oninput={(e) => {
						grams = e.currentTarget.value;
						gramsManual = true;
					}}
				/>
			</label>
			<label class="now-lab" for="{fid}-h"
				>Hours (fills from start to finish)
				<input
					type="number"
					id="{fid}-h"
					min="0"
					step="0.1"
					placeholder={hoursPlaceholder}
					value={hours}
					oninput={(e) => {
						hours = e.currentTarget.value;
						hoursManual = !!hours;
					}}
				/>
			</label>
			<select bind:value={result} aria-label="Result">
				{#each RUN_RESULTS as r (r)}<option>{r}</option>{/each}
			</select>
			{#if plate?.perPartRuns && item.parts.length > 1}
				<select bind:value={runPart} aria-label="Which color this run was">
					{#each item.parts as p (p.slug)}
						<option value={p.slug}>{p.name} ({filLabel(ctx.filament(p.role), p.role)})</option>
					{/each}
				</select>
			{/if}
			<div class="wide">
				<input
					type="text"
					id="{fid}-n"
					placeholder="Note (warping, stringing, fit…)"
					aria-label="Note"
					bind:value={note}
				/>
				<button class="btn primary" type="submit" disabled={busy}>Log print</button>
			</div>
		</form>
	{/if}
	<div class="now-foot">
		<span
			>A success marks these printed{item.run ? ' once all runs are in' : ''}; a failure flags them
			for reprint.</span
		>
		{#if ctx.canEdit}
			<button
				class="btn"
				type="button"
				onclick={() => ctx.act(() => printing(ctx.id, { action: 'stop', slugs }))}
				>Take off printer</button
			>
		{/if}
	</div>
</article>
