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
		generateTargets,
		paletteSlots,
		resolvePalette,
		type CatalogSwatches,
		type Harmony,
		type PaletteTargets,
		type ResolvedPalette,
		type SlotKey
	} from '#lib/domain/palettes.ts';
	import { loadCatalog, loadPreferredBrand, savePreferredBrand } from '#lib/client/swatches.ts';

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
	let brand = $state('');
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
	let base = $state('#1e88e5');
	let harmony = $state<Harmony>('complementary');
	let shuffle = $state(0);

	onMount(() => {
		brand = loadPreferredBrand();
		const p = view.filaments.find((f) => f.key === 'primary');
		if (p && isHex(p.hex)) base = normHex(p.hex);
		loadCatalog(view.build.organizationId).then(
			(c) => (catalog = c),
			() => (failed = true)
		);
	});

	const brands = $derived.by(() => {
		if (!catalog) return [];
		return [...new Set([...catalog.petg, ...catalog.tpu].map((t) => t[0]))].sort((a, b) =>
			a.localeCompare(b)
		);
	});

	const slotMap = $derived(paletteSlots(view.filaments));
	const resolvedPremade = $derived.by(() => {
		const c = catalog;
		if (!c) return {} as Record<string, ResolvedPalette | undefined>;
		return Object.fromEntries(
			PALETTES.map((p) => [p.id, resolvePalette(p.targets, c, { brand })])
		) as Record<string, ResolvedPalette | undefined>;
	});
	const generated = $derived.by(
		(): { targets: PaletteTargets; resolved: ResolvedPalette } | null => {
			if (!catalog || !isHex(base)) return null;
			const targets = generateTargets(base, harmony, shuffle);
			return { targets, resolved: resolvePalette(targets, catalog, { brand }) };
		}
	);
	const harmonyLabel = $derived(HARMONIES.find((h) => h.id === harmony)?.label ?? '');

	function previewOf(id: string, label: string, r: ResolvedPalette): PalettePreview {
		const slots: Record<string, PickedFilament> = {};
		for (const s of SLOTS) {
			const key = slotMap[s];
			const m = r[s];
			if (key && m) slots[key] = { name: m.name, material: m.material, hex: m.hex };
		}
		return { id, label, slots };
	}

	// A previewed palette follows its inputs: theme, base color, shuffle, brand (generated) and the
	// preferred brand (ready-made). The base color is debounced so dragging the picker stays smooth.
	$effect(() => {
		const cur = preview;
		if (!cur) return;
		let next: PalettePreview | null = null;
		if (cur.id === 'gen') {
			if (generated) next = previewOf('gen', `${harmonyLabel} from ${base}`, generated.resolved);
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
			cur.id === 'gen' ? 150 : 0
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
		<label class="brand">
			<span class="muted">Prefer brand</span>
			<select
				aria-label="Preferred brand"
				value={brand}
				onchange={(e) => {
					brand = e.currentTarget.value;
					savePreferredBrand(brand);
				}}
			>
				<option value="">Any brand</option>
				{#each brands as b (b)}<option value={b}>{b}</option>{/each}
			</select>
		</label>
	</div>
	<p class="muted intro">
		A palette fills the primary, accent, soft and tire slots with the closest real filaments from
		the catalog{missing.length
			? ` (this build has no ${missing.map((m) => SLOT_LABEL[m]).join(', ')} slot)`
			: ''}. Preview it in 3D first; nothing is saved until you apply.
	</p>
	{#if failed}
		<p class="muted" role="alert">The filament catalog could not be loaded.</p>
	{:else if !catalog}
		<p class="muted">Loading the filament catalog…</p>
	{/if}

	{#if generated}
		<div class="card gen" data-testid="generator">
			<h3>Build one from a color</h3>
			<div class="base">
				<input type="color" aria-label="Base color" bind:value={base} />
				<input
					type="text"
					class="hexin"
					aria-label="Base color hex"
					maxlength="7"
					value={base}
					onchange={(e) => {
						const v = normHex(e.currentTarget.value);
						if (isHex(v)) {
							base = v;
							shuffle = 0;
						} else e.currentTarget.value = base;
					}}
				/>
				<div class="quick" role="group" aria-label="Quick base colors">
					{#each QUICK as q (q)}
						<button
							type="button"
							class="qs"
							class:on={base === q}
							style="background-color:{q}"
							aria-label="Base {q}"
							onclick={() => {
								base = q;
								shuffle = 0;
							}}
						></button>
					{/each}
				</div>
			</div>
			<div class="chips" role="group" aria-label="Theme">
				{#each HARMONIES as h (h.id)}
					<button
						type="button"
						class="chip"
						aria-pressed={harmony === h.id}
						title={h.hint}
						onclick={() => {
							harmony = h.id;
							shuffle = 0;
						}}>{h.label}</button
					>
				{/each}
			</div>
			{@render card(
				`gen`,
				`${harmonyLabel} from ${base}`,
				`Generated · ${harmonyLabel}`,
				generated.resolved,
				generated.targets
			)}
			<div>
				<button type="button" class="btn sm" onclick={() => shuffle++}>Shuffle</button>
				<span class="muted small">Another take on the same color and theme.</span>
			</div>
		</div>

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
	targets: PaletteTargets
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
						<span class="muted small">{SLOT_LABEL[s]}</span>
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
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 13px;
	}
	.brand select {
		max-width: 170px;
	}
	.gen {
		gap: 10px;
	}
	.base {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.base input[type='color'] {
		width: 48px;
		height: 38px;
		padding: 0;
	}
	.hexin {
		width: 92px;
		font-family: var(--f-mono);
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
