<script lang="ts" module>
	import type { PickedFilament } from './SwatchPicker.svelte';
	/** A palette being previewed in the 3D view: role key → filament. Nothing is saved. */
	export type PalettePreview = { id: string; label: string; slots: Record<string, PickedFilament> };
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { BuildView } from '#lib/domain/types.ts';
	import { updateFilament } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import { toasts } from '#lib/components/toast.svelte.ts';
	import { isHex, normHex } from '#lib/domain/color.ts';
	import {
		HARMONIES,
		PALETTES,
		SLOTS,
		SLOT_LABEL,
		paletteSlots,
		paletteVariations,
		resolvePalette,
		type CatalogSwatches,
		type Harmony,
		type LockedTargets,
		type PaletteTargets,
		type ResolvedPalette,
		type SlotKey
	} from '#lib/domain/palettes.ts';
	import { loadCatalog, loadPreferredBrands, savePreferredBrands } from '#lib/client/swatches.ts';

	let {
		view,
		preview,
		onpreview
	}: {
		view: BuildView;
		preview: PalettePreview | null;
		onpreview: (p: PalettePreview | null) => void;
	} = $props();

	const ctx = getBuildCtx();
	const canEdit = $derived(view.canEdit);

	let catalog = $state<CatalogSwatches | null>(null);
	let failed = $state(false);
	let preferred = $state<string[]>([]);
	let busy = $state(false);

	// Generator
	const QUICK = [
		'#e53935',
		'#fb8c00',
		'#fdd835',
		'#43a047',
		'#00acc1',
		'#1e88e5',
		'#3949ab',
		'#8e24aa',
		'#ec407a',
		'#6d4c41',
		'#546e7a',
		'#212121'
	];
	const PAGE_SIZE = 6;
	/** Order in which a quick color fills the Auto slots. */
	const FILL_ORDER: SlotKey[] = ['primary', 'accent', 'soft', 'tire'];
	/** What the tiles show and edit; `settled` follows it (debounced while dragging the picker). */
	let locked = $state<LockedTargets>({});
	let settled = $state<LockedTargets>({});
	let selected = $state<SlotKey | null>(null);
	let theme = $state<Harmony | 'all'>('all');
	let pages = $state(1);
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function setLocked(next: LockedTargets, immediate = true) {
		locked = next;
		clearTimeout(settleTimer);
		if (immediate) settled = next;
		else settleTimer = setTimeout(() => (settled = next), 150);
	}
	function lockSlot(slot: SlotKey, hex: string, immediate = true) {
		setLocked({ ...locked, [slot]: normHex(hex) }, immediate);
	}
	function clearSlot(slot: SlotKey) {
		const next = { ...locked };
		delete next[slot];
		setLocked(next);
		if (selected === slot) selected = null;
	}
	/** A quick swatch fills the selected slot, else the next Auto one (Primary when all are set). */
	function quickPick(hex: string) {
		const slot = selected ?? FILL_ORDER.find((s) => !locked[s]) ?? 'primary';
		lockSlot(slot, hex);
		selected = null;
	}
	const currentHex = (slot: SlotKey): string | null => {
		const key = slotMap[slot];
		const h = key ? view.filaments.find((f) => f.key === key)?.hex : undefined;
		return h && isHex(h) ? normHex(h) : null;
	};

	onMount(() => {
		preferred = loadPreferredBrands();
		const p = view.filaments.find((f) => f.key === 'primary');
		if (p && isHex(p.hex)) setLocked({ primary: normHex(p.hex) });
		loadCatalog(view.build.organizationId).then(
			(c) => (catalog = c),
			() => (failed = true)
		);
		return () => clearTimeout(settleTimer);
	});

	const allBrands = $derived.by(() => {
		if (!catalog) return [];
		return [...new Set([...catalog.petg, ...catalog.tpu].map((t) => t[0]))].sort((a, b) =>
			a.localeCompare(b)
		);
	});

	function setPreferred(next: string[]) {
		preferred = next;
		savePreferredBrands(next);
	}

	const slotMap = $derived(paletteSlots(view.filaments));
	const resolvedPremade = $derived.by(() => {
		const c = catalog;
		if (!c) return {} as Record<string, ResolvedPalette | undefined>;
		return Object.fromEntries(
			PALETTES.map((p) => [p.id, resolvePalette(p.targets, c, { brands: preferred })])
		) as Record<string, ResolvedPalette | undefined>;
	});

	// resolvePalette is CIEDE2000 over the catalog: remember results per targets and brand.
	let memo: Record<string, ResolvedPalette> = {};
	let memoSize = 0;
	function resolveMemo(c: CatalogSwatches, t: PaletteTargets): ResolvedPalette {
		const key = `${preferred.join('|')}#`;
		const k2 = `${key}|${SLOTS.map((s) => t[s]).join(',')}`;
		let r = memo[k2];
		if (!r) {
			if (memoSize > 300) {
				memo = {};
				memoSize = 0;
			}
			r = resolvePalette(t, c, { brands: preferred });
			memo[k2] = r;
			memoSize++;
		}
		return r;
	}

	const lockedHexes = $derived(FILL_ORDER.map((s) => settled[s]).filter((h): h is string => !!h));
	const lockedSlots = $derived(FILL_ORDER.filter((s) => settled[s]));
	const variations = $derived.by(() => {
		const c = catalog;
		if (!c) return null;
		const harmonies = theme === 'all' ? undefined : [theme];
		const want = PAGE_SIZE * pages;
		const all = paletteVariations(settled, want + 1, 0, harmonies);
		return {
			hasMore: all.length > want,
			items: all.slice(0, want).map((v) => ({
				...v,
				label: v.label,
				full: lockedHexes.length ? `${v.label} · ${lockedHexes.join(' + ')}` : v.label,
				resolved: resolveMemo(c, v.targets)
			}))
		};
	});

	function previewOf(id: string, label: string, r: ResolvedPalette): PalettePreview {
		const slots: Record<string, PickedFilament> = {};
		for (const s of SLOTS) {
			const key = slotMap[s];
			const m = r[s];
			if (key && m) slots[key] = { name: m.name, material: m.material, hex: m.hex };
		}
		return { id, label, slots };
	}

	// A previewed palette follows its inputs: locked colors, brand (generated) and the preferred
	// brand (ready-made). The locked colors settle debounced, so dragging the picker stays smooth.
	// A previewed variation that no longer exists (theme changed) stops the preview.
	$effect(() => {
		const cur = preview;
		if (!cur) return;
		let next: PalettePreview | null = null;
		if (cur.id.startsWith('gen:')) {
			if (!variations) return;
			const v = variations.items.find((x) => `gen:${x.id}` === cur.id);
			if (!v) {
				untrack(() => onpreview(null));
				return;
			}
			next = previewOf(cur.id, v.full, v.resolved);
		} else {
			const r = resolvedPremade[cur.id];
			if (r) next = previewOf(cur.id, cur.label, r);
		}
		if (
			!next ||
			(next.label === cur.label && JSON.stringify(next.slots) === JSON.stringify(cur.slots))
		)
			return;
		const n = next;
		const timer = setTimeout(
			() => {
				if (untrack(() => preview?.id) === n.id) onpreview(n);
			},
			cur.id.startsWith('gen:') ? 150 : 0
		);
		return () => clearTimeout(timer);
	});
	const togglePreview = (id: string, label: string, r: ResolvedPalette) =>
		onpreview(preview?.id === id ? null : previewOf(id, label, r));

	async function apply(id: string, label: string, r: ResolvedPalette) {
		const next = previewOf(id, label, r);
		const before = view.filaments
			.filter((f) => next.slots[f.key])
			.map((f) => ({ key: f.key, name: f.name, material: f.material, hex: f.hex }));
		if (!before.length) {
			ctx.error = 'This build has no slots a palette can fill.';
			return;
		}
		busy = true;
		onpreview(next); // keep showing it until the saved view arrives
		const ok = await ctx.act(async () => {
			for (const [key, v] of Object.entries(next.slots)) await updateFilament(ctx.id, key, v);
		});
		onpreview(null);
		busy = false;
		if (ok)
			toasts.push(`Applied ${label}`, {
				label: 'Undo',
				run: async () => {
					await ctx.act(async () => {
						for (const b of before)
							await updateFilament(ctx.id, b.key, {
								name: b.name,
								material: b.material,
								hex: b.hex
							});
					});
				}
			});
	}

	const missing = $derived(SLOTS.filter((s) => !slotMap[s]));
</script>

<section class="pal" aria-label="Palettes">
	<div class="head">
		<h2>Palettes</h2>
		<details class="brand" data-testid="brand-pref">
			<summary
				aria-label="Preferred brands: {preferred.length ? preferred.join(', ') : 'Any brand'}"
			>
				<span class="muted">Prefer brand</span>
				<b
					>{preferred.length === 0
						? 'Any brand'
						: preferred.length === 1
							? preferred[0]
							: `${preferred[0]} +${preferred.length - 1}`}</b
				>
			</summary>
			<div class="bpop" role="group" aria-label="Preferred brands">
				<button
					type="button"
					class="chip"
					aria-pressed={preferred.length === 0}
					onclick={() => setPreferred([])}>Any brand</button
				>
				<ul>
					{#each allBrands as b (b)}
						<li>
							<label>
								<input
									type="checkbox"
									checked={preferred.includes(b)}
									onchange={(e) =>
										setPreferred(
											e.currentTarget.checked ? [...preferred, b] : preferred.filter((x) => x !== b)
										)}
								/>
								{b}
							</label>
						</li>
					{/each}
				</ul>
			</div>
		</details>
	</div>
	<p class="muted intro">
		A palette fills the primary, accent, soft and tire slots with the closest real filaments from
		the catalog{missing.length
			? ` (this build has no ${missing.map((m) => SLOT_LABEL[m]).join(', ')} slot)`
			: ''}. Pick the colors you want to keep and the rest is filled in for you, with several
		variations to choose from. Preview one in 3D first; nothing is saved until you apply.
	</p>
	{#if failed}
		<p class="muted" role="alert">The filament catalog could not be loaded.</p>
	{:else if !catalog}
		<p class="muted">Loading the filament catalog…</p>
	{/if}

	{#if variations}
		<div class="card gen" data-testid="generator">
			<h3>Build one from your colors</h3>
			<div class="yours" role="group" aria-label="Your colors">
				<span class="kicker">Your colors</span>
				<div class="tiles">
					{#each FILL_ORDER as s (s)}
						{@const hexv = locked[s]}
						{@const cur = currentHex(s)}
						<div class="tile" class:locked={!!hexv} class:sel={selected === s} data-slot={s}>
							<button
								type="button"
								class="tsel"
								aria-pressed={selected === s}
								aria-label="{SLOT_LABEL[s]} slot: {hexv ??
									'Auto'}. Select it to fill it with the next quick color"
								onclick={() => (selected = selected === s ? null : s)}
							>
								<span
									class="tdot"
									class:auto={!hexv}
									class:tpu={s === 'soft' || s === 'tire'}
									style={hexv ? `background-color:${hexv}` : ''}
									aria-hidden="true"
								></span>
								<span class="tname">
									<b>{SLOT_LABEL[s]}</b>
									<span class="muted small">{hexv ?? 'Auto'}</span>
								</span>
							</button>
							<div class="tctl">
								<input
									type="color"
									aria-label="{SLOT_LABEL[s]} color"
									value={hexv ?? cur ?? '#808080'}
									oninput={(e) => lockSlot(s, e.currentTarget.value, false)}
									onchange={(e) => lockSlot(s, e.currentTarget.value)}
								/>
								<input
									type="text"
									class="hexin"
									aria-label="{SLOT_LABEL[s]} hex"
									placeholder="Auto"
									maxlength="7"
									value={hexv ?? ''}
									onchange={(e) => {
										const raw = e.currentTarget.value.trim();
										if (!raw) clearSlot(s);
										else if (isHex(normHex(raw))) lockSlot(s, raw);
										else e.currentTarget.value = hexv ?? '';
									}}
								/>
								{#if hexv}
									<button
										type="button"
										class="x"
										aria-label="Clear {SLOT_LABEL[s]} (back to Auto)"
										onclick={() => clearSlot(s)}>×</button
									>
								{/if}
							</div>
							<button
								type="button"
								class="linkbtn"
								disabled={!cur || cur === hexv}
								aria-label="Use current {SLOT_LABEL[s]} filament color"
								title={cur ? `Lock to this build's ${cur}` : 'This build has no such slot'}
								onclick={() => cur && lockSlot(s, cur)}>Use current</button
							>
						</div>
					{/each}
				</div>
			</div>
			<div class="quick" role="group" aria-label="Quick colors">
				{#each QUICK as q (q)}
					<button
						type="button"
						class="qs"
						class:on={FILL_ORDER.some((s) => locked[s] === q)}
						style="background-color:{q}"
						aria-label="Color {q}"
						title={selected ? `Fill ${SLOT_LABEL[selected]}` : 'Fill the next Auto slot'}
						onclick={() => quickPick(q)}
					></button>
				{/each}
			</div>
			<div class="chips" role="group" aria-label="Theme">
				<button
					type="button"
					class="chip"
					aria-pressed={theme === 'all'}
					title="Variations across every theme"
					onclick={() => {
						theme = 'all';
						pages = 1;
					}}>All themes</button
				>
				{#each HARMONIES as h (h.id)}
					<button
						type="button"
						class="chip"
						aria-pressed={theme === h.id}
						title={h.hint}
						onclick={() => {
							theme = h.id;
							pages = 1;
						}}>{h.label}</button
					>
				{/each}
			</div>
		</div>

		<h3>Variations</h3>
		<div class="list" data-testid="variations">
			{#each variations.items as v (v.id)}
				<div class="card pc" data-variation={v.id}>
					<div class="pname">
						<b>{v.label}</b>
						<span class="muted"
							>{lockedSlots.length
								? `Your ${lockedSlots.map((s) => SLOT_LABEL[s]).join(', ')}; the rest auto-filled.`
								: 'All colors auto-filled.'}</span
						>
					</div>
					{@render card(`gen:${v.id}`, v.full, null, v.resolved, v.targets, lockedSlots)}
				</div>
			{/each}
		</div>
		{#if variations.hasMore}
			<div>
				<button type="button" class="btn sm" onclick={() => pages++}>More variations</button>
			</div>
		{:else if !variations.items.length}
			<p class="muted">No variations for these colors.</p>
		{/if}

		<h3>Ready-made</h3>
		<div class="list">
			{#each PALETTES as p (p.id)}
				{@const r = resolvedPremade[p.id]}
				{#if r}
					<div class="card pc" data-palette={p.id}>
						<div class="pname"><b>{p.name}</b><span class="muted">{p.description}</span></div>
						{@render card(p.id, p.name, null, r, p.targets)}
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</section>

{#snippet card(
	id: string,
	label: string,
	title: string | null,
	r: ResolvedPalette,
	targets: PaletteTargets,
	yours: SlotKey[] = []
)}
	<div class="pcard" class:previewing={preview?.id === id}>
		{#if title}<b class="gtitle">{title}</b>{/if}
		<ul class="chosen" aria-label="Matched filaments">
			{#each SLOTS as s (s)}
				{@const m = r[s as SlotKey]}
				<li title={m ? `Wanted ${targets[s]}, closest ΔE ${m.de.toFixed(1)}` : ''}>
					<span
						class="dot"
						class:tpu={s === 'soft' || s === 'tire'}
						style="background-color:{m?.hex ?? targets[s]}"
						aria-hidden="true"
					></span>
					<span class="lbl">
						<span class="muted small">
							{SLOT_LABEL[s]}
							{#if yours.includes(s)}
								<span class="mine" title="You chose this color" data-testid="yours-{s}">
									<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
										<path
											fill="currentColor"
											d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1m-2 5V4.5a2 2 0 1 1 4 0V6z"
										/>
									</svg>yours</span
								>
							{/if}
						</span>
						<span class="nm">{m?.name ?? 'No match'}</span>
						{#if m?.relaxed && m.relaxedReason}
							<span class="rnote small" data-testid="relaxed-note">{m.relaxedReason}</span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
		<div class="acts">
			<button
				type="button"
				class="btn sm"
				aria-pressed={preview?.id === id}
				onclick={() => togglePreview(id, label, r)}
			>
				{preview?.id === id ? 'Stop preview' : 'Preview'}
			</button>
			{#if canEdit}
				<button
					type="button"
					class="btn primary sm"
					disabled={busy}
					onclick={() => apply(id, label, r)}
				>
					Apply
				</button>
			{/if}
		</div>
	</div>
{/snippet}

<style>
	.pal {
		display: grid;
		gap: 12px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	h2,
	h3 {
		margin: 0;
	}
	.intro {
		margin: 0;
		font-size: 13px;
	}
	.brand {
		position: relative;
		font-size: 13px;
	}
	.brand summary {
		display: flex;
		gap: 6px;
		align-items: center;
		cursor: pointer;
		min-height: 36px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--card);
		list-style: none;
		max-width: 100%;
	}
	.brand summary::-webkit-details-marker {
		display: none;
	}
	.brand summary::after {
		content: '▾';
		color: var(--muted);
	}
	.brand summary b {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 160px;
	}
	.bpop {
		position: absolute;
		right: 0;
		z-index: 20;
		margin-top: 4px;
		width: min(280px, calc(100vw - 32px));
		display: grid;
		gap: 8px;
		padding: 10px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
	}
	.bpop ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow-y: auto;
		display: grid;
	}
	.bpop label {
		display: flex;
		gap: 8px;
		align-items: center;
		min-height: 36px;
		cursor: pointer;
	}
	.bpop .chip {
		justify-self: start;
		cursor: pointer;
	}
	.gen {
		gap: 10px;
	}
	.yours {
		display: grid;
		gap: 6px;
	}
	.yours .kicker {
		margin: 0;
	}
	.tiles {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
	}
	.tile {
		display: grid;
		gap: 6px;
		padding: 8px;
		border: 1px dashed var(--line);
		border-radius: 8px;
		min-width: 0;
	}
	.tile.locked {
		border-style: solid;
	}
	.tile.sel {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.tsel {
		display: flex;
		gap: 8px;
		align-items: center;
		background: none;
		border: 0;
		padding: 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
		font: inherit;
		min-height: 36px;
	}
	.tdot {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		flex: none;
		border: 2px solid var(--line);
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
	}
	.tdot.auto {
		background: repeating-linear-gradient(45deg, var(--line) 0 3px, transparent 3px 7px);
	}
	.tdot.tpu:not(.auto) {
		background-image: repeating-linear-gradient(
			45deg,
			rgba(255, 255, 255, 0.28) 0 3px,
			transparent 3px 7px
		);
	}
	.tname {
		display: grid;
		line-height: 1.2;
		min-width: 0;
	}
	.tctl {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.tctl input[type='color'] {
		width: 40px;
		height: 34px;
		padding: 0;
		flex: none;
	}
	.hexin {
		width: 0;
		flex: 1;
		min-width: 70px;
		font-family: var(--f-mono);
	}
	.x {
		width: 32px;
		height: 32px;
		flex: none;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: none;
		color: inherit;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
	}
	.linkbtn {
		justify-self: start;
		background: none;
		border: 0;
		padding: 2px 0;
		color: var(--accent);
		font: inherit;
		font-size: 12px;
		text-decoration: underline;
		cursor: pointer;
	}
	.linkbtn:disabled {
		color: var(--muted);
		text-decoration: none;
		cursor: default;
	}
	.mine {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		margin-left: 4px;
		padding: 0 5px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 11px;
		line-height: 1.5;
	}
	.quick {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.qs {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 2px solid var(--line);
		padding: 0;
		cursor: pointer;
	}
	.qs.on {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.chip {
		cursor: pointer;
	}
	.list {
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
	}
	.pc {
		gap: 8px;
		padding: 12px;
	}
	.pname {
		display: grid;
		gap: 2px;
	}
	.pname .muted {
		font-size: 13px;
	}
	.pcard {
		display: grid;
		gap: 8px;
		border-radius: 8px;
	}
	.pcard.previewing {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
	}
	.gtitle {
		font-size: 14px;
	}
	.chosen {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px 10px;
	}
	.chosen li {
		display: flex;
		gap: 8px;
		align-items: center;
		min-width: 0;
	}
	.dot {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		flex: none;
		border: 2px solid var(--line);
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
	}
	.dot.tpu {
		background-image: repeating-linear-gradient(
			45deg,
			rgba(255, 255, 255, 0.28) 0 3px,
			transparent 3px 7px
		) !important;
	}
	.lbl {
		display: grid;
		min-width: 0;
		line-height: 1.2;
	}
	.rnote {
		color: var(--muted, inherit);
		font-style: italic;
		line-height: 1.3;
	}
	.nm {
		font-size: 13px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.small {
		font-size: 12px;
	}
	.acts {
		display: flex;
		gap: 8px;
	}
</style>
