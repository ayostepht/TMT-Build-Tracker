<script lang="ts" module>
	import type { CatalogColor, SearchHit } from '#lib/server/filaments/types.ts';

	export type FilamentValue = { name: string; material: string; hex: string };
	type BrandList = { name: string; materials: string[] }[];
	let brandsPromise: Promise<BrandList> | null = null;
	function loadBrands(): Promise<BrandList> {
		brandsPromise ??= fetch('/api/filaments')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error('catalog unavailable'))))
			.then((j: { brands: BrandList }) => j.brands)
			.catch((e) => {
				brandsPromise = null;
				throw e;
			});
		return brandsPromise;
	}
	async function getJson<T>(url: string): Promise<T> {
		const r = await fetch(url);
		if (!r.ok) throw new Error('catalog unavailable');
		return r.json();
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { preferMaterials, suggestName } from '#lib/filament-catalog.ts';
	import Swatch from './Swatch.svelte';

	let {
		value,
		preferMaterial,
		disabled = false,
		onchange
	}: {
		value: FilamentValue;
		preferMaterial?: string;
		disabled?: boolean;
		onchange: (v: FilamentValue) => void;
	} = $props();

	// Editable drafts; they reset when the saved value changes.
	let name = $derived(value.name);
	let material = $derived(value.material);
	let hex = $derived(value.hex);

	let brands = $state<BrandList>([]);
	let failed = $state(false);
	let brand = $state('');
	let catMaterial = $state('');
	let colors = $state<CatalogColor[]>([]);
	let filter = $state('');
	let quick = $state('');
	let hits = $state<SearchHit[]>([]);

	onMount(() => {
		loadBrands().then(
			(b) => (brands = b),
			() => (failed = true)
		);
	});

	const materialOptions = $derived(
		preferMaterials(brands.find((b) => b.name === brand)?.materials ?? [], preferMaterial, (m) => m)
	);
	const shownColors = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return q ? colors.filter((c) => c.name.toLowerCase().includes(q)) : colors;
	});

	function emit(next: Partial<FilamentValue>) {
		name = next.name ?? name;
		material = next.material ?? material;
		hex = next.hex ?? hex;
		onchange({ name, material, hex });
	}

	async function pickBrand(b: string) {
		brand = b;
		catMaterial = '';
		colors = [];
		filter = '';
		const first = preferMaterials(
			brands.find((x) => x.name === b)?.materials ?? [],
			preferMaterial,
			(m) => m
		);
		// A brand with a single material needs no second step.
		if (first.length === 1) await pickMaterial(first[0]);
	}

	async function pickMaterial(m: string) {
		catMaterial = m;
		filter = '';
		colors = [];
		if (!m) return;
		try {
			const r = await getJson<{ colors: CatalogColor[] }>(
				`/api/filaments/colors?brand=${encodeURIComponent(brand)}&material=${encodeURIComponent(m)}`
			);
			if (catMaterial === m) colors = r.colors;
		} catch {
			failed = true;
		}
	}

	function pickColor(c: CatalogColor) {
		emit({ name: suggestName(brand, c.name), material: catMaterial, hex: c.hex });
	}

	let quickSeq = 0;
	async function runQuick(q: string) {
		quick = q;
		const seq = ++quickSeq;
		if (!q.trim()) {
			hits = [];
			return;
		}
		try {
			const r = await getJson<{ results: SearchHit[] }>(
				`/api/filaments/search?q=${encodeURIComponent(q.trim())}`
			);
			if (seq === quickSeq) hits = r.results;
		} catch {
			failed = true;
		}
	}

	function pickHit(h: SearchHit) {
		emit({ name: h.name, material: h.material, hex: h.color.hex });
		quick = '';
		hits = [];
	}
</script>

<div class="fp">
	<div class="fp-head">
		<Swatch {hex} />
		<span class="fp-prev">{name || 'Unnamed'} <span class="muted">{material} · {hex}</span></span>
	</div>

	{#if !disabled}
		<details class="fp-cat">
			<summary>Pick from the filament catalog</summary>
			{#if failed}
				<p class="muted">The catalog could not be loaded. You can still type the values below.</p>
			{:else}
				<label class="field fp-quick"
					>Quick search
					<input
						type="search"
						placeholder="overture digital blue"
						value={quick}
						oninput={(e) => runQuick(e.currentTarget.value)}
						autocomplete="off"
					/></label
				>
				{#if hits.length}
					<ul class="fp-list" aria-label="Search results">
						{#each hits as h (h.brand + h.material + h.color.name)}
							<li>
								<button type="button" onclick={() => pickHit(h)}>
									<Swatch hex={h.color.hex} size="mini" />
									<span>{h.name} <span class="muted">{h.material}</span></span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if quick.trim()}
					<p class="muted">No matches.</p>
				{/if}

				<div class="fp-steps">
					<label class="field"
						>Catalog brand
						<select value={brand} onchange={(e) => pickBrand(e.currentTarget.value)}>
							<option value="">Choose a brand…</option>
							{#each brands as b (b.name)}<option value={b.name}>{b.name}</option>{/each}
						</select></label
					>
					<label class="field"
						>Catalog material
						<select
							value={catMaterial}
							disabled={!brand}
							onchange={(e) => pickMaterial(e.currentTarget.value)}
						>
							<option value="">Choose a material…</option>
							{#each materialOptions as m (m)}<option value={m}>{m}</option>{/each}
						</select></label
					>
				</div>
				{#if catMaterial}
					<label class="field"
						>Search colors
						<input type="search" bind:value={filter} autocomplete="off" /></label
					>
					<ul class="fp-list" aria-label="Colors">
						{#each shownColors as c (c.name)}
							<li>
								<button type="button" onclick={() => pickColor(c)}>
									<Swatch hex={c.hex} size="mini" />
									<span
										>{c.name}{#if c.finish}&nbsp;<span class="muted">{c.finish}</span>{/if}</span
									>
								</button>
							</li>
						{:else}
							<li class="muted fp-none">No colors.</li>
						{/each}
					</ul>
				{/if}
				<p class="muted fp-custom">Not listed? Skip the catalog and type the values below.</p>
			{/if}
		</details>
	{/if}

	<div class="fp-fields">
		<label class="field"
			>Name
			<input
				value={name}
				{disabled}
				onchange={(e) => emit({ name: e.currentTarget.value.trim() })}
			/></label
		>
		<label class="field"
			>Material
			<input
				value={material}
				{disabled}
				onchange={(e) => emit({ material: e.currentTarget.value.trim() })}
			/></label
		>
		<label class="field"
			>Color
			<input
				type="color"
				value={hex}
				{disabled}
				onchange={(e) => emit({ hex: e.currentTarget.value })}
			/></label
		>
	</div>
</div>

<style>
	.fp {
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	.fp-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.fp-prev {
		font-weight: 600;
	}
	.fp-cat summary {
		cursor: pointer;
		min-height: 40px;
		display: flex;
		align-items: center;
		font-weight: 600;
	}
	.fp-cat[open] {
		display: grid;
		gap: 10px;
	}
	.fp-steps,
	.fp-fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
		align-items: end;
	}
	.fp :global(input:not([type='color'])),
	.fp select {
		padding: 9px 10px;
		min-height: 40px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		font-size: 15px;
		width: 100%;
		min-width: 0;
	}
	.fp :global(input[type='color']) {
		width: 44px;
		height: 40px;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
	}
	.fp-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 240px;
		overflow-y: auto;
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	.fp-list button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 44px;
		padding: 6px 10px;
		border: 0;
		border-bottom: 1px solid var(--line);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.fp-list button:hover,
	.fp-list button:focus-visible {
		background: var(--paper);
	}
	.fp-none,
	.fp-custom {
		margin: 6px 10px;
	}
</style>
