<script lang="ts" module>
	export type PickedFilament = { name: string; material: string; hex: string };
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { suggestName } from '#lib/filament-catalog.ts';
	import { compareByHue, isNeutral, isHex, normHex } from '#lib/domain/color.ts';
	import type { SwatchTuple } from '#lib/domain/palettes.ts';
	import {
		POPULAR_BRANDS,
		loadRecent,
		loadSwatches,
		rememberRecent,
		type Family
	} from '#lib/client/swatches.ts';

	let {
		title,
		mode = 'edit',
		family: initialFamily = 'petg',
		current = null,
		slotMaterial = '',
		onpick,
		onclose
	}: {
		title: string;
		/** edit: recolor an existing slot, stays open so you can try several. new: pick the material first, one pick creates the slot. */
		mode?: 'edit' | 'new';
		family?: Family;
		current?: PickedFilament | null;
		/** The slot's material ("TPU 95A"); decides which types show by default. */
		slotMaterial?: string;
		onpick: (v: PickedFilament, family: Family) => void;
		onclose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let family = $state<Family>(initialFamily);
	let items = $state<SwatchTuple[]>([]);
	let failed = $state(false);
	let loading = $state(true);
	let brand = $state('');
	let q = $state('');
	let allTypes = $state(false);
	let recent = $state<SwatchTuple[]>([]);
	let hover = $state<SwatchTuple | null>(null);
	let cap = $state(480);
	let custom = $state({ name: '', hex: '#2f80ed' });
	let searchEl = $state<HTMLInputElement>();
	let sheetEl = $state<HTMLDivElement>();

	onMount(() => {
		recent = loadRecent();
		// Phones: don't pop the keyboard over the 3D view. Desktop: ready to type.
		if (window.matchMedia('(min-width: 900px)').matches) searchEl?.focus();
		else sheetEl?.focus();
	});

	$effect(() => {
		const fam = family;
		loading = true;
		failed = false;
		let live = true;
		loadSwatches(fam).then(
			(l) => {
				if (!live) return;
				items = l;
				loading = false;
			},
			() => {
				if (!live) return;
				failed = true;
				loading = false;
			}
		);
		return () => (live = false);
	});

	const lc = (s: string) => s.toLowerCase();
	const norm = (m: string) => m.toLowerCase().replace(/[^a-z0-9]/g, '');
	const famLabel = $derived(family === 'tpu' ? 'TPU' : 'PETG');
	const wantMat = $derived(norm(slotMaterial));
	const isBase = (m: string) => {
		const n = norm(m);
		return n === 'petg' || n === 'tpu' || (wantMat !== '' && n === wantMat);
	};
	const hasOther = $derived(items.some((i) => !isBase(i[3])));

	// Brand chips: the user's recent brands, then popular ones, the rest in a menu.
	const brandList = $derived([...new Set(items.map((i) => i[0]))]);
	const byLc = $derived(
		Object.fromEntries(brandList.map((b) => [lc(b), b])) as Record<string, string | undefined>
	);
	const chipBrands = $derived.by(() => {
		const out: string[] = [];
		const add = (b?: string) => b && !out.includes(b) && out.push(b);
		for (const r of recent) add(byLc[lc(r[0])]);
		for (const p of POPULAR_BRANDS) add(byLc[lc(p)]);
		return out.slice(0, 9);
	});
	const moreBrands = $derived(
		brandList.filter((b) => !chipBrands.includes(b)).sort((a, b) => a.localeCompare(b))
	);

	const sorted = $derived([...items].sort((a, b) => compareByHue(a[2], b[2])));
	const shown = $derived.by(() => {
		const words = lc(q.replace(/^#/, '')).split(/\s+/).filter(Boolean);
		return sorted.filter((i) => {
			if (!allTypes && !isBase(i[3])) return false;
			if (brand && i[0] !== brand) return false;
			if (!words.length) return true;
			const hay = `${i[0]} ${i[1]} ${i[3]} ${i[2].slice(1)}`.toLowerCase();
			return words.every((w) => hay.includes(w));
		});
	});
	const neutrals = $derived(shown.filter((i) => isNeutral(i[2])));
	const colorful = $derived(shown.filter((i) => !isNeutral(i[2])));
	const recentShown = $derived(
		recent.filter((r) => items.some((i) => i[0] === r[0] && i[1] === r[1] && i[3] === r[3]))
	);

	const nameOf = (t: SwatchTuple) => suggestName(t[0], t[1]);
	const isCurrent = (t: SwatchTuple) =>
		current !== null && lc(current.name) === lc(nameOf(t)) && lc(current.hex) === t[2];
	const detail = $derived(hover ?? items.find(isCurrent) ?? null);

	function pick(t: SwatchTuple) {
		hover = t;
		recent = rememberRecent(t);
		onpick({ name: nameOf(t), material: t[3], hex: t[2] }, family);
	}

	function useCustom() {
		const hex = normHex(custom.hex);
		const name = custom.name.trim();
		if (!name || !isHex(hex)) return;
		onpick({ name, material: family === 'tpu' ? 'TPU 95A' : 'PETG', hex }, family);
	}

	function setFamily(f: Family) {
		family = f;
		brand = '';
		cap = 480;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>

<div
	class="sheet"
	role="dialog"
	aria-label={title}
	data-testid="swatch-picker"
	tabindex="-1"
	bind:this={sheetEl}
>
	<header>
		<h2>{title}</h2>
		<button type="button" class="btn sm" onclick={onclose}
			>{mode === 'new' ? 'Cancel' : 'Done'}</button
		>
	</header>

	{#if mode === 'new'}
		<div class="chips" role="group" aria-label="Material">
			{#each ['petg', 'tpu'] as const as f (f)}
				<button type="button" class="chip" aria-pressed={family === f} onclick={() => setFamily(f)}>
					{f === 'petg' ? 'PETG (rigid parts)' : 'TPU (flexible parts)'}
				</button>
			{/each}
		</div>
	{/if}

	<div class="detail" aria-live="polite" data-testid="swatch-detail">
		{#if detail}
			<span class="dot" style="background-color:{detail[2]}" aria-hidden="true"></span>
			<span class="dtxt">
				<b>{nameOf(detail)}</b>
				<span class="muted">{detail[0]} · {detail[3]} · {detail[2]}</span>
			</span>
		{:else if current}
			<span class="dot" style="background-color:{current.hex}" aria-hidden="true"></span>
			<span class="dtxt">
				<b>{current.name}</b>
				<span class="muted">{current.material} · {current.hex}</span>
			</span>
		{:else}
			<span class="muted">Pick a swatch. Hover or focus one to see its name.</span>
		{/if}
	</div>

	<div class="tools">
		<input
			type="search"
			placeholder="Search name, brand or hex"
			aria-label="Search colors"
			autocomplete="off"
			bind:value={q}
			bind:this={searchEl}
			oninput={() => (cap = 480)}
		/>
		<div class="brands">
			<div class="chips scroll" role="group" aria-label="Brands">
				<button type="button" class="chip" aria-pressed={brand === ''} onclick={() => (brand = '')}>
					All brands
				</button>
				{#each chipBrands as b (b)}
					<button type="button" class="chip" aria-pressed={brand === b} onclick={() => (brand = b)}>
						{b}
					</button>
				{/each}
				{#if moreBrands.length}
					<select
						aria-label="More brands"
						value={moreBrands.includes(brand) ? brand : ''}
						onchange={(e) => (brand = e.currentTarget.value)}
					>
						<option value="">More brands ({moreBrands.length})</option>
						{#each moreBrands as b (b)}<option value={b}>{b}</option>{/each}
					</select>
				{/if}
			</div>
		</div>
		{#if hasOther}
			<label class="check">
				<input type="checkbox" bind:checked={allTypes} /> Show all {famLabel} types
				<span class="muted">(carbon-filled, other hardness)</span>
			</label>
		{/if}
	</div>

	<div class="body">
		{#if loading}
			<p class="muted">Loading colors…</p>
		{:else if failed}
			<p class="muted" role="alert">
				The filament catalog could not be loaded. Use a custom color below.
			</p>
		{:else}
			{#if recentShown.length && !q && !brand}
				<section aria-label="Recently used">
					<h3>Recently used</h3>
					<div class="grid">
						{#each recentShown as t (t[0] + t[1] + t[3])}
							{@render swatch(t)}
						{/each}
					</div>
				</section>
			{/if}
			{#if neutrals.length}
				<section aria-label="Neutrals">
					<h3>Neutrals <span class="muted">{neutrals.length}</span></h3>
					<div class="grid">
						{#each neutrals.slice(0, cap) as t (t[0] + t[1] + t[2] + t[3])}
							{@render swatch(t)}
						{/each}
					</div>
				</section>
			{/if}
			{#if colorful.length}
				<section aria-label="Colors">
					<h3>Colors <span class="muted">{colorful.length}</span></h3>
					<div class="grid">
						{#each colorful.slice(0, cap) as t (t[0] + t[1] + t[2] + t[3])}
							{@render swatch(t)}
						{/each}
					</div>
				</section>
			{/if}
			{#if !shown.length}
				<p class="muted">No {famLabel} colors match. Try another brand or search.</p>
			{:else if neutrals.length > cap || colorful.length > cap}
				<button type="button" class="btn sm" onclick={() => (cap += 600)}>Show more</button>
			{/if}
		{/if}

		<details class="custom">
			<summary>Add custom color</summary>
			<div class="crow">
				<input type="color" aria-label="Custom color" bind:value={custom.hex} />
				<input
					type="text"
					placeholder="Name, e.g. Team Red"
					aria-label="Custom color name"
					maxlength="60"
					bind:value={custom.name}
				/>
				<button
					type="button"
					class="btn primary sm"
					disabled={!custom.name.trim()}
					onclick={useCustom}
				>
					Use this color
				</button>
			</div>
			<p class="muted small">Saved as a {famLabel} filament named what you type.</p>
		</details>
	</div>
</div>

{#snippet swatch(t: SwatchTuple)}
	<button
		type="button"
		class="sw"
		class:on={isCurrent(t)}
		style="background-color:{t[2]}"
		aria-label="{nameOf(t)}, {t[3]}, {t[2]}"
		aria-pressed={isCurrent(t)}
		title="{nameOf(t)} · {t[3]} · {t[2]}"
		data-testid="swatch"
		onclick={() => pick(t)}
		onpointerenter={() => (hover = t)}
		onfocus={() => (hover = t)}
		onpointerleave={() => (hover = null)}
	></button>
{/snippet}

<style>
	.sheet {
		position: fixed;
		z-index: 1500;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 46vh;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 16px 0;
		background: var(--card);
		border-top: 1px solid var(--line);
		border-radius: 14px 14px 0 0;
		box-shadow: 0 -8px 30px rgb(0 0 0 / 0.22);
		outline: none;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	h3 {
		margin: 0 0 6px;
		font: 600 13px/1 var(--f-body);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.detail {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
	}
	.dot {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 2px solid var(--line);
		flex: none;
	}
	.dtxt {
		display: grid;
		min-width: 0;
		line-height: 1.25;
	}
	.dtxt b,
	.dtxt span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tools {
		display: grid;
		gap: 8px;
	}
	.brands {
		display: flex;
		gap: 8px;
		align-items: center;
		min-width: 0;
	}
	.chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chips.scroll {
		flex-wrap: nowrap;
		overflow-x: auto;
		min-width: 0;
		flex: 1;
		padding-bottom: 4px;
		scrollbar-width: thin;
	}
	.chip {
		white-space: nowrap;
		cursor: pointer;
	}
	select {
		max-width: 150px;
		flex: none;
	}
	.check {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 13px;
		flex-wrap: wrap;
	}
	.body {
		overflow-y: auto;
		display: grid;
		gap: 14px;
		align-content: start;
		padding-bottom: 16px;
		min-height: 120px;
		overscroll-behavior: contain;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 36px);
		gap: 8px;
		justify-content: space-between;
	}
	.sw {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 2px solid var(--line);
		padding: 0;
		cursor: pointer;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
	}
	.sw:hover,
	.sw:focus-visible {
		transform: scale(1.12);
		border-color: var(--ink);
	}
	.sw.on {
		border-color: var(--accent);
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}
	.custom summary {
		cursor: pointer;
		font-weight: 600;
	}
	.crow {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 8px;
		flex-wrap: wrap;
	}
	.crow input[type='text'] {
		flex: 1;
		min-width: 140px;
	}
	.crow input[type='color'] {
		width: 44px;
		height: 36px;
		padding: 0;
	}
	.small {
		font-size: 12px;
		margin: 6px 0 0;
	}
	@media (min-width: 900px) {
		.sheet {
			left: auto;
			top: 0;
			width: min(420px, 38vw);
			max-height: none;
			border: 0;
			border-left: 1px solid var(--line);
			border-radius: 0;
			box-shadow: -8px 0 30px rgb(0 0 0 / 0.18);
			padding: 16px 18px 0;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.sw {
			transition: transform 0.08s;
		}
	}
</style>
