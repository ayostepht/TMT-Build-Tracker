<script lang="ts">
	import {
		getModelJob,
		uploadGuidePage,
		uploadPrintGeometry,
		uploadStepZip,
		type ModelJobInfo
	} from '#lib/client/api.ts';
	import { pdfPageCount, renderPdfPages } from '#lib/client/guide-import.ts';
	import {
		BIG_FILE,
		findGuidePdf,
		findGuidePdfInBlob,
		itemBytes,
		mergeStepSources,
		probeBlob,
		probeBytes
	} from '#lib/client/kit-probe.ts';
	import {
		buildPlan,
		guidePdfEntries,
		makeSteps,
		slicedItems,
		type Plan,
		type PlanItem,
		type Probe,
		type Step
	} from '#lib/domain/kit-import.ts';
	import GuideMapper from './GuideMapper.svelte';

	/**
	 * One place to add the MakeGood files: STEP zip(s) or loose STEP files, 3MF profiles, a zip of
	 * 3MFs, the guide PDF (or the 3MF holding it) in any mix. Each file is
	 * sniffed in the browser, the plan shows what it will feed, and one run does the lot.
	 * Imports are install-wide, so only site admins get the drop zone (`canImport`).
	 *
	 * A sliced project (G-code / sliced plates) is not kit geometry: it is offered to the build's
	 * own plates through `onSlicedFile` (the caller has a build); without that callback the card
	 * says where to upload it. Big files are opened through their central directory, never read whole.
	 */
	let {
		templateId,
		canImport,
		compact = false,
		onchange,
		onSlicedFile
	}: {
		templateId: string;
		canImport: boolean;
		compact?: boolean;
		/** Called after each step finished (refresh the checklist). */
		onchange?: () => void;
		/** Hands a sliced project to this build's sliced-file (plates) upload. */
		onSlicedFile?: (file: File) => void;
	} = $props();

	interface Dropped {
		id: number;
		file: File;
		probe: Probe | null;
		error?: string;
	}
	type RunStatus = 'pending' | 'running' | 'done' | 'error';
	interface RunStep extends Step {
		status: RunStatus;
		msg: string;
		frac: number | null;
		error: string;
		ms: number;
	}

	let dropped = $state<Dropped[]>([]);
	let overrides = $state<Record<string, boolean>>({});
	let nextId = 1;
	let input: HTMLInputElement | undefined = $state();
	let over = $state(false);
	let phase = $state<'plan' | 'running' | 'done'>('plan');
	let run = $state<RunStep[]>([]);
	let elapsedMs = $state(0);
	let cancelled = false;
	let mapper: GuideMapper | undefined = $state();
	let mapOpen = $state(false);
	let mapAvailable = $state(false);

	const probing = $derived(dropped.some((d) => !d.probe && !d.error));
	const plan = $derived.by<Plan>(() => {
		const p = buildPlan(
			dropped.filter((d) => d.probe).map((d) => ({ fileId: d.id, probe: d.probe! }))
		);
		for (const it of p.items)
			for (const f of it.feeds) {
				const o = overrides[`${it.id}|${f.kind}`];
				if (o !== undefined) f.enabled = o;
			}
		return p;
	});
	const steps = $derived(makeSteps(plan));
	const mb = (n: number) =>
		n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
	const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

	async function addFiles(list: FileList | File[] | null) {
		if (!list || phase === 'running') return;
		if (phase === 'done') reset();
		const added: Dropped[] = [...list].map((file) => ({ id: nextId++, file, probe: null }));
		dropped.push(...added);
		for (const d of added) {
			const entry = dropped.find((x) => x.id === d.id)!;
			try {
				if (d.file.size > BIG_FILE) {
					const probe = await probeBlob(d.file);
					await countPagesBlob(probe, d.file);
					entry.probe = probe;
				} else {
					const bytes = new Uint8Array(await d.file.arrayBuffer());
					const probe = probeBytes(d.file.name, bytes);
					await countPages(probe, bytes);
					entry.probe = probe;
				}
			} catch (e) {
				entry.error = e instanceof Error ? e.message : 'Could not read this file';
			}
		}
		if (input) input.value = '';
	}

	/** Fill in PDF page counts (a PDF, or the guide PDF inside a 3MF / a zip's 3MFs). */
	async function countPages(p: Probe, bytes: Uint8Array) {
		if (p.kind === 'pdf') p.pdfPages = await pdfPageCount(bytes);
		else if (p.kind === '3mf' && guidePdfEntries(p.entries ?? []).length) {
			const g = findGuidePdf(bytes);
			if (g) p.pdfPages = await pdfPageCount(g.bytes);
		} else if (p.kind === 'zip') {
			const g = findGuidePdf(bytes);
			if (g) {
				const n = await pdfPageCount(g.bytes);
				p.pdfPages = n;
				for (const c of p.children ?? [])
					if (guidePdfEntries(c.entries ?? []).length) c.pdfPages = n;
			}
		}
	}

	/** Same for a file too big to read whole: only the guide PDF's entry is read. */
	async function countPagesBlob(p: Probe, file: File) {
		if ((p.kind === '3mf' && guidePdfEntries(p.entries ?? []).length) || p.kind === 'zip') {
			const g = await findGuidePdfInBlob(file);
			if (g) p.pdfPages = await pdfPageCount(g.bytes);
		}
	}

	function removeFile(fileId: number) {
		dropped = dropped.filter((d) => d.id !== fileId);
	}
	function toggle(it: PlanItem, kind: string, on: boolean) {
		overrides[`${it.id}|${kind}`] = on;
		// A sliced project goes to the build's plates or to the kit, not both.
		if (kind === 'print' && on && it.feeds.some((f) => f.kind === 'sliced'))
			overrides[`${it.id}|sliced`] = false;
	}
	function useSliced(it: PlanItem) {
		onSlicedFile?.(fileOf(it));
		removeFile(it.fileId);
	}
	function reset() {
		dropped = [];
		overrides = {};
		run = [];
		phase = 'plan';
		mapOpen = false;
	}

	// ---- running -----------------------------------------------------------------

	const itemById = (id: string) => plan.items.find((i) => i.id === id)!;
	const fileOf = (it: PlanItem) => dropped.find((d) => d.id === it.fileId)!.file;
	const asFile = async (it: PlanItem) =>
		it.entryPath.length
			? new File([(await itemBytes(fileOf(it), it)) as BlobPart], it.probe.name)
			: fileOf(it);
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	async function runModel(s: RunStep) {
		const items = s.itemIds.map(itemById);
		let file: File;
		if (items.length === 1 && items[0].probe.kind === 'zip') file = await asFile(items[0]);
		else {
			s.msg = 'Bundling the STEP files';
			const sources = [];
			for (const it of items)
				sources.push({
					name: it.probe.name,
					bytes: await itemBytes(fileOf(it), it),
					loose: it.probe.kind === 'step'
				});
			const merged = mergeStepSources(sources);
			file = new File(
				[merged.zip as BlobPart],
				items.length === 1
					? `${items[0].probe.name}.zip`
					: `${items[0].probe.name.replace(/\.(zip|step|stp)$/i, '')} and ${items.length - 1} more.zip`
			);
		}
		s.msg = 'Uploading';
		const id = await uploadStepZip(templateId, file, (f) => (s.frac = f));
		s.frac = null;
		let job: ModelJobInfo;
		for (;;) {
			job = await getModelJob(templateId, id);
			s.msg = `Converting, ${job.progress}% ${job.message}`.trim();
			s.frac = job.progress / 100;
			if (job.status === 'done' || job.status === 'failed') break;
			await sleep(1200);
		}
		s.frac = null;
		if (job.status === 'failed') throw new Error(job.message || 'The 3D conversion failed');
		const ok = job.report.filter((r) => r.status === 'ok').length;
		const bad = job.report.filter((r) => r.status === 'failed' || r.status === 'missing').length;
		s.msg = `${ok} STEP files converted${bad ? `, ${bad} missing or failed (see the report)` : ''}`;
	}

	async function runPrint(s: RunStep) {
		const it = itemById(s.itemIds[0]);
		const file = await asFile(it);
		s.msg = 'Uploading';
		const r = await uploadPrintGeometry(templateId, file, (f) => {
			s.frac = f;
			s.msg = f < 1 ? `Uploading ${Math.round(f * 100)}%` : 'Reading the file, a few seconds…';
		});
		s.frac = null;
		const warn = r.report.flatMap((x) => x.warnings);
		s.msg = `Imported geometry for ${r.imported} part${r.imported === 1 ? '' : 's'}${warn.length ? `. ${warn[0]}` : ''}`;
	}

	async function runGuide(s: RunStep) {
		const it = itemById(s.itemIds[0]);
		const g = findGuidePdf(await itemBytes(fileOf(it), it));
		if (!g) throw new Error('No PDF found in that file (looked under Auxiliaries/)');
		cancelled = false;
		const n = await renderPdfPages(
			g.bytes,
			async ({ page, total, blob }) => {
				s.msg = `Rendering and uploading page ${page} of ${total}`;
				s.frac = page / total;
				await uploadGuidePage(templateId, page, blob);
			},
			{ isCancelled: () => cancelled }
		);
		s.frac = null;
		mapOpen = true;
		await mapper?.refresh();
		s.msg = `${cancelled ? 'Stopped. ' : ''}${n} pages imported. Check the page mapping below and save it.`;
	}

	async function execute(s: RunStep) {
		s.status = 'running';
		s.error = '';
		s.msg = '';
		s.frac = null;
		const t0 = performance.now();
		try {
			if (s.kind === 'model') await runModel(s);
			else if (s.kind === 'print') await runPrint(s);
			else await runGuide(s);
			s.status = 'done';
		} catch (e) {
			s.status = 'error';
			s.error = e instanceof Error ? e.message : 'The import failed';
			s.frac = null;
		}
		s.ms = performance.now() - t0;
		onchange?.();
	}

	async function start() {
		if (!steps.length) return;
		run = steps.map((s) => ({ ...s, status: 'pending', msg: '', frac: null, error: '', ms: 0 }));
		phase = 'running';
		const t0 = performance.now();
		for (const s of run) await execute(s);
		elapsedMs = performance.now() - t0;
		phase = 'done';
	}

	async function retry(s: RunStep) {
		phase = 'running';
		const t0 = performance.now();
		await execute(s);
		elapsedMs += performance.now() - t0;
		phase = 'done';
	}

	const statusText: Record<RunStatus, string> = {
		pending: 'Waiting',
		running: 'Working',
		done: 'Done',
		error: 'Failed'
	};
	const failed = $derived(run.filter((s) => s.status === 'error').length);
</script>

{#if !canImport}
	<p class="muted" data-testid="kit-ask-admin">
		Ask your admin to add the MakeGood files. They are added once for the whole install.
	</p>
{:else}
	<div class="kfi" class:compact data-testid="kit-import">
		{#if phase === 'plan'}
			<div
				class="drop"
				class:over
				role="group"
				aria-label="Drop MakeGood files here"
				data-testid="kit-drop"
				ondragover={(e) => {
					e.preventDefault();
					over = true;
				}}
				ondragleave={() => (over = false)}
				ondrop={(e) => {
					e.preventDefault();
					over = false;
					addFiles(e.dataTransfer?.files ?? null);
				}}
			>
				<strong>Drop the MakeGood files here</strong>
				<span class="muted"
					>Any mix: the STEP zip or loose .step files, 3MF profiles, a zip of 3MFs, the guide PDF
					(or the 3MF it came in). Nothing leaves your network.</span
				>
				<button type="button" class="btn primary" onclick={() => input?.click()}
					>Choose files</button
				>
				<input
					bind:this={input}
					type="file"
					multiple
					hidden
					accept=".zip,.step,.stp,.3mf,.pdf"
					data-testid="kit-file-input"
					aria-label="MakeGood files"
					onchange={(e) => addFiles(e.currentTarget.files)}
				/>
			</div>

			{#if probing}<p class="muted" role="status">Looking inside the files…</p>{/if}

			{#if dropped.length}
				<div data-testid="kit-plan" aria-label="Import plan">
					<h3>What will happen</h3>
					<ul class="plan">
						{#each dropped as d (d.id)}
							{@const items = plan.items.filter((i) => i.fileId === d.id)}
							<li>
								<div class="fhead">
									<strong>{d.file.name}</strong>
									<span class="muted">{mb(d.file.size)}</span>
									<button
										type="button"
										class="btn tiny"
										aria-label="Remove {d.file.name}"
										onclick={() => removeFile(d.id)}>Remove</button
									>
								</div>
								{#if d.error}
									<div class="warn">{d.error}</div>
								{:else if !d.probe}
									<div class="muted">Reading…</div>
								{/if}
								{#each items as it (it.id)}
									{#if it.entryPath.length}<div class="muted sub">Inside: {it.name}</div>{/if}
									{#each it.feeds as f (f.kind)}
										{#if f.kind === 'sliced'}
											<div class="sliced" data-testid="kit-sliced">
												<label class="feed" class:off={!f.enabled}>
													<input
														type="checkbox"
														checked={f.enabled}
														onchange={(e) => toggle(it, f.kind, e.currentTarget.checked)}
													/>
													<span><strong>{f.label}</strong></span>
												</label>
												{#if f.enabled}
													{#if onSlicedFile}
														<p class="muted sub">
															It carries print times and grams for the plates, so it is not kit
															geometry.
														</p>
														<button
															type="button"
															class="btn primary"
															data-testid="kit-use-sliced"
															onclick={() => useSliced(it)}>Use it for this build's plates</button
														>
													{:else}
														<p class="muted sub" data-testid="kit-sliced-where">
															Upload it on a build: Files tab, Printer and plates, "Use my own
															sliced file". It is not imported here.
														</p>
													{/if}
												{/if}
											</div>
										{:else}
											<label class="feed" class:off={!f.enabled}>
												<input
													type="checkbox"
													checked={f.enabled}
													onchange={(e) => toggle(it, f.kind, e.currentTarget.checked)}
												/>
												<span>{f.label}</span>
											</label>
											{#if f.note}<div class="muted sub">{f.note}</div>{/if}
										{/if}
									{/each}
									{#if it.status === 'unknown'}
										<div class="warn" data-testid="kit-unknown">
											{it.note}. It will be skipped; remove it or leave it out.
										</div>
									{:else if it.note}
										<div class="muted sub">{it.note}</div>
									{/if}
								{/each}
							</li>
						{/each}
					</ul>
					{#each plan.warnings as w (w)}<p class="warn">{w}</p>{/each}
					{#if steps.length}
						<ol class="order" aria-label="Order of the import">
							{#each steps as s (s.id)}<li>{s.title}</li>{/each}
						</ol>
					{/if}
					<div class="kfi-actions">
						<button
							type="button"
							class="btn primary"
							data-testid="kit-start"
							disabled={!steps.length || probing}
							onclick={start}>Import {steps.length} step{steps.length === 1 ? '' : 's'}</button
						>
						{#if slicedItems(plan).length && !steps.length}
							<span class="muted sub0">Nothing to import: sliced files go to a build's plates.</span
							>
						{/if}
						<button type="button" class="btn" onclick={reset}>Clear</button>
					</div>
				</div>
			{/if}
		{:else}
			<div data-testid="kit-progress" aria-live="polite">
				<h3>
					{phase === 'running'
						? 'Importing…'
						: failed
							? `Finished with ${failed} problem${failed === 1 ? '' : 's'}`
							: 'Done'}
					{#if phase === 'done'}<span class="muted"> in {secs(elapsedMs)}</span>{/if}
				</h3>
				<ol class="run">
					{#each run as s (s.id)}
						<li class={s.status} data-testid="kit-step-{s.kind}" data-status={s.status}>
							<div class="fhead">
								<span class="st">{statusText[s.status]}</span>
								<strong>{s.title}</strong>
								{#if s.ms && s.status !== 'running'}<span class="muted">{secs(s.ms)}</span>{/if}
								{#if s.status === 'running' && s.kind === 'guide'}
									<button type="button" class="btn tiny" onclick={() => (cancelled = true)}
										>Stop</button
									>
								{/if}
								{#if s.status === 'error' && phase === 'done'}
									<button type="button" class="btn tiny" onclick={() => retry(s)}>Retry</button>
								{/if}
							</div>
							{#if s.msg}<div class="muted">{s.msg}</div>{/if}
							{#if s.frac !== null && s.status === 'running'}
								<progress max="1" value={s.frac}></progress>
							{/if}
							{#if s.error}<div class="error" role="alert">{s.error}</div>{/if}
						</li>
					{/each}
				</ol>
				{#if phase === 'done'}
					<div class="kfi-actions">
						<button type="button" class="btn" onclick={reset}>Add more files</button>
					</div>
				{/if}
			</div>
		{/if}

		<details bind:open={mapOpen} class="map" hidden={!mapAvailable} data-testid="kit-guide-mapping">
			<summary>Guide page mapping</summary>
			<GuideMapper
				bind:this={mapper}
				onavailable={(has) => (mapAvailable = has)}
				{templateId}
				{onchange}
			/>
		</details>
	</div>
{/if}

<style>
	.kfi {
		display: grid;
		gap: 12px;
	}
	h3 {
		margin: 0;
	}
	.drop {
		display: grid;
		gap: 8px;
		justify-items: start;
		padding: 16px;
		border: 2px dashed var(--line);
		border-radius: var(--r-lg);
		background: var(--paper);
	}
	.drop.over {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.compact .drop {
		padding: 12px;
	}
	ul.plan,
	ol.run,
	ol.order {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 8px;
	}
	ol.order {
		list-style: decimal inside;
		gap: 2px;
		font-size: var(--fs-sm);
		color: var(--muted);
		margin: 8px 0;
	}
	ul.plan > li,
	ol.run > li {
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: 8px 10px;
		display: grid;
		gap: 4px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.fhead {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.feed {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: var(--fs-md);
	}
	.feed.off span {
		text-decoration: line-through;
		color: var(--muted);
	}
	.sub {
		font-size: var(--fs-xs);
		padding-left: 26px;
	}
	.sliced {
		display: grid;
		gap: 6px;
		justify-items: start;
		padding: 8px;
		border-radius: var(--r-lg);
		background: var(--accent-soft);
	}
	.sliced p {
		margin: 0;
	}
	.sub0 {
		font-size: var(--fs-sm);
		align-self: center;
	}
	.warn {
		color: var(--warn);
		font-size: var(--fs-sm);
	}
	/* Keeps the card look the leaked global .row gave these action rows. */
	.kfi-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 8px;
		background: var(--card);
		border: 1px solid var(--line);
		border-left: 5px solid var(--line);
		border-radius: var(--r-lg);
	}
	.btn.tiny {
		padding: 2px 8px;
		font-size: var(--fs-xs);
		margin-left: auto;
	}
	.st {
		font-size: var(--fs-xs);
		padding: 1px 8px;
		border-radius: var(--r-lg);
		background: var(--accent-soft);
	}
	li.done .st {
		background: var(--ok-soft);
		color: var(--ok);
	}
	li.error .st {
		color: var(--bad);
	}
	li.error {
		border-color: var(--bad);
	}
	progress {
		width: 100%;
	}
	.map summary {
		cursor: pointer;
		font-weight: 600;
	}
</style>
