<script lang="ts" module>
	export type PickedFilament = { name: string; material: string; hex: string };
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { suggestName } from '#lib/filament-catalog.ts';
	import type { SwatchTuple } from '#lib/domain/palettes.ts';
	import {
		chipBrandList,
		pickerReason,
		pickerSwatches,
		type PickerEntry
	} from '#lib/domain/swatch-picker.ts';
	import {
		customBrands,
		customFamily,
		customMaterialLabel,
		type CustomFilament
	} from '#lib/domain/custom-filaments.ts';
	import { deleteCustomFilament, listCustomFilaments } from '#lib/client/custom-filaments.ts';
	import CustomFilamentForm from './CustomFilamentForm.svelte';
	import {
		loadPreferredBrands,
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
		organizationId = '',
		onpick,
		onclose
	}: {
		title: string;
		/** edit: recolor an existing slot, stays open so you can try several. new: pick the material first, one pick creates the slot. */
		mode?: 'edit' | 'new';
		family?: Family;
		current?: PickedFilament | null;
		/** The slot's material ("TPU 95A"), passed on to the add-a-filament form. */
		slotMaterial?: string;
		/** The build's workspace: its custom filaments show first and "Add a filament" saves into it. */
		organizationId?: string;
		onpick: (v: PickedFilament, family: Family) => void;
		onclose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let family = $state<Family>(initialFamily);
	let items = $state<SwatchTuple[]>([]);
	let failed = $state(false);
	let loading = $state(true);
	let brands = $state<string[]>([]);
	let preferred = $state<string[]>([]);
	let q = $state('');
	let allTypes = $state(false);
	let recent = $state<SwatchTuple[]>([]);
	let hover = $state<SwatchTuple | null>(null);
	let cap = $state(480);
	let mine = $state<CustomFilament[]>([]);
	let showAllMine = $state(false);
	let screen = $state<'pick' | 'form'>('pick');
	let editing = $state<CustomFilament | null>(null);
	let confirmId = $state<string | null>(null);
	let formBrands = $state<string[]>([]);
	let formSeed = $state<{ name: string; hex: string } | null>(null);
	let note = $state('');
	let searchEl = $state<HTMLInputElement>();
	let sheetEl = $state<HTMLDivElement>();

	onMount(() => {
		recent = loadRecent();
		preferred = loadPreferredBrands();
		if (organizationId)
			listCustomFilaments(organizationId).then(
				(l) => (mine = l),
				() => {}
			);
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
	const famLabel = $derived(family === 'tpu' ? 'TPU' : 'PETG');

	// Brand chips: preferred and selected brands, then the user's recent ones, then popular ones; the rest in a menu.
	const brandList = $derived([...new Set(items.map((i) => i[0]))]);
	const chipBrands = $derived(
		chipBrandList({
			available: brandList,
			preferred,
			selected: brands,
			recent: recent.map((r) => r[0])
		})
	);
	const moreBrands = $derived(
		brandList.filter((b) => !chipBrands.includes(b)).sort((a, b) => a.localeCompare(b))
	);
	function toggleBrand(b: string) {
		brands = brands.includes(b) ? brands.filter((x) => x !== b) : [...brands, b];
		cap = 480;
	}

	const result = $derived(
		pickerSwatches(items, { showAll: allTypes, brands, preferred, query: q })
	);
	const neutrals = $derived(result.neutrals);
	const colorful = $derived(result.colorful);
	const hidden = $derived(result.hidden);
	const searching = $derived(q.trim() !== '');
	const nothing = $derived(!neutrals.length && !colorful.length);
	const recentShown = $derived(
		recent.filter((r) => items.some((i) => i[0] === r[0] && i[1] === r[1] && i[3] === r[3]))
	);

	const nameOf = (t: SwatchTuple) => suggestName(t[0], t[1]);
	const isCurrent = (t: SwatchTuple) =>
		current !== null && lc(current.name) === lc(nameOf(t)) && lc(current.hex) === t[2];
	const detail = $derived(hover ?? items.find(isCurrent) ?? null);
	// Same-looking swatches of other brands, by the representative they hide behind.
	const othersOf = $derived(
		new Map([...neutrals, ...colorful].filter((e) => e.others).map((e) => [e.t, e.others!]))
	);
	const detailOthers = $derived(detail ? (othersOf.get(detail) ?? []) : []);
	/** "also 11 other brands" for a swatch standing for same-looking ones. */
	function alsoText(t: SwatchTuple, others: PickerEntry[]): string {
		const n =
			new Set(others.map((o) => lc(o.t[0])).filter((b) => b !== lc(t[0]))).size || others.length;
		return n ? `also ${n} other brand${n === 1 ? '' : 's'}` : '';
	}
	const detailWhy = $derived(detail ? pickerReason(detail) : '');

	function pick(t: SwatchTuple) {
		hover = t;
		recent = rememberRecent(t);
		onpick({ name: nameOf(t), material: t[3], hex: t[2] }, family);
	}

	const myFit = $derived(mine.filter((f) => customFamily(f) === family));
	const myOther = $derived(mine.filter((f) => customFamily(f) !== family));
	const myShown = $derived(showAllMine ? mine : myFit);
	const myNameOf = (f: CustomFilament) => suggestName(f.brand, f.colorName);
	const isCurrentMine = (f: CustomFilament) =>
		current !== null && lc(current.name) === lc(myNameOf(f)) && lc(current.hex) === lc(f.hex);

	function pickMine(f: CustomFilament) {
		note = '';
		// The slot keeps its own family: a filament of another type can still be used on purpose.
		onpick({ name: myNameOf(f), material: customMaterialLabel(f), hex: f.hex }, family);
	}

	async function openForm(f: CustomFilament | null) {
		editing = f;
		confirmId = null;
		note = '';
		const d = detail;
		formSeed = d
			? { name: nameOf(d), hex: d[2] }
			: current
				? { name: current.name, hex: current.hex }
				: null;
		const cat: string[] = items.map((t) => t[0]);
		await Promise.all(
			(['petg', 'tpu'] as const).map((fam) =>
				loadSwatches(fam).then(
					(l) => cat.push(...l.map((t) => t[0])),
					() => {}
				)
			)
		);
		const own = customBrands(mine);
		formBrands = [
			...own,
			...cat
				.filter((b, i) => cat.indexOf(b) === i && !own.includes(b))
				.sort((x, y) => x.localeCompare(y))
		];
		screen = 'form';
	}

	function saved(f: CustomFilament, isNew: boolean) {
		mine = isNew ? [...mine, f] : mine.map((m) => (m.id === f.id ? f : m));
		mine.sort((a, b) => a.brand.localeCompare(b.brand) || a.colorName.localeCompare(b.colorName));
		screen = 'pick';
		editing = null;
		if (isNew) pickMine(f);
		else note = `Saved ${myNameOf(f)}.`;
	}

	function duplicate(id: string) {
		const f = mine.find((m) => m.id === id);
		screen = 'pick';
		editing = null;
		if (f) {
			note = `${myNameOf(f)} was already in My filaments; using it.`;
			pickMine(f);
		} else note = 'That filament already exists in My filaments.';
	}

	async function remove(f: CustomFilament) {
		try {
			await deleteCustomFilament(f.id);
			mine = mine.filter((m) => m.id !== f.id);
			note = `Deleted ${myNameOf(f)}. Builds using it keep their colors.`;
		} catch (e) {
			note = e instanceof Error ? e.message : 'Could not delete';
		}
		confirmId = null;
	}

	function setFamily(f: Family) {
		family = f;
		brands = [];
		cap = 480;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			if (screen === 'form') screen = 'pick';
			else onclose();
		}
	}}
/>

<div
	class="sheet"
	class:tall={screen === 'form'}
	class:roomy={screen === 'pick' && detailOthers.length > 0}
	role="dialog"
	aria-label={title}
	data-testid="swatch-picker"
	tabindex="-1"
	bind:this={sheetEl}
>
	<header>
		<h2>{screen === 'form' ? (editing ? 'Edit filament' : 'Add a filament') : title}</h2>
		<button type="button" class="btn sm" onclick={onclose}
			>{mode === 'new' ? 'Cancel' : 'Done'}</button
		>
	</header>

	{#if screen === 'form'}
		<div class="body">
			<CustomFilamentForm
				{organizationId}
				{family}
				{slotMaterial}
				initial={editing}
				brands={formBrands}
				seed={formSeed}
				onsaved={saved}
				onduplicate={duplicate}
				oncancel={() => (screen = 'pick')}
			/>
		</div>
	{:else}
		{#if mode === 'new'}
			<div class="chips" role="group" aria-label="Material">
				{#each ['petg', 'tpu'] as const as f (f)}
					<button
						type="button"
						class="chip"
						aria-pressed={family === f}
						onclick={() => setFamily(f)}
					>
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
					{#if detailWhy}<span class="why">Palettes skip it: {detailWhy}</span>{/if}
					{#if detailOthers.length}<span class="muted" data-testid="swatch-also"
							>{alsoText(detail, detailOthers)}</span
						>{/if}
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

		{#if detailOthers.length}
			<details class="others" data-testid="other-brands">
				<summary>Other brands ({detailOthers.length})</summary>
				<ul>
					{#each detailOthers as o (o.t[0] + o.t[1] + o.t[2] + o.t[3])}
						<li>
							<button
								type="button"
								class="opick"
								data-testid="other-brand"
								aria-label="Use {nameOf(o.t)}, {o.t[3]}, {o.t[2]}"
								onclick={() => pick(o.t)}
							>
								<span class="dot sm" style="background-color:{o.t[2]}" aria-hidden="true"></span>
								<span class="mtxt"
									><b>{o.t[0]} · {o.t[1]}</b> <span class="muted">{o.t[3]} · {o.t[2]}</span></span
								>
							</button>
						</li>
					{/each}
				</ul>
			</details>
		{/if}

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
					<button
						type="button"
						class="chip"
						aria-pressed={brands.length === 0}
						onclick={() => (brands = [])}
					>
						All brands
					</button>
					{#each chipBrands as b (b)}
						<button
							type="button"
							class="chip"
							aria-pressed={brands.includes(b)}
							onclick={() => toggleBrand(b)}
						>
							{b}
						</button>
					{/each}
					{#if moreBrands.length}
						<select
							aria-label="More brands"
							value=""
							onchange={(e) => {
								const v = e.currentTarget.value;
								e.currentTarget.value = '';
								if (v && !brands.includes(v)) toggleBrand(v);
							}}
						>
							<option value="">More brands ({moreBrands.length})</option>
							{#each moreBrands as b (b)}<option value={b}>{b}</option>{/each}
						</select>
					{/if}
				</div>
			</div>
			{#if hidden > 0 || allTypes}
				<label class="check">
					<input type="checkbox" bind:checked={allTypes} data-testid="show-all-types" /> Show all
					types
					<span class="muted"
						>{allTypes
							? '(tagged ones are not used by palettes)'
							: `(${hidden} hidden: silk, matte, other hardness, filled …)`}</span
					>
				</label>
			{:else if searching}
				<p class="muted small">Search also finds types that palettes skip.</p>
			{/if}
		</div>

		<div class="body">
			{#if note}<p class="muted small" role="status">{note}</p>{/if}
			{#if organizationId}
				<section aria-label="My filaments" data-testid="my-filaments">
					<div class="mhead">
						<h3>My filaments <span class="muted">{myShown.length}</span></h3>
						<button
							type="button"
							class="btn sm"
							data-testid="add-filament"
							onclick={() => openForm(null)}>+ Add a filament</button
						>
					</div>
					<ul class="mine">
						{#each myShown as f (f.id)}
							<li class:on={isCurrentMine(f)} data-testid="my-filament">
								{#if confirmId === f.id}
									<span class="mtxt"><b>Delete {myNameOf(f)}?</b></span>
									<button type="button" class="btn sm danger" onclick={() => remove(f)}
										>Delete</button
									>
									<button type="button" class="btn sm" onclick={() => (confirmId = null)}
										>Keep</button
									>
								{:else}
									<button
										type="button"
										class="mpick"
										aria-label="Use {myNameOf(f)}, {customMaterialLabel(f)}, {f.hex}"
										onclick={() => pickMine(f)}
									>
										<span class="dot sm" style="background-color:{f.hex}" aria-hidden="true"></span>
										<span class="mtxt">
											<b>{myNameOf(f)}</b>
											<span class="muted"
												>{customMaterialLabel(f)}{f.finish ? ` · ${f.finish}` : ''} · {f.hex}</span
											>
										</span>
									</button>
									<button
										type="button"
										class="ico"
										aria-label="Edit {myNameOf(f)}"
										title="Edit"
										onclick={() => openForm(f)}>✎</button
									>
									<button
										type="button"
										class="ico"
										aria-label="Delete {myNameOf(f)}"
										title="Delete"
										onclick={() => (confirmId = f.id)}>🗑</button
									>
								{/if}
							</li>
						{:else}
							<li class="muted empty">
								{mine.length
									? `None for ${famLabel} yet.`
									: 'Your own brand, type and color, saved for reuse.'}
							</li>
						{/each}
					</ul>
					{#if myOther.length}
						<label class="check">
							<input type="checkbox" bind:checked={showAllMine} /> Show all
							<span class="muted">({myOther.length} of other types)</span>
						</label>
					{/if}
				</section>
			{/if}
			{#if loading}
				<p class="muted">Loading colors…</p>
			{:else if failed}
				<p class="muted" role="alert">
					The filament catalog could not be loaded. Add your own filament below.
				</p>
			{:else}
				{#if recentShown.length && !q && !brands.length}
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
							{#each neutrals.slice(0, cap) as e (e.t[0] + e.t[1] + e.t[2] + e.t[3])}
								{@render swatch(e.t, e.others)}
							{/each}
						</div>
					</section>
				{/if}
				{#if colorful.length}
					<section aria-label="Colors">
						<h3>Colors <span class="muted">{colorful.length}</span></h3>
						<div class="grid">
							{#each colorful.slice(0, cap) as e (e.t[0] + e.t[1] + e.t[2] + e.t[3])}
								{@render swatch(e.t, e.others)}
							{/each}
						</div>
					</section>
				{/if}
				{#if nothing}
					<p class="muted">
						No {famLabel} colors match. Try another brand or search{hidden
							? `, or show all types (${hidden} hidden)`
							: ''}.
					</p>
				{:else if neutrals.length > cap || colorful.length > cap}
					<button type="button" class="btn sm" onclick={() => (cap += 600)}>Show more</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

{#snippet swatch(t: SwatchTuple, others: PickerEntry[] = [])}
	{@const why = pickerReason(t)}
	{@const also = alsoText(t, others)}
	<button
		type="button"
		class="sw"
		class:on={isCurrent(t)}
		class:excl={!!why}
		style="background-color:{t[2]}"
		aria-label="{nameOf(t)}, {t[3]}, {t[2]}{also ? `, ${also}` : ''}{why
			? `, not used by palettes: ${why}`
			: ''}"
		aria-pressed={isCurrent(t)}
		title="{nameOf(t)} · {t[3]} · {t[2]}{also ? ` · ${also}` : ''}{why
			? ` · Not used by palettes: ${why}`
			: ''}"
		data-testid="swatch"
		onclick={() => pick(t)}
		onpointerenter={() => (hover = t)}
		onfocus={() => (hover = t)}
		onpointerleave={() => {
			if (!others.length) hover = null;
		}}
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
	.sw {
		position: relative;
	}
	/* Small tag on swatches that palettes never pick (silk, matte, other hardness ...). */
	.sw.excl::after {
		content: '!';
		position: absolute;
		right: -4px;
		top: -4px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--ink);
		font: 700 10px/12px var(--f-body);
		text-align: center;
		pointer-events: none;
	}
	.others summary {
		cursor: pointer;
		font-size: 13px;
		color: var(--muted);
	}
	.others ul {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
		max-height: 112px;
		overflow-y: auto;
		display: grid;
		gap: 2px;
	}
	.opick {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		background: none;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 2px 6px;
		min-height: 36px;
		cursor: pointer;
		color: inherit;
		font: inherit;
	}
	.why {
		color: var(--muted);
		font-size: 12px;
	}
	.sw.on {
		border-color: var(--accent);
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}
	.mhead {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}
	.mhead h3 {
		margin: 0;
	}
	.mine li.empty {
		border: 0;
		padding: 2px 0;
		font-size: 13px;
	}
	.mine {
		list-style: none;
		margin: 0 0 6px;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.mine li {
		display: flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 2px 4px 2px 2px;
	}
	.mine li.on {
		border-color: var(--accent);
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.mpick {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		text-align: left;
		background: none;
		border: 0;
		padding: 6px;
		cursor: pointer;
		color: inherit;
		font: inherit;
		min-height: 44px;
	}
	.mtxt {
		display: grid;
		min-width: 0;
		line-height: 1.25;
		flex: 1;
	}
	.mtxt b,
	.mtxt span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot.sm {
		width: 28px;
		height: 28px;
	}
	.ico {
		width: 40px;
		height: 40px;
		flex: none;
		background: none;
		border: 0;
		border-radius: 8px;
		cursor: pointer;
		font-size: 16px;
		color: var(--muted);
	}
	.ico:hover,
	.ico:focus-visible {
		background: var(--accent-soft);
		color: var(--ink);
	}
	.sheet.tall {
		max-height: 88vh;
	}
	.sheet.roomy {
		max-height: 66vh;
	}
	.sheet > :not(.body) {
		flex: none;
	}
	.small {
		font-size: 12px;
		margin: 6px 0 0;
	}
	@media (min-width: 900px) {
		.sheet,
		.sheet.tall {
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
