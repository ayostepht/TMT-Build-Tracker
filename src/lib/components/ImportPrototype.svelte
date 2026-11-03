<script lang="ts">
	import { importPrototype, type ImportSummary } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	const ctx = getBuildCtx();
	const hasProgress = $derived(
		ctx.view.runs.length > 0 || Object.values(ctx.view.state).some((s) => s.status !== 'To print')
	);

	let data = $state<unknown>(null);
	let fileName = $state('');
	let preview = $state<ImportSummary | null>(null);
	let replace = $state(false);
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	async function pick(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		data = null;
		preview = null;
		error = '';
		done = '';
		replace = false;
		if (!file) return;
		fileName = file.name;
		busy = true;
		try {
			data = JSON.parse(await file.text());
			preview = await importPrototype(ctx.id, data, { dryRun: true });
		} catch (err) {
			data = null;
			error =
				err instanceof SyntaxError
					? 'That file is not valid JSON.'
					: err instanceof Error
						? err.message
						: 'Could not read the file.';
		} finally {
			busy = false;
		}
	}

	async function run() {
		if (!data) return;
		busy = true;
		error = '';
		try {
			const res = await importPrototype(ctx.id, data, { replace });
			done = `Imported ${res.parts} parts and ${res.runs} prints.`;
			data = null;
			preview = null;
			await ctx.refresh();
		} catch (err) {
			error = err instanceof Error ? err.message : 'The import failed.';
		} finally {
			busy = false;
		}
	}
</script>

{#if ctx.canEdit}
	<section class="card">
		<h2>Import from the original prototype</h2>
		<p class="muted">
			Bring over part statuses, print logs, slicer weights and spool counts from the original
			single-page tracker. Choose the export file made with
			<code>scripts/bundle-prototype-export.mjs</code>.
		</p>
		<label class="field"
			>Export file (.json)
			<input type="file" accept=".json,application/json" onchange={pick} disabled={busy} />
		</label>

		{#if preview}
			<div aria-live="polite" style="display:grid;gap:8px">
				<strong>{fileName}</strong>
				<span>
					{preview.parts} parts with progress, {preview.runs} logged prints, {preview.plates} plates with
					slicer weights, {preview.spools} spool counts.
				</span>
				{#if preview.warnings.length}
					<details>
						<summary>{preview.warnings.length} warnings</summary>
						<ul>
							{#each preview.warnings as w, i (i)}<li>{w}</li>{/each}
						</ul>
					</details>
				{/if}
				{#if hasProgress || !preview.empty}
					<label class="check">
						<input type="checkbox" bind:checked={replace} />
						Replace existing progress (deletes this build's logged prints and resets all parts)
					</label>
				{/if}
				<div>
					<button
						class="btn primary"
						type="button"
						onclick={run}
						disabled={busy || ((hasProgress || !preview.empty) && !replace)}>Import</button
					>
				</div>
			</div>
		{/if}
		{#if error}<p role="alert" class="muted">{error}</p>{/if}
		{#if done}<p role="status">{done}</p>{/if}
	</section>
{/if}
