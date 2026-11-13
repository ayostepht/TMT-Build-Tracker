<script lang="ts" module>
	export type PickedFilament = { name: string; material: string; hex: string };
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { suggestName } from '#lib/filament-catalog.ts';
	import { filamentSubtypes, type SwatchTuple } from '#lib/domain/palettes.ts';
	import {
		chipBrandList,
		closestMatches,
		groupByFamily,
		isApproxHex,
		pickerReason,
		pickerSwatches,
		typeOptions,
		TYPE_ALL,
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
	/** Bumped by "Try again" to run the catalog load once more. */
	let attempt = $state(0);
	let brands = $state<string[]>([]);
	let preferred = $state<string[]>([]);
	let q = $state('');
	/** The Type filter: '' standard, 'all', or a subtype id (see typeOptions). */
	let typeSel = $state('');
	/** Opening on a non-standard current color selects its type once, so the pick stays visible. */
	let typeSeeded = false;
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
		// Non-modal panel: on close, focus goes back to the control that opened it (the panel it
		// hid reappears in the same update, so wait for it).
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		recent = loadRecent();
		preferred = loadPreferredBrands();
		if (organizationId)
			listCustomFilaments(organizationId).then(
				(l) => (mine = l),
				() => {}
			);
		// Phones: don't pop the keyboard over the 3D view. Desktop: ready to type.
		if (window.matchMedia('(min-width: 900px)').matches) searchEl?.focus();
		else {
			sheetEl?.focus({ preventScroll: true });
			// Bring the panel's top (search + filters) just under the pinned viewer.
			sheetEl?.scrollIntoView({ block: 'start' });
		}
		return () => {
			void tick().then(() => {
				if (opener?.isConnected && opener.offsetParent) opener.focus({ preventScroll: true });
			});
		};
	});

	$effect(() => {
		const fam = family;
		void attempt;
		loading = true;
		failed = false;
		let live = true;
		loadSwatches(fam).then(
			(l) => {
				if (!live) return;
				items = l;
				loading = false;
				if (!typeSeeded) {
					typeSeeded = true;
					const cur = l.find(isCurrent);
					const sub = cur ? filamentSubtypes(cur)[0] : undefined;
					if (sub) typeSel = sub.id;
				}
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

	// Options come from the whole list so they stay put when a brand is picked; counts follow the brand.
	const typeOpts = $derived.by(() => {
		const inBrand = new Map(typeOptions(items, family, brands).map((o) => [o.id, o.count]));
		return typeOptions(items, family).map((o) =>
			o.id === TYPE_ALL ? o : { ...o, count: inBrand.get(o.id) ?? 0 }
		);
	});
	// A subtype the material does not have (after switching PETG/TPU) falls back to Standard.
	const effType = $derived(typeOpts.some((o) => o.id === typeSel) ? typeSel : '');
	const result = $derived(pickerSwatches(items, { type: effType, brands, preferred, query: q }));
	const neutrals = $derived(result.neutrals);
	const colorful = $derived(result.colorful);
	const hidden = $derived(result.hidden);
	const searching = $derived(q.trim() !== '');
	const nothing = $derived(!neutrals.length && !colorful.length);
	const recentShown = $derived(
		recent.filter((r) => items.some((i) => i[0] === r[0] && i[1] === r[1] && i[3] === r[3]))
	);

	// Layout: closest matches to the current color, recent picks, hue families, neutrals folded away.
	let famFilter = $state('');
	let neutralsOpen = $state(false);
	let activeId = $state('');
	let bodyEl = $state<HTMLDivElement>();
	const groups = $derived(groupByFamily(colorful));
	const effFam = $derived(
		famFilter === 'neutral'
			? neutrals.length
				? 'neutral'
				: ''
			: groups.some((g) => g.id === famFilter)
				? famFilter
				: ''
	);
	const keyOf = (t: SwatchTuple) => `${t[0]}|${t[1]}|${t[2]}|${t[3]}`;
	const idOf = (sid: string, t: SwatchTuple) => `${sid}|${keyOf(t)}`;
	const toEntry = (t: SwatchTuple): PickerEntry => ({ t, reason: pickerReason(t) });
	const plain = $derived(!searching && effFam === '');
	const closest = $derived(
		plain && current ? closestMatches([...colorful, ...neutrals], current.hex, 8) : []
	);
	const recentList = $derived(plain && !brands.length ? recentShown.map(toEntry) : []);
	const neutralsOn = $derived(neutralsOpen || searching || effFam === 'neutral');
	const sections = $derived.by(() => {
		let budget = cap;
		const out: { id: string; label: string; count?: number; entries: PickerEntry[] }[] = [];
		if (closest.length)
			out.push({ id: 'closest', label: 'Closest to the current color', entries: closest });
		if (recentList.length) out.push({ id: 'recent', label: 'Recently used', entries: recentList });
		for (const g of effFam === 'neutral' ? [] : groups.filter((x) => !effFam || x.id === effFam)) {
			const entries = g.entries.slice(0, Math.max(0, budget));
			budget -= entries.length;
			if (entries.length) out.push({ id: g.id, label: g.label, count: g.entries.length, entries });
		}
		return out;
	});
	const moreColors = $derived(
		(effFam === 'neutral'
			? 0
			: groups.reduce((n, g) => n + (!effFam || g.id === effFam ? g.entries.length : 0), 0)) > cap
	);
	const neutralShown = $derived(neutralsOn ? neutrals.slice(0, cap) : []);
	/** Every swatch in the DOM, in order: one of them is the grid's single tab stop. */
	const visibleIds = $derived([
		...sections.flatMap((s) => s.entries.map((e) => idOf(s.id, e.t))),
		...neutralShown.map((e) => idOf('neutral', e.t))
	]);
	const tabId = $derived(visibleIds.includes(activeId) ? activeId : (visibleIds[0] ?? ''));
	const showNeutralsHead = $derived(neutrals.length > 0 && (effFam === '' || effFam === 'neutral'));

	/** Arrow keys move through the swatches (rows by position), Home/End jump to the ends. */
	function gridKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement;
		if (!el.classList?.contains('sw') || !bodyEl) return;
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
		const all = [...bodyEl.querySelectorAll<HTMLButtonElement>('button.sw')];
		const i = all.indexOf(el as HTMLButtonElement);
		if (i < 0) return;
		e.preventDefault();
		let next: HTMLButtonElement | undefined;
		if (e.key === 'ArrowLeft') next = all[i - 1];
		else if (e.key === 'ArrowRight') next = all[i + 1];
		else if (e.key === 'Home') next = all[0];
		else if (e.key === 'End') next = all[all.length - 1];
		else {
			const r = el.getBoundingClientRect();
			const cx = r.left + r.width / 2;
			const up = e.key === 'ArrowUp';
			const rects = all.map((b) => ({ b, r: b.getBoundingClientRect() }));
			const cand = rects.filter((x) => (up ? x.r.bottom <= r.top + 1 : x.r.top >= r.bottom - 1));
			if (cand.length) {
				const rowTop = up
					? Math.max(...cand.map((x) => x.r.top))
					: Math.min(...cand.map((x) => x.r.top));
				const row = cand.filter((x) => Math.abs(x.r.top - rowTop) < 4);
				next = row.reduce((a, x) =>
					Math.abs(x.r.left + x.r.width / 2 - cx) < Math.abs(a.r.left + a.r.width / 2 - cx) ? x : a
				).b;
			}
		}
		next?.focus();
	}

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
	const detailApprox = $derived(detail ? isApproxHex(detail) : false);

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
		famFilter = '';
		typeSel = '';
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

<!-- Fills the pane the workspace gives it (right pane on desktop, the area under the pinned chair on phones). -->
<div
	class="sheet"
	role="region"
	aria-label={title}
	data-testid="swatch-picker"
	tabindex="-1"
	bind:this={sheetEl}
>
	<header>
		<h2>{screen === 'form' ? (editing ? 'Edit filament' : 'Add a filament') : title}</h2>
		<button type="button" class="btn sm done" onclick={onclose}
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
						class="ds-badge sp-chip"
						aria-pressed={family === f}
						onclick={() => setFamily(f)}
					>
						{f === 'petg' ? 'PETG (rigid parts)' : 'TPU (flexible parts)'}
					</button>
				{/each}
			</div>
		{/if}

		<div class="searchrow">
			<input
				type="search"
				placeholder="Search name, brand or hex"
				aria-label="Search colors"
				autocomplete="off"
				bind:value={q}
				bind:this={searchEl}
				oninput={() => (cap = 480)}
			/>
			{#if organizationId}
				<button
					type="button"
					class="btn sm add"
					data-testid="add-filament"
					aria-label="Add a filament"
					title="Add your own brand, type and color"
					onclick={() => openForm(null)}>+ Add</button
				>
			{/if}
		</div>

		<div class="filters" role="group" aria-label="Filters">
			{#if typeOpts.length > 2}
				<select
					class="typesel"
					aria-label="Type"
					data-testid="type-select"
					value={effType}
					title={hidden > 0
						? `${hidden} hidden: silk, matte, other hardness, filled …`
						: effType
							? 'Swatches palettes skip carry their reason'
							: ''}
					onchange={(e) => {
						typeSel = e.currentTarget.value;
						cap = 480;
					}}
				>
					{#each typeOpts as o (o.id)}
						<option value={o.id} title={o.hint}
							>{o.label}{o.id === TYPE_ALL
								? hidden > 0
									? ` (+${hidden})`
									: ''
								: o.id === ''
									? ''
									: ` (${o.count})`}</option
						>
					{/each}
				</select>
			{/if}
			{#if groups.length || neutrals.length}
				<select
					class="fam"
					aria-label="Color family"
					value={effFam}
					onchange={(e) => {
						famFilter = e.currentTarget.value;
						cap = 480;
					}}
				>
					<option value="">All colors</option>
					{#each groups as g (g.id)}<option value={g.id}>{g.label} ({g.entries.length})</option
						>{/each}
					{#if neutrals.length}<option value="neutral"
							>Whites, grays, blacks ({neutrals.length})</option
						>{/if}
				</select>
			{/if}
			<!-- Phones: one select instead of the chip rows (popular brands first, then the rest). -->
			{#if brandList.length}
				<select
					class="brandsel"
					aria-label="Brand"
					data-testid="brand-select"
					value={brands.length ? brands[0] : ''}
					onchange={(e) => {
						const v = e.currentTarget.value;
						brands = v ? [v] : [];
						cap = 480;
					}}
				>
					<option value="">All brands</option>
					<optgroup label="Popular">
						{#each chipBrands as b (b)}<option value={b}>{b}</option>{/each}
					</optgroup>
					{#if moreBrands.length}
						<optgroup label="More brands">
							{#each moreBrands as b (b)}<option value={b}>{b}</option>{/each}
						</optgroup>
					{/if}
				</select>
			{/if}
			<div class="chips brandchips" role="group" aria-label="Brands">
				<button
					type="button"
					class="ds-badge sp-chip"
					aria-pressed={brands.length === 0}
					onclick={() => (brands = [])}
				>
					All brands
				</button>
				{#each chipBrands as b (b)}
					<button
						type="button"
						class="ds-badge sp-chip"
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

		<div class="detail" aria-live="polite" data-testid="swatch-detail">
			{#if detail}
				<span class="sp-dot" style="background-color:{detail[2]}" aria-hidden="true"></span>
				<span class="dtxt">
					<b>{nameOf(detail)}</b>
					<span class="muted">{detail[0]} · {detail[3]} · {detail[2]}</span>
					{#if detailApprox}<span class="why" data-testid="swatch-approx"
							>Approx. color: estimated from product photos</span
						>{/if}
					{#if detailWhy}<span class="why">Palettes skip it: {detailWhy}</span>{/if}
					{#if detailOthers.length}<span class="muted" data-testid="swatch-also"
							>{alsoText(detail, detailOthers)}</span
						>{/if}
				</span>
			{:else if current}
				<span class="sp-dot" style="background-color:{current.hex}" aria-hidden="true"></span>
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
								<span class="sp-dot sm" style="background-color:{o.t[2]}" aria-hidden="true"></span>
								<span class="mtxt"
									><b>{o.t[0]} · {o.t[1]}</b> <span class="muted">{o.t[3]} · {o.t[2]}</span></span
								>
							</button>
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="body" bind:this={bodyEl} onkeydown={gridKey}>
			{#if note}<p class="muted small" role="status">{note}</p>{/if}
			{#if searching && effType === ''}
				<p class="muted small">Search also finds types that palettes skip.</p>
			{/if}
			{#if organizationId && mine.length}
				<section aria-label="My filaments" data-testid="my-filaments">
					<h3>My filaments <span class="muted">{myShown.length}</span></h3>
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
										<span class="sp-dot sm" style="background-color:{f.hex}" aria-hidden="true"
										></span>
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
							<li class="muted empty">None for {famLabel} yet.</li>
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
					The filament catalog could not be loaded. Add your own filament with + Add.
				</p>
				<button type="button" class="btn sm" data-testid="catalog-retry" onclick={() => attempt++}
					>Try again</button
				>
			{:else}
				{#each sections as s (s.id)}
					<section aria-label={s.label}>
						<h3>
							{s.label}{#if s.count !== undefined}&nbsp;<span class="muted">{s.count}</span>{/if}
						</h3>
						<div class="grid">
							{#each s.entries as e (e.t[0] + e.t[1] + e.t[2] + e.t[3])}
								{@render swatch(s.id, e.t, e.others)}
							{/each}
						</div>
					</section>
				{/each}
				{#if showNeutralsHead}
					<section aria-label="Whites, grays and blacks">
						{#if searching || effFam === 'neutral'}
							<h3>Whites, grays, blacks <span class="muted">{neutrals.length}</span></h3>
						{:else}
							<button
								type="button"
								class="nhead"
								aria-expanded={neutralsOpen}
								data-testid="neutrals-toggle"
								onclick={() => (neutralsOpen = !neutralsOpen)}
							>
								<span aria-hidden="true">{neutralsOpen ? '▾' : '▸'}</span>
								Whites, grays, blacks <span class="muted">{neutrals.length}</span>
							</button>
						{/if}
						{#if neutralsOn}
							<div class="grid">
								{#each neutralShown as e (e.t[0] + e.t[1] + e.t[2] + e.t[3])}
									{@render swatch('neutral', e.t, e.others)}
								{/each}
							</div>
						{/if}
					</section>
				{/if}
				{#if nothing}
					<p class="muted">
						No {famLabel} colors match. Try another brand or search{hidden
							? `, or change Type to see more (${hidden} hidden)`
							: effType
								? ', or change Type'
								: ''}.
					</p>
				{:else if moreColors || neutrals.length > cap}
					<button type="button" class="btn sm" onclick={() => (cap += 600)}>Show more</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

{#snippet swatch(sid: string, t: SwatchTuple, others: PickerEntry[] = [])}
	{@const why = pickerReason(t)}
	{@const also = alsoText(t, others)}
	{@const id = idOf(sid, t)}
	{@const approx = isApproxHex(t)}
	<button
		type="button"
		class="sw"
		class:on={isCurrent(t)}
		class:excl={!!why}
		style="background-color:{t[2]}"
		aria-label="{nameOf(t)}, {t[3]}, {t[2]}{approx ? ', approximate color' : ''}{also
			? `, ${also}`
			: ''}{why ? `, not used by palettes: ${why}` : ''}"
		aria-pressed={isCurrent(t)}
		title="{nameOf(t)} · {t[3]} · {t[2]}{approx ? ' · approx. color' : ''}{also
			? ` · ${also}`
			: ''}{why ? ` · Not used by palettes: ${why}` : ''}"
		data-testid="swatch"
		tabindex={tabId === id ? 0 : -1}
		onclick={() => {
			activeId = id;
			pick(t);
		}}
		onpointerenter={() => (hover = t)}
		onfocus={() => {
			activeId = id;
			hover = t;
		}}
		onpointerleave={() => {
			if (!others.length) hover = null;
		}}
	></button>
{/snippet}

<style>
	.sheet {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		padding: var(--sp-5) var(--sp-6) 0;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--r-xl);
		outline: none;
		/* Phones: the viewer is pinned above the panel; keep the top clear of it when scrolled to. */
		scroll-margin-top: calc(var(--stick, 0px) + var(--stageh, 0px) + var(--sp-4) + var(--sp-3));
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--sp-4);
	}
	h2 {
		margin: 0;
		font-size: var(--fs-lg);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	h3 {
		margin: 0 0 var(--sp-3);
		font: 600 var(--fs-sm)/1 var(--f-body);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.searchrow {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
	}
	/* The app's field style (the same as the other forms): token fill and text, rounded, --field-line border. */
	.searchrow input,
	select {
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font-size: var(--fs-base);
	}
	.searchrow input:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.searchrow input {
		flex: 1;
		min-width: 0;
	}
	.filters {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
		flex-wrap: nowrap;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding-bottom: var(--sp-2);
		scrollbar-width: thin;
	}
	.filters > * {
		flex: none;
	}
	.chips {
		display: flex;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
	.brandchips {
		flex-wrap: nowrap;
	}
	.sp-chip {
		white-space: nowrap;
		cursor: pointer;
		flex: none;
	}
	select {
		max-width: 170px;
	}
	.brandsel {
		display: none;
	}
	.fam,
	.typesel {
		max-width: 190px;
	}
	.detail {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		min-height: 40px;
	}
	.sp-dot {
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
	.check {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
		font-size: var(--fs-sm);
		flex-wrap: wrap;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		gap: var(--sp-7);
		align-content: start;
		padding-bottom: var(--sp-8);
		overscroll-behavior: contain;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 36px);
		gap: var(--sp-4);
		justify-content: space-between;
		padding: var(--sp-3);
	}
	.sw {
		position: relative;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 2px solid var(--line);
		padding: 0;
		cursor: pointer;
		box-shadow: var(--ring-swatch);
	}
	.sw:hover,
	.sw:focus-visible {
		transform: scale(1.12);
		border-color: var(--ink);
	}
	/* The keyboard ring sits outside the swatch on the card, so it reads over light and dark colors alike. */
	.sw:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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
		font: 700 var(--fs-xs)/12px var(--f-body);
		text-align: center;
		pointer-events: none;
	}
	.sw.on {
		border-color: var(--accent);
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}
	.nhead {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
		width: 100%;
		text-align: left;
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-3) var(--sp-5);
		min-height: 36px;
		font: 600 var(--fs-sm)/1 var(--f-body);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		cursor: pointer;
	}
	.nhead + .grid {
		margin-top: var(--sp-5);
	}
	.others summary {
		cursor: pointer;
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.others ul {
		list-style: none;
		margin: var(--sp-2) 0 0;
		padding: 0;
		max-height: 112px;
		overflow-y: auto;
		display: grid;
		gap: var(--sp-1);
	}
	.opick {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		width: 100%;
		text-align: left;
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-1) var(--sp-3);
		min-height: 36px;
		cursor: pointer;
		color: inherit;
		font: inherit;
	}
	.why {
		color: var(--muted);
		font-size: var(--fs-xs);
	}
	.mine li.empty {
		border: 0;
		padding: var(--sp-1) 0;
		font-size: var(--fs-sm);
	}
	.mine {
		list-style: none;
		margin: 0 0 var(--sp-3);
		padding: 0;
		display: grid;
		gap: var(--sp-2);
	}
	.mine li {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-1);
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
		gap: var(--sp-5);
		text-align: left;
		background: none;
		border: 0;
		padding: var(--sp-3);
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
	.sp-dot.sm {
		width: 28px;
		height: 28px;
	}
	.ico {
		width: 44px;
		height: 44px;
		flex: none;
		background: none;
		border: 0;
		border-radius: var(--r-lg);
		cursor: pointer;
		font-size: var(--fs-field);
		color: var(--muted);
	}
	.ico:hover,
	.ico:focus-visible {
		background: var(--accent-soft);
		color: var(--ink);
	}
	/* Touch screens wider than a phone (tablets, touch laptops): the same 44 px targets as phones. */
	@media (pointer: coarse) and (min-width: 900px) {
		.sw {
			width: 44px;
			height: 44px;
		}
		.grid {
			grid-template-columns: repeat(auto-fill, 44px);
			gap: var(--sp-3);
		}
		.sp-chip,
		.btn.sm,
		.nhead,
		.opick,
		.searchrow input,
		select {
			min-height: 44px;
		}
	}
	.sheet > :not(.body) {
		flex: none;
	}
	.small {
		font-size: var(--fs-xs);
		margin: 0;
	}
	/* Phones: 44 px touch targets, a roomier swatch grid. */
	@media (max-width: 899px) {
		/* One filter row: types toggle, colors, brands. The brand chips are replaced by the Brand select. */
		.filters {
			flex-wrap: nowrap;
			overflow: visible;
			padding-bottom: 0;
		}
		.filters > * {
			min-width: 0;
			max-width: 100%;
		}
		.filters > select {
			flex: 1 1 0;
			max-width: none;
			padding-inline: var(--sp-3);
			text-overflow: ellipsis;
		}
		.brandsel {
			display: block;
		}
		.brandchips {
			display: none;
		}
		/* The card grows with its content and the page scrolls; nothing is clipped or overflows it. */
		.sheet {
			flex: none;
			padding-bottom: var(--sp-5);
		}
		.body {
			flex: none;
			overflow: visible;
			padding-bottom: 0;
		}
		.sw {
			width: 44px;
			height: 44px;
		}
		.grid {
			grid-template-columns: repeat(auto-fill, 44px);
			gap: var(--sp-3);
		}
		.sp-chip,
		.btn.sm,
		.nhead,
		.opick,
		.searchrow input,
		select {
			min-height: 44px;
		}
		.searchrow input {
			padding: 0 var(--sp-5);
		}
		.sp-dot {
			width: 32px;
			height: 32px;
		}
		.detail {
			min-height: 36px;
		}
	}
	@media (min-width: 900px) {
		.sheet {
			padding: var(--sp-7) var(--sp-8) 0;
		}
		.filters {
			flex-wrap: wrap;
			overflow: visible;
		}
		.brandchips {
			display: contents;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.sw {
			transition: transform 0.08s;
		}
	}
</style>
