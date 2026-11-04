<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy } from 'svelte';
	import PlacementEditor from '#lib/components/PlacementEditor.svelte';
	import KitFilesImport from '#lib/components/kit/KitFilesImport.svelte';
	import KitStatus from '#lib/components/kit/KitStatus.svelte';
	import PrintGeometryCard from './PrintGeometryCard.svelte';
	import GuideImportCard from './GuideImportCard.svelte';
	import {
		getModelJob,
		removeHardwareGlb,
		uploadHardwareGlb,
		uploadStepZip,
		type ModelJobInfo
	} from '#lib/client/api.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let job = $state<ModelJobInfo | null>(data.job as ModelJobInfo | null);
	let uploadFrac = $state<number | null>(null);
	let error = $state('');
	let hwBusy = $state(false);
	let kitStatus: KitStatus | undefined = $state();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let zipInput: HTMLInputElement | undefined = $state();
	let hwInput: HTMLInputElement | undefined = $state();

	const active = $derived(job?.status === 'queued' || job?.status === 'running');
	const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

	function poll(id: string) {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			try {
				job = await getModelJob(data.template.id, id);
				if (job.status === 'queued' || job.status === 'running') poll(id);
				else await invalidateAll();
			} catch (e) {
				error = e instanceof Error ? e.message : 'Lost track of the job';
			}
		}, 1200);
	}
	// Resume polling after a page reload while a job is still running.
	$effect(() => {
		const j = data.job;
		if (j && (j.status === 'queued' || j.status === 'running') && !timer) poll(j.id);
	});
	onDestroy(() => clearTimeout(timer));

	async function uploadZip() {
		const file = zipInput?.files?.[0];
		if (!file) return;
		error = '';
		uploadFrac = 0;
		try {
			const id = await uploadStepZip(data.template.id, file, (f) => (uploadFrac = f));
			uploadFrac = null;
			job = await getModelJob(data.template.id, id);
			poll(id);
		} catch (e) {
			uploadFrac = null;
			error = e instanceof Error ? e.message : 'Upload failed';
		}
	}

	async function uploadHw() {
		const file = hwInput?.files?.[0];
		if (!file) return;
		error = '';
		hwBusy = true;
		try {
			await uploadHardwareGlb(data.template.id, file);
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Upload failed';
		} finally {
			hwBusy = false;
		}
	}
	async function removeHw() {
		hwBusy = true;
		try {
			await removeHardwareGlb(data.template.id);
			await invalidateAll();
		} finally {
			hwBusy = false;
		}
	}

	const counts = $derived.by(() => {
		const r = job?.report ?? [];
		const n = (s: string) => r.filter((x) => x.status === s).length;
		return {
			ok: n('ok'),
			missing: n('missing'),
			failed: n('failed'),
			other: n('skipped') + n('unknown')
		};
	});
</script>

<section class="stack">
	<div class="kicker">Site admin</div>
	<p><a href={resolve('/(app)/admin/templates')}>← Kits</a></p>
	<h1>{data.template.name}</h1>

	<!-- Temporary mount: the follow-up moves these into build onboarding and a Print tab. -->
	<div class="card stack">
		<KitStatus bind:this={kitStatus} templateId={data.template.id} />
		<h3>Add MakeGood files</h3>
		<KitFilesImport
			templateId={data.template.id}
			canImport={true}
			onchange={() => {
				kitStatus?.refresh();
				invalidateAll();
			}}
		/>
	</div>

	<div class="card">
		<h2>3D model</h2>
		{#if data.model && data.modelMeta}
			<div class="counts">
				<span class="set">v{data.model.version.slice(0, 8)}</span>
				<span class="set">{mb(data.modelMeta.size)}</span>
				<span class="set">{data.model.slugs.length} parts with geometry</span>
				<span class="set"
					>{data.model.placements.filter((p) => p.placed && data.model!.slugs.includes(p.slug))
						.length} placed, {data.parts.length -
						data.model.placements.filter((p) => p.placed && data.model!.slugs.includes(p.slug))
							.length} not placed</span
				>
				<span class="set">{data.model.hardwareUrl ? 'with hardware' : 'no hardware GLB'}</span>
			</div>
			<p class="muted">{data.modelMeta.sourceNote}</p>
		{:else}
			<p class="muted">
				No 3D model yet. Upload MakeGood's STEP zip below; the files stay on this server.
			</p>
		{/if}

		<label class="field">
			STEP zip (up to 200 MB)
			<input type="file" accept=".zip,application/zip" bind:this={zipInput} disabled={active} />
		</label>
		<div>
			<button
				type="button"
				class="btn primary"
				disabled={active || uploadFrac !== null}
				onclick={uploadZip}>{data.model ? 'Replace the model' : 'Import the model'}</button
			>
		</div>
		{#if uploadFrac !== null}
			<progress max="1" value={uploadFrac}></progress>
			<span class="muted">Uploading {Math.round(uploadFrac * 100)}%</span>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}

		{#if job}
			<div aria-live="polite">
				<strong>Last import:</strong>
				{job.status}{#if active}, {job.progress}%{/if} <span class="muted">{job.message}</span>
				{#if active}<progress max="100" value={job.progress}></progress>{/if}
			</div>
			{#if job.report.length}
				<details>
					<summary
						>{counts.ok} converted, {counts.missing} missing, {counts.failed} failed, {counts.other} skipped</summary
					>
					<table class="rep">
						<thead><tr><th>File</th><th>Part</th><th>Result</th></tr></thead>
						<tbody>
							{#each job.report as r, i (i)}
								<tr class:bad={r.status === 'failed' || r.status === 'missing'}>
									<td>{r.file}</td>
									<td>{r.slugs?.join(', ') ?? r.slug ?? ''}</td>
									<td
										>{r.status}{#if r.triangles}, {r.triangles.toLocaleString()} triangles{/if}{#if r.ms},
											{(r.ms / 1000).toFixed(1)} s{/if}{#if r.error || r.detail}: {r.error ??
												r.detail}{/if}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</details>
			{/if}
		{/if}
	</div>

	<div class="card">
		<h2>Hardware (optional)</h2>
		<p class="muted">
			A neutral grey GLB of the casters, bolts and bearings, built offline from the assembly STEP
			with <code>scripts/step-to-glb.mjs</code> (see the README).
		</p>
		<label class="field">
			Hardware GLB
			<input type="file" accept=".glb,model/gltf-binary" bind:this={hwInput} disabled={hwBusy} />
		</label>
		<div class="pe-row">
			<button type="button" class="btn" disabled={hwBusy} onclick={uploadHw}
				>Upload hardware GLB</button
			>
			{#if data.model?.hardwareUrl}
				<button type="button" class="btn danger" disabled={hwBusy} onclick={removeHw}>Remove</button
				>
			{/if}
		</div>
	</div>

	<div class="card">
		<h2>Placement</h2>
		{#if data.model}
			<p class="muted">
				Pick a part (tap it in the 3D view or in the list) and nudge it into place. Positions are
				millimetres, y up; the model keeps each part in its own STEP frame, so nothing is
				reconverted.
			</p>
			{#key data.model.version + String(data.model.hardwareUrl)}
				<PlacementEditor templateId={data.template.id} model={data.model} parts={data.parts} />
			{/key}
		{:else}
			<p class="muted">Import the model first.</p>
		{/if}
	</div>

	<PrintGeometryCard templateId={data.template.id} />
	<GuideImportCard templateId={data.template.id} />
</section>

<style>
	.rep {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.rep th,
	.rep td {
		text-align: left;
		padding: 3px 6px;
		border-bottom: 1px solid var(--line);
		word-break: break-word;
	}
	.rep tr.bad td {
		color: var(--bad);
	}
	progress {
		width: 100%;
	}
	.pe-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
</style>
