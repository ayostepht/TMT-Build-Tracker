<script lang="ts">
	import ChairViewer from './ChairViewer.svelte';
	import {
		compose,
		decompose,
		IDENTITY,
		isMirrored,
		ringInstances,
		setMirrorX,
		tidy,
		type Mat,
		type Vec3
	} from '#lib/client/three/matrix.ts';
	import { savePlacement } from '#lib/client/api.ts';
	import type { PartPlacement, TemplateModelInfo } from '#lib/domain/types.ts';

	let {
		templateId,
		model,
		parts
	}: {
		templateId: string;
		model: TemplateModelInfo;
		parts: { slug: string; name: string; section: string }[];
	} = $props();

	const clone = (p: PartPlacement): PartPlacement => ({
		slug: p.slug,
		matrix: [...p.matrix],
		instances: p.instances.map((m) => [...m]),
		placed: p.placed
	});
	const fresh = (slug: string): PartPlacement => ({
		slug,
		matrix: [...IDENTITY],
		instances: [],
		placed: false
	});

	// svelte-ignore state_referenced_locally
	const start = Object.fromEntries(
		parts.map((p) => [
			p.slug,
			clone(model.placements.find((x) => x.slug === p.slug) ?? fresh(p.slug))
		])
	);
	let edit = $state<Record<string, PartPlacement>>(start);
	let saved = $state<Record<string, string>>(
		Object.fromEntries(Object.entries(start).map(([k, v]) => [k, JSON.stringify(v)]))
	);
	let selected = $state<string | null>(null);
	let target = $state(0); // 0 = main matrix, n = instances[n-1]
	let filter = $state<'all' | 'placed' | 'unplaced'>('all');
	let posStep = $state(1);
	let rotStep = $state(1);
	let busy = $state(false);
	let message = $state('');
	let ring = $state({ count: 16, axis: 'x' as 'x' | 'y' | 'z', cx: 208.3, cy: 145, cz: -300 });
	let info = $state<{ rendered: string[]; unplaced: string[] }>({ rendered: [], unplaced: [] });

	const inGlb = $derived(new Set(model.slugs));
	const listed = $derived(
		parts.filter((p) => {
			const placed = edit[p.slug]?.placed && inGlb.has(p.slug);
			return filter === 'all' || (filter === 'placed' ? placed : !placed);
		})
	);
	const current = $derived(selected ? edit[selected] : null);
	const matrix = $derived<Mat | null>(
		current
			? target === 0
				? current.matrix
				: (current.instances[target - 1] ?? current.matrix)
			: null
	);
	const trs = $derived(matrix ? decompose(matrix) : null);
	const dirty = $derived(selected !== null && JSON.stringify(edit[selected]) !== saved[selected]);
	const dirtyCount = $derived(
		Object.keys(edit).filter((s) => JSON.stringify(edit[s]) !== saved[s]).length
	);
	const placementList = $derived(Object.values(edit));

	function select(slug: string | null) {
		selected = slug;
		target = 0;
		message = '';
	}

	function writeMatrix(m: Mat) {
		if (!current) return;
		const t = tidy(m);
		if (target === 0) current.matrix = t;
		else current.instances[target - 1] = t;
	}

	function setPart(group: 'pos' | 'rot', axis: 0 | 1 | 2, value: number) {
		if (!trs || !Number.isFinite(value)) return;
		const next = {
			pos: [...trs.pos] as Vec3,
			rot: [...trs.rot] as Vec3,
			scale: [...trs.scale] as Vec3
		};
		next[group][axis] = value;
		writeMatrix(compose(next));
	}
	function bump(group: 'pos' | 'rot', axis: 0 | 1 | 2, sign: 1 | -1) {
		if (!trs) return;
		setPart(group, axis, trs[group][axis] + sign * (group === 'pos' ? posStep : rotStep));
	}
	function mirror(on: boolean) {
		if (matrix) writeMatrix(setMirrorX(matrix, on));
	}
	function addInstance() {
		if (!current || !matrix || current.instances.length >= 64) return;
		current.instances.push(tidy(matrix));
		target = current.instances.length;
	}
	function removeInstance() {
		if (!current || target === 0) return;
		current.instances.splice(target - 1, 1);
		target = Math.min(target, current.instances.length);
	}
	function makeRing() {
		if (!current) return;
		const n = Math.max(2, Math.min(65, Math.round(ring.count)));
		current.instances = ringInstances(
			current.matrix,
			n,
			[ring.cx, ring.cy, ring.cz],
			ring.axis
		).map(tidy);
		target = 0;
	}
	function revert() {
		if (!selected) return;
		edit[selected] = clone(JSON.parse(saved[selected]));
		target = 0;
	}
	async function save() {
		if (!selected || !current) return;
		busy = true;
		message = '';
		const slug = selected;
		try {
			const p = await savePlacement(templateId, slug, {
				matrix: current.matrix,
				instances: current.instances,
				placed: current.placed
			});
			saved[slug] = JSON.stringify(clone(p));
			message = 'Saved';
		} catch (e) {
			message = e instanceof Error ? e.message : 'Could not save';
		} finally {
			busy = false;
		}
	}
	const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
</script>

<div class="pe">
	<div class="pe-view">
		<ChairViewer
			{model}
			colors={{}}
			placements={placementList}
			{selected}
			dimOthers={selected !== null}
			onpick={(s) => select(s && edit[s] ? s : null)}
			onready={(i) => (info = i)}
		/>
	</div>
	<div class="pe-side">
		<div class="pe-filter" role="group" aria-label="Filter parts">
			{#each ['all', 'placed', 'unplaced'] as f (f)}
				<button
					type="button"
					class="btn sm"
					class:primary={filter === f}
					onclick={() => (filter = f as typeof filter)}>{f}</button
				>
			{/each}
			<span class="muted">{info.rendered.length} shown, {info.unplaced.length} not placed</span>
		</div>
		<ul class="pe-list">
			{#each listed as p (p.slug)}
				{@const e = edit[p.slug]}
				<li>
					<button
						type="button"
						class="pe-part"
						class:on={selected === p.slug}
						onclick={() => select(selected === p.slug ? null : p.slug)}
					>
						<span>{p.name}</span>
						<span class="muted">
							{#if !inGlb.has(p.slug)}no geometry{:else if e.placed}placed{:else}not placed{/if}
							{#if JSON.stringify(e) !== saved[p.slug]}
								(unsaved){/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>

	{#if current && trs && selected}
		<div class="card pe-edit">
			<h3>
				{parts.find((p) => p.slug === selected)?.name} <small class="muted">{selected}</small>
			</h3>
			{#if !inGlb.has(selected)}
				<p class="muted">
					This part has no geometry in the model (its STEP file was not in the zip).
				</p>
			{/if}
			<div class="pe-row">
				<label class="check"
					><input type="checkbox" bind:checked={current.placed} /> Mark placed</label
				>
				<label class="field inline">
					Position step
					<select bind:value={posStep}
						><option value={1}>1 mm</option><option value={10}>10 mm</option></select
					>
				</label>
				<label class="field inline">
					Rotation step
					<select bind:value={rotStep}
						><option value={1}>1°</option><option value={15}>15°</option><option value={90}
							>90°</option
						></select
					>
				</label>
			</div>
			<div class="pe-row" role="tablist" aria-label="Copies">
				<button
					type="button"
					class="btn sm"
					class:primary={target === 0}
					onclick={() => (target = 0)}>Main</button
				>
				{#each current.instances.map((_, k) => k) as i (i)}
					<button
						type="button"
						class="btn sm"
						class:primary={target === i + 1}
						onclick={() => (target = i + 1)}>#{i + 1}</button
					>
				{/each}
				<button type="button" class="btn sm" onclick={addInstance}>+ Instance</button>
				<button type="button" class="btn sm danger" disabled={target === 0} onclick={removeInstance}
					>Remove</button
				>
			</div>

			<div class="pe-grid">
				{#each [['pos', 'Position (mm)'], ['rot', 'Rotation (deg, XYZ)']] as [group, label] (group)}
					<fieldset>
						<legend>{label}</legend>
						{#each ['X', 'Y', 'Z'] as axisName, a (axisName)}
							{@const g = group as 'pos' | 'rot'}
							{@const ax = a as 0 | 1 | 2}
							<div class="pe-num">
								<span>{axisName}</span>
								<button
									type="button"
									class="btn sm"
									aria-label="{axisName} minus"
									onclick={() => bump(g, ax, -1)}>−</button
								>
								<input
									type="number"
									step="any"
									aria-label="{label} {axisName}"
									value={fmt(trs[g][ax])}
									onchange={(e) => setPart(g, ax, e.currentTarget.valueAsNumber)}
								/>
								<button
									type="button"
									class="btn sm"
									aria-label="{axisName} plus"
									onclick={() => bump(g, ax, 1)}>+</button
								>
							</div>
						{/each}
					</fieldset>
				{/each}
			</div>
			<label class="check">
				<input
					type="checkbox"
					checked={isMirrored(matrix!)}
					onchange={(e) => mirror(e.currentTarget.checked)}
				/>
				Mirror across X (this copy)
			</label>

			<details>
				<summary>Array around an axis (tire segments, rim halves)</summary>
				<div class="pe-row">
					<label class="field inline"
						>Copies <input type="number" min="2" max="65" bind:value={ring.count} /></label
					>
					<label class="field inline"
						>Axis
						<select bind:value={ring.axis}
							><option>x</option><option>y</option><option>z</option></select
						>
					</label>
					<label class="field inline"
						>Center X <input type="number" step="any" bind:value={ring.cx} /></label
					>
					<label class="field inline"
						>Y <input type="number" step="any" bind:value={ring.cy} /></label
					>
					<label class="field inline"
						>Z <input type="number" step="any" bind:value={ring.cz} /></label
					>
					<button type="button" class="btn sm" onclick={makeRing}>Replace instances</button>
				</div>
				<p class="muted">
					The main matrix is copy 1; the others are spaced evenly around the axis.
				</p>
			</details>

			<div class="pe-row">
				<button type="button" class="btn primary" disabled={busy || !dirty} onclick={save}
					>{busy ? 'Saving…' : 'Save'}</button
				>
				<button type="button" class="btn" disabled={!dirty} onclick={revert}>Revert</button>
				{#if message}<span class="muted" role="status">{message}</span>{/if}
				{#if dirtyCount > 1}<span class="muted">{dirtyCount} parts have unsaved changes</span>{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.pe {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(220px, 1fr);
		gap: 12px;
	}
	.pe-view {
		height: min(70vh, 640px);
		min-height: 320px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--card);
		overflow: hidden;
	}
	.pe-side {
		display: grid;
		gap: 8px;
		align-content: start;
		max-height: min(70vh, 640px);
		min-height: 0;
	}
	.pe-filter {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		align-items: center;
	}
	.pe-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: auto;
		display: grid;
		gap: 4px;
	}
	.pe-part {
		width: 100%;
		display: flex;
		justify-content: space-between;
		gap: 8px;
		text-align: left;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--card);
		color: var(--ink);
		font-size: 13px;
		cursor: pointer;
	}
	.pe-part.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.pe-edit {
		grid-column: 1 / -1;
	}
	.pe-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}
	.pe-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 12px;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: 8px;
		display: grid;
		gap: 6px;
	}
	.pe-num {
		display: grid;
		grid-template-columns: 1.2em auto 1fr auto;
		gap: 6px;
		align-items: center;
	}
	.pe-num input {
		min-width: 0;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		color: var(--ink);
		font: 14px var(--f-mono);
	}
	.field.inline {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.field.inline input,
	.field.inline select {
		width: 6.5em;
		padding: 5px 6px;
	}
	@media (max-width: 760px) {
		.pe {
			grid-template-columns: minmax(0, 1fr);
		}
		.pe-side {
			max-height: 260px;
		}
	}
</style>
