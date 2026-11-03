<script lang="ts">
	import { onMount } from 'svelte';
	import {
		listPrintGeometry,
		uploadPrintGeometry,
		type PrintGeometryImportResult,
		type PrintGeometryRow
	} from '#lib/client/api.ts';

	/**
	 * Site admin card: import print geometry (footprints, hulls, meshes, the kit author's
	 * settings) from a profile 3MF, or a zip of 3MFs. Later uploads replace the parts they
	 * contain, so upload the main profile first, then the TPU and harness files.
	 */
	let { templateId }: { templateId: string } = $props();

	let rows = $state<PrintGeometryRow[]>([]);
	let loaded = $state(false);
	let frac = $state<number | null>(null);
	let busy = $state(false);
	let error = $state('');
	let result = $state<PrintGeometryImportResult | null>(null);
	let input: HTMLInputElement | undefined = $state();

	async function load() {
		try {
			rows = await listPrintGeometry(templateId);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load the geometry list';
		}
		loaded = true;
	}
	onMount(load);

	async function upload() {
		const file = input?.files?.[0];
		if (!file) return;
		error = '';
		result = null;
		frac = 0;
		try {
			result = await uploadPrintGeometry(templateId, file, (f) => (frac = f));
			frac = null;
			busy = true;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Import failed';
		} finally {
			frac = null;
			busy = false;
			if (input) input.value = '';
		}
	}

	const imported = $derived(rows.filter((r) => r.source !== 'seed').length);
	const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
	const keySettings = (s: Record<string, string>) =>
		[
			'wall_loops',
			'sparse_infill_density',
			'enable_support',
			'support_type',
			'brim_type',
			'layer_height'
		]
			.filter((k) => s[k] !== undefined)
			.map((k) => `${k.replace(/_/g, ' ')} ${s[k]}`)
			.join(', ');
</script>

<div class="card" data-testid="print-geometry-card">
	<h2>Print geometry</h2>
	<p class="muted">
		Import the kit author's profile 3MF to measure how much bed each part takes in the author's
		print orientation. The plate planner uses it to arrange plates for any printer. Meshes stay in
		this install's data volume. Without an import the planner uses the {rows.filter(
			(r) => r.source === 'seed'
		).length} built-in footprints.
	</p>
	<div class="row">
		<input
			bind:this={input}
			type="file"
			accept=".3mf,.zip,application/zip"
			disabled={frac !== null || busy}
			aria-label="Profile 3MF or zip of 3MFs"
		/>
		<button class="btn primary" type="button" onclick={upload} disabled={frac !== null || busy}>
			Import geometry
		</button>
	</div>
	{#if frac !== null}
		<p class="muted" role="status">
			{frac < 1
				? `Uploading ${Math.round(frac * 100)}%`
				: 'Reading the file, this takes a few seconds…'}
		</p>
		<progress value={frac} max="1"></progress>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if result}
		<div class="ok-note" role="status">
			Imported {result.imported} part{result.imported === 1 ? '' : 's'}.
			{#each result.report as r (r.file)}
				<div class="meta">
					{r.file}: {r.matched} matched in {(r.ms / 1000).toFixed(1)} s{r.unmatched.length
						? `, not matched: ${r.unmatched.slice(0, 6).join(', ')}${r.unmatched.length > 6 ? '…' : ''}`
						: ''}
					{#each r.warnings as w (w)}<div>{w}</div>{/each}
				</div>
			{/each}
		</div>
	{/if}
	{#if loaded}
		<p class="meta">{imported} imported, {rows.length - imported} from the kit data.</p>
		{#if rows.length}
			<div class="scroll">
				<table class="rep">
					<thead>
						<tr
							><th>Part</th><th>Box (mm)</th><th>Pieces</th><th>Source</th><th>Author's settings</th
							></tr
						>
					</thead>
					<tbody>
						{#each rows as r (r.slug)}
							<tr>
								<td>{r.slug}</td>
								<td class="num">{fmt(r.w)} × {fmt(r.d)} × {fmt(r.h)}</td>
								<td class="num"
									>{r.pieces > 1
										? `${r.pieces} (${r.copies}×)`
										: r.copies > 1
											? `${r.copies}×`
											: '1'}</td
								>
								<td>{r.source}</td>
								<td>{keySettings(r.settings)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

<style>
	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}
	.scroll {
		overflow-x: auto;
		max-height: 360px;
	}
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
	}
	progress {
		width: 100%;
	}
	.ok-note {
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--ok-soft);
		color: var(--ok);
		font-size: 13px;
	}
</style>
