<script lang="ts">
	import { resolve } from '$app/paths';
	import { exportDownloadUrl, exportPreview, type ExportPreviewDto } from '#lib/client/api.ts';
	import { busyRetrySeconds, createCoalescer } from '#lib/client/coalesce.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import { isCustomPlate } from '#lib/domain/custom.ts';
	import Swatch from '#lib/components/Swatch.svelte';
	import { exportPref, FLAVOR_OPTIONS } from '#lib/client/export-flavor.svelte.ts';

	const ctx = getBuildCtx();

	const FLAVORS = FLAVOR_OPTIONS;
	// The slicer is remembered per device (shared with the per-plate export buttons).
	$effect(() => exportPref.load());
	const flavor = $derived(exportPref.flavor);
	let scope = $state<'all' | 'some'>('all');
	let picked = $state<number[]>([]);
	let pv = $state<ExportPreviewDto | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);
	let busy = $state(false); // the last refresh got a 429: the previous preview stays
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	const clearRetry = () => {
		if (retryTimer !== null) clearTimeout(retryTimer);
		retryTimer = null;
	};

	// Reload whenever colors, plates or the printer change (same signals as the plate list).
	const key = $derived(
		JSON.stringify([
			flavor,
			// the export is of the kit's plates and parts: a custom piece (kept as sliced) never changes it
			ctx.view.plates
				.filter((p) => !isCustomPlate(p))
				.map((p) => [p.number, p.parts, p.source, p.runs]),
			ctx.view.printer ?? ctx.view.layoutPrinter,
			ctx.view.parts.filter((p) => !p.custom).map((p) => [p.slug, p.role]),
			ctx.view.filaments.map((f) => [f.key, f.hex, f.name, f.material])
		])
	);
	// A preview counts against the per-user expensive-read budget: live updates arriving in a burst
	// collapse into one request, and never more than one runs at a time.
	let seq = 0;
	const loads = createCoalescer();
	$effect(() => () => {
		loads.cancel();
		clearRetry();
	});
	$effect(() => {
		void key;
		const mine = ++seq;
		clearRetry();
		busy = false;
		if (!(ctx.view.printer ?? ctx.view.layoutPrinter)) {
			loads.cancel();
			pv = null;
			error = null;
			loading = false;
			return;
		}
		loading = true;
		const id = ctx.id;
		const f = flavor;
		const run = (retry: boolean): Promise<unknown> =>
			exportPreview(id, f)
				.then((r) => {
					if (mine !== seq) return;
					pv = r;
					error = null;
					busy = false;
				})
				.catch((e) => {
					if (mine !== seq) return;
					const wait = busyRetrySeconds(e);
					if (wait !== null) {
						// over the server's read budget: keep the last good preview and Download, try once more
						busy = true;
						error = null;
						if (retry)
							retryTimer = setTimeout(() => {
								retryTimer = null;
								if (mine === seq) loads.schedule(() => run(false));
							}, wait * 1000);
						return;
					}
					pv = null;
					error = e instanceof Error ? e.message : 'Could not prepare the export.';
				})
				.finally(() => {
					if (mine === seq) loading = false;
				});
		loads.schedule(() => run(true));
	});

	const chosen = $derived(
		pv ? (scope === 'all' ? pv.plates : pv.plates.filter((p) => picked.includes(p.number))) : []
	);
	const selection = $derived(scope === 'some' ? chosen.map((p) => p.number) : undefined);
	const usedKeys = $derived(new Set(chosen.flatMap((p) => p.objects.map((o) => o.role))));
	const warnings = $derived(
		(pv?.warnings ?? []).filter(
			(w) => w.plate === undefined || scope === 'all' || chosen.some((p) => p.number === w.plate)
		)
	);
	const objectCount = $derived(chosen.reduce((a, p) => a + p.items, 0));
	const files = $derived(flavor === 'plain' ? chosen.length : 1);
	const noGeometry = $derived(!!pv && !pv.ready);
	const slots = $derived(pv?.printer.mmSlots ?? 1);

	function toggle(n: number) {
		picked = picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n];
	}
	const href = $derived(
		pv?.ready && chosen.length ? exportDownloadUrl(ctx.id, flavor, selection) : null
	);
	const downloadLabel = $derived(
		flavor === 'plain'
			? files > 1
				? `Download .zip (${files} plate files)`
				: 'Download .3mf'
			: 'Download .3mf project'
	);
</script>

<section class="card export-card" aria-label="Export for your slicer" data-testid="export-card">
	<div class="group-head">
		<h2>Export for your slicer</h2>
		{#if pv?.ready}<span class="meta num" data-testid="export-count"
				>{chosen.length} plate{chosen.length === 1 ? '' : 's'} · {objectCount} part{objectCount ===
				1
					? ''
					: 's'}</span
			>{/if}
	</div>

	{#if !(ctx.view.printer ?? ctx.view.layoutPrinter)}
		<p class="muted" data-testid="export-no-printer">
			Choose your printer above first. The file uses its bed size and filament slots.
		</p>
	{:else}
		<div class="controls">
			<label class="field">
				Slicer
				<select bind:value={exportPref.flavor} data-testid="export-flavor">
					{#each FLAVORS as f (f.key)}<option value={f.key}>{f.label}</option>{/each}
				</select>
			</label>
			<fieldset class="scope">
				<legend>Plates</legend>
				<label
					><input type="radio" bind:group={scope} value="all" data-testid="export-scope-all" /> Whole
					project</label
				>
				<label
					><input type="radio" bind:group={scope} value="some" data-testid="export-scope-some" /> Selected
					plates</label
				>
			</fieldset>
		</div>

		{#if scope === 'some' && pv?.ready}
			<div class="picks" data-testid="export-plates">
				{#each pv.plates as p (p.number)}
					<label class="pick">
						<input
							type="checkbox"
							checked={picked.includes(p.number)}
							onchange={() => toggle(p.number)}
						/>
						<span>{p.number}. {p.name}</span>
					</label>
				{/each}
			</div>
		{/if}

		{#if error}
			<p class="err" role="alert">{error}</p>
		{:else if noGeometry}
			<div class="empty" data-testid="export-no-geometry">
				<strong>No print geometry yet</strong>
				<p class="muted">
					The export builds the file from MakeGood's models, which are not installed yet. They are
					added under Print settings.
				</p>
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					class="btn sm"
					href={resolve('/(app)/builds/[id]/files', { id: ctx.id }) + '#settings'}
					data-testid="export-open-settings">Open Print settings</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
		{:else if pv}
			<div class="slots" data-testid="export-filaments">
				<h3>Filament slots</h3>
				<ul>
					{#each pv.filaments.filter((f) => usedKeys.has(f.key)) as f (f.key)}
						<li class:over={f.index > slots}>
							<span class="num slot">{f.index}</span>
							<Swatch hex={f.hex} tpu={f.type === 'TPU'} size="mini" />
							<span>{f.label}: {f.name} <span class="meta">({f.material})</span></span>
						</li>
					{:else}
						<li class="muted">Select at least one plate.</li>
					{/each}
				</ul>
			</div>

			{#if warnings.length}
				<details
					class="warns"
					data-testid="export-warnings"
					open={warnings.some((w) => w.severity !== 'info')}
				>
					<summary>{warnings.length} note{warnings.length === 1 ? '' : 's'} about this file</summary
					>
					<ul>
						{#each warnings as w, i (i)}<li class={w.severity}>{w.message}</li>{/each}
					</ul>
				</details>
			{/if}

			<div class="actions">
				{#if href}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="btn primary" {href} download data-testid="export-download" data-sveltekit-reload
						>{downloadLabel}</a
					>
				{:else}
					<button class="btn primary" type="button" disabled data-testid="export-download"
						>{downloadLabel}</button
					>
				{/if}
				{#if busy}<span class="meta" data-testid="export-busy">Busy — try again in a moment</span
					>{:else if loading}<span class="meta">Updating…</span>{/if}
			</div>
		{/if}
		<p class="meta">
			Colors in the file come from this build's filaments, one slicer slot per color. Change a color
			and re-arrange the plates, and the next download has the new groups.
			{#if flavor === 'plain'}
				Plain files carry the filament in each part's name; set it in your slicer.
			{:else}
				Open the file in {flavor === 'bambu' ? 'Bambu Studio' : 'Elegoo Slicer or OrcaSlicer'}; the
				plates and filaments come with it.
			{/if}
		</p>
	{/if}
</section>

<style>
	.export-card {
		margin-bottom: var(--sp-6);
	}
	.export-card p {
		margin: 0;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-6) 24px;
		align-items: flex-end;
	}
	.scope {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-8);
		font-size: var(--fs-md);
	}
	.scope legend {
		font-size: var(--fs-sm);
		color: var(--muted);
		padding: 0;
		margin-bottom: var(--sp-2);
	}
	.picks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--sp-2) var(--sp-6);
		font-size: var(--fs-md);
	}
	.pick {
		display: flex;
		gap: var(--sp-3);
		align-items: flex-start;
	}
	.slots h3 {
		font-size: var(--fs-md);
		margin: 0 0 var(--sp-3);
	}
	.slots ul,
	.warns ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-2);
	}
	.slots li {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		font-size: var(--fs-md);
	}
	.slots li.over {
		color: var(--bad);
	}
	.slot {
		min-width: 1.4em;
		font-weight: 700;
	}
	.warns {
		font-size: var(--fs-sm);
	}
	.warns summary {
		cursor: pointer;
		color: var(--warn);
		font-weight: 600;
	}
	.warns ul {
		margin-top: var(--sp-3);
		padding-left: var(--sp-9);
		list-style: disc;
	}
	.warns li.error {
		color: var(--bad);
	}
	.warns li.info {
		color: var(--muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4) var(--sp-6);
		align-items: center;
	}
	.err {
		color: var(--bad);
		font-size: var(--fs-md);
	}
	.empty {
		display: grid;
		gap: var(--sp-3);
		justify-items: start;
	}
</style>
