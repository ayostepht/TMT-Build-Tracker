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
	/** The "Build from your colors" disclosure; variations are only computed while it is open. */
	let genOpen = $state(false);
	/** Roving tabindex: the one card per list that is a tab stop (arrow keys move between cards). */
	let readyFocus = $state(0);
	let varFocus = $state(0);

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
		if (!c || !(genOpen || untrack(() => preview?.id.startsWith('gen:')))) return null;
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

	/** Commit the palette currently shown in the 3D preview. */
	async function apply(next: PalettePreview) {
		const label = next.label;
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

	const cancel = () => onpreview(null);

	/** The previewed palette's filaments per role, for the action bar. */
	const previewRows = $derived.by(() => {
		if (!preview) return [];
		return SLOTS.map((s) => {
			const key = slotMap[s];
			const f = key ? preview.slots[key] : undefined;
			return f ? { slot: s, name: f.name, hex: f.hex } : null;
		}).filter((x): x is { slot: SlotKey; name: string; hex: string } => !!x);
	});

	/** Arrow keys / Home / End move between the cards of one list (roving tabindex). */
	function rove(e: KeyboardEvent, setFocus: (i: number) => void) {
		const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
		if (!keys.includes(e.key)) return;
		const cards = [
			...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-card]')
		];
		const at = cards.indexOf(document.activeElement as HTMLElement);
		if (at < 0) return;
		e.preventDefault();
		const to =
			e.key === 'Home'
				? 0
				: e.key === 'End'
					? cards.length - 1
					: Math.min(
							cards.length - 1,
							Math.max(0, at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1))
						);
		setFocus(to);
		cards[to].focus();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="pal"
	aria-label="Palettes"
	onkeydown={(e) => {
		if (e.key === 'Escape' && preview && !busy) cancel();
	}}
>
	<div class="phead">
		<h2>Palettes</h2>
		<details class="brandpick" data-testid="brand-pref">
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
		Tap a palette to preview it in 3D; nothing is saved until you apply.{missing.length
			? ` This build has no ${missing.map((m) => SLOT_LABEL[m]).join(', ')} slot.`
			: ''}
	</p>
	{#if failed}
		<p class="muted" role="alert">The filament catalog could not be loaded.</p>
	{:else if !catalog}
		<p class="muted">Loading the filament catalog…</p>
	{:else}
		<div
			class="list"
			role="group"
			aria-label="Ready-made palettes"
			onkeydown={(e) => rove(e, (i) => (readyFocus = i))}
		>
			{#each PALETTES as p, i (p.id)}
				{@const r = resolvedPremade[p.id]}
				{#if r}
					{@render card(
						p.id,
						p.name,
						p.name,
						r,
						p.targets,
						[],
						i === readyFocus,
						() => (readyFocus = i),
						{
							'data-palette': p.id
						}
					)}
				{/if}
			{/each}
		</div>

		<details class="gen" data-testid="generator-toggle" bind:open={genOpen}>
			<summary>
				<span>Build from your colors</span>
				<span class="muted small">Pick colors, fill the rest</span>
			</summary>
			{#if variations}
				<div class="genbody" data-testid="generator">
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
										<button
											type="button"
											class="ibtn"
											disabled={!cur || cur === hexv}
											aria-label="Use current {SLOT_LABEL[s]} filament color"
											title={cur ? `Lock to this build's ${cur}` : 'This build has no such slot'}
											onclick={() => cur && lockSlot(s, cur)}>↺</button
										>
										<button
											type="button"
											class="ibtn"
											disabled={!hexv}
											aria-label="Clear {SLOT_LABEL[s]} (back to Auto)"
											onclick={() => clearSlot(s)}>×</button
										>
									</div>
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
								aria-label="Color {q}"
								title={selected ? `Fill ${SLOT_LABEL[selected]}` : 'Fill the next Auto slot'}
								onclick={() => quickPick(q)}><span style="background-color:{q}"></span></button
							>
						{/each}
					</div>
					<div class="chips themes" role="group" aria-label="Theme">
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

					<h3>Variations</h3>
					<p class="muted small sub">
						{lockedSlots.length
							? `Your ${lockedSlots.map((s) => SLOT_LABEL[s]).join(', ')}; the rest auto-filled.`
							: 'All colors auto-filled.'}
					</p>
					<div
						class="list"
						role="group"
						aria-label="Variations"
						data-testid="variations"
						onkeydown={(e) => rove(e, (i) => (varFocus = i))}
					>
						{#each variations.items as v, i (v.id)}
							{@render card(
								`gen:${v.id}`,
								v.full,
								v.label,
								v.resolved,
								v.targets,
								lockedSlots,
								i === varFocus,
								() => (varFocus = i),
								{ 'data-variation': v.id }
							)}
						{/each}
					</div>
					{#if variations.hasMore}
						<div>
							<button type="button" class="btn sm morebtn" onclick={() => pages++}
								>More variations</button
							>
						</div>
					{:else if !variations.items.length}
						<p class="muted">No variations for these colors.</p>
					{/if}
				</div>
			{/if}
		</details>
	{/if}

	{#if preview}
		<div class="pbar" role="region" aria-label="Palette preview" data-testid="palette-bar">
			<div class="binfo">
				<p class="bt" role="status">
					<span class="muted small">Previewing</span>
					<b>{preview.label}</b>
				</p>
				<ul class="brows" aria-label="Filaments in this palette">
					{#each previewRows as row (row.slot)}
						<li title="{SLOT_LABEL[row.slot]}: {row.name}">
							<span
								class="bd"
								class:tpu={row.slot === 'soft' || row.slot === 'tire'}
								style="background-color:{row.hex}"
							></span>
							<span class="sr">{SLOT_LABEL[row.slot]}: </span><span class="bn">{row.name}</span>
						</li>
					{/each}
				</ul>
			</div>
			<div class="bacts">
				<button type="button" class="btn" disabled={busy} onclick={cancel}>Cancel</button>
				{#if canEdit}
					<button type="button" class="btn primary" disabled={busy} onclick={() => apply(preview!)}>
						Apply
					</button>
				{/if}
			</div>
		</div>
	{/if}
</section>

{#snippet card(
	id: string,
	label: string,
	name: string,
	r: ResolvedPalette,
	targets: PaletteTargets,
	yours: SlotKey[],
	tab: boolean,
	onfocus: () => void,
	hook: Record<string, string>
)}
	<button
		type="button"
		class="pcard"
		class:on={preview?.id === id}
		aria-pressed={preview?.id === id}
		tabindex={tab ? 0 : -1}
		data-card
		{...hook}
		{onfocus}
		onclick={() => togglePreview(id, label, r)}
	>
		<span class="pname"><b>{name}</b></span>
		<span class="dots">
			{#each SLOTS as s (s)}
				{@const m = r[s as SlotKey]}
				<span
					class="dotw"
					title={m
						? `${SLOT_LABEL[s]}: ${m.name}${yours.includes(s) ? ' (your color)' : ''}${m.relaxed && m.relaxedReason ? `. ${m.relaxedReason}` : ''}`
						: ''}
				>
					<span
						class="pdot"
						class:tpu={s === 'soft' || s === 'tire'}
						class:relaxed={m?.relaxed}
						style="background-color:{m?.hex ?? targets[s]}"
						aria-hidden="true"
					></span>
					{#if yours.includes(s)}
						<span class="mine" data-testid="yours-{s}" aria-hidden="true">
							<svg viewBox="0 0 16 16" width="8" height="8">
								<path
									fill="currentColor"
									d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1m-2 5V4.5a2 2 0 1 1 4 0V6z"
								/>
							</svg>
						</span>
					{/if}
					<span class="sr-only">
						{SLOT_LABEL[s]}{yours.includes(s) ? ' (your color)' : ''}:
						<span class="nm">{m?.name ?? 'No match'}</span>
						{#if m?.relaxed && m.relaxedReason}
							<span data-testid="relaxed-note">{m.relaxedReason}</span>
						{/if}
					</span>
				</span>
			{/each}
		</span>
	</button>
{/snippet}

<style>
	.pal {
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	.phead {
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
	h3 {
		font-size: 15px;
	}
	.intro,
	.sub {
		margin: 0;
		font-size: 13px;
	}
	.brandpick {
		position: relative;
		font-size: 13px;
	}
	.brandpick summary {
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
	.brandpick summary::-webkit-details-marker {
		display: none;
	}
	.brandpick summary::after {
		content: '▾';
		color: var(--muted);
	}
	.brandpick summary b {
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
		min-height: 44px;
		cursor: pointer;
	}
	.bpop .chip {
		justify-self: start;
		cursor: pointer;
		min-height: 36px;
	}

	/* ---- palette cards ---- */
	.list {
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
	}
	.pcard {
		display: grid;
		gap: 8px;
		align-content: space-between;
		text-align: left;
		min-height: 64px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--card);
		color: inherit;
		font: inherit;
		cursor: pointer;
		min-width: 0;
	}
	.pcard:hover {
		border-color: var(--muted);
	}
	.pcard.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.pname {
		min-width: 0;
		font-size: 14px;
		line-height: 1.25;
	}
	.pname b {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pcard.on .pname b::before {
		content: '✓ ';
		color: var(--accent);
	}
	.dots {
		display: flex;
		gap: 6px;
	}
	.dotw {
		position: relative;
		display: inline-flex;
	}
	.pdot {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 2px solid var(--line);
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
		flex: none;
	}
	.pdot.relaxed {
		border-style: dashed;
		border-color: var(--muted);
	}
	.pdot.tpu,
	.bd.tpu {
		background-image: repeating-linear-gradient(
			45deg,
			rgba(255, 255, 255, 0.28) 0 3px,
			transparent 3px 7px
		) !important;
	}
	.mine {
		position: absolute;
		right: -3px;
		bottom: -3px;
		display: grid;
		place-items: center;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--card);
		border: 1px solid var(--line);
		color: var(--ink);
	}
	.small {
		font-size: 12px;
	}

	/* phone: one compact row per palette */
	@media (max-width: 640px) {
		.list {
			grid-template-columns: 1fr;
			gap: 6px;
		}
		.pcard {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			min-height: 48px;
			padding: 6px 12px;
		}
		.brandpick summary {
			min-height: 44px;
		}
	}

	/* ---- generator ---- */
	.gen {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--card);
	}
	.gen > summary {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
		min-height: 44px;
		padding: 10px 12px;
		cursor: pointer;
		font-weight: 600;
		list-style: none;
	}
	.gen > summary::-webkit-details-marker {
		display: none;
	}
	.gen > summary::before {
		content: '▸';
		margin-right: 6px;
		color: var(--muted);
	}
	.gen[open] > summary::before {
		content: '▾';
	}
	.gen > summary > span:first-child {
		flex: 1;
	}
	.genbody {
		display: grid;
		gap: 10px;
		padding: 0 12px 12px;
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
		gap: 6px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr));
	}
	.tile {
		display: flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
		padding: 4px 8px;
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
		color: inherit;
		font: inherit;
		min-height: 44px;
		flex: 1 1 96px;
		min-width: 0;
	}
	.tdot {
		width: 22px;
		height: 22px;
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
		font-size: 13px;
	}
	.tctl {
		display: flex;
		gap: 4px;
		align-items: center;
		flex: 0 1 auto;
	}
	.tctl input[type='color'] {
		width: 44px;
		height: 44px;
		padding: 2px;
		flex: none;
	}
	.hexin {
		width: 78px;
		min-height: 44px;
		font-family: var(--f-mono);
		font-size: 13px;
	}
	.ibtn {
		width: 44px;
		height: 44px;
		flex: none;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: none;
		color: inherit;
		font-size: 18px;
		line-height: 1;
	}
	.ibtn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.quick {
		display: flex;
		gap: 0;
		flex-wrap: wrap;
	}
	.qs {
		width: 36px;
		height: 36px;
		padding: 0;
		border: 0;
		background: none;
		display: grid;
		place-items: center;
	}
	.qs span {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid var(--line);
	}
	.qs.on span {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.themes .chip {
		cursor: pointer;
		min-height: 36px;
	}
	.morebtn {
		min-height: 36px;
	}
	@media (max-width: 640px) {
		.qs {
			width: 44px;
			height: 44px;
		}
		.themes {
			flex-wrap: nowrap;
			overflow-x: auto;
			padding-bottom: 4px;
		}
		.themes .chip {
			flex: none;
			min-height: 44px;
		}
		.morebtn {
			min-height: 44px;
		}
		.hexin {
			width: 70px;
		}
	}

	/* ---- sticky Apply / Cancel bar ---- */
	.pbar {
		position: sticky;
		bottom: 0;
		z-index: 15;
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
		background: var(--card);
		border: 1px solid var(--accent);
		border-radius: 12px;
		box-shadow: 0 -4px 18px rgb(0 0 0 / 0.14);
	}
	.binfo {
		display: grid;
		gap: 2px;
		min-width: 0;
		flex: 1 1 180px;
	}
	.bt {
		margin: 0;
		display: flex;
		gap: 6px;
		align-items: baseline;
		min-width: 0;
	}
	.bt b {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.brows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0 10px;
		font-size: 12px;
	}
	.brows li {
		display: flex;
		gap: 5px;
		align-items: center;
		min-width: 0;
	}
	.bd {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
		border: 1px solid var(--line);
	}
	.bn {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (max-width: 640px) {
		.brows {
			display: none;
		}
		.binfo {
			flex-basis: 120px;
		}
	}
	.bacts {
		display: flex;
		gap: 8px;
	}
	.bacts .btn {
		min-height: 44px;
		min-width: 88px;
	}
</style>
