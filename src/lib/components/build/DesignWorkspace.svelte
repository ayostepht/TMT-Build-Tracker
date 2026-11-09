<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { filamentStats, roleLabel } from '#lib/domain/index.ts';
	import { applyPartRole, designColors, hiddenSlugs } from '#lib/domain/design.ts';
	import type { BuildView } from '#lib/domain/types.ts';
	import { setBuildDesign, setVariant, updateFilament } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import VariantChooser from '#lib/components/VariantChooser.svelte';
	import ModelStage from '#lib/components/design/ModelStage.svelte';
	import PalettePanel, { type PalettePreview } from '#lib/components/design/PalettePanel.svelte';
	import PartList from '#lib/components/design/PartList.svelte';
	import PartSheet from '#lib/components/design/PartSheet.svelte';
	import SaveDesign from '#lib/components/design/SaveDesign.svelte';
	import SlotPanel from '#lib/components/design/SlotPanel.svelte';
	import SwatchPicker, { type PickedFilament } from '#lib/components/design/SwatchPicker.svelte';

	/**
	 * `embedded`: shown inside the setup wizard's Colors step. Same workspace and behaviour; it
	 * only fills the height left under the wizard's step bar (desktop) and drops the "Next" link.
	 */
	let { embedded = false }: { embedded?: boolean } = $props();
	const ctx = getBuildCtx();

	type Tab = 'colors' | 'parts';
	const TABS: { id: Tab; label: string }[] = [
		{ id: 'colors', label: 'Colors' },
		{ id: 'parts', label: 'Parts' }
	];
	let root = $state<HTMLElement>();
	/** Desktop: height left below the workspace top edge (minus the wizard bar, or a small margin on the Design tab). */
	let fill = $state('');
	$effect(() => {
		if (!root) return;
		const el = root;
		const measure = () => {
			if (!window.matchMedia('(min-width: 900px)').matches) {
				fill = '';
				return;
			}
			const top = el.getBoundingClientRect().top + window.scrollY;
			fill = `${Math.max(480, Math.round(window.innerHeight - top - (embedded ? 84 : 16)))}px`;
		};
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});
	/** Height of the build's sticky tab bar (0 in the wizard): the pinned stage sits right under it. */
	let stick = $state(0);
	$effect(() => {
		if (!root) return;
		const nav = embedded ? null : document.querySelector<HTMLElement>('nav.tabs');
		if (!nav) {
			stick = 0;
			return;
		}
		const m = () => (stick = Math.round(nav.getBoundingClientRect().height));
		m();
		const ro = new ResizeObserver(m);
		ro.observe(nav);
		return () => ro.disconnect();
	});
	let tab = $state<Tab>('colors');
	/** Colors mode: the palettes drawer replaces the slot list while open. */
	let palettesOpen = $state(false);
	let paletteSeen = $state(false);
	/** Palette shown in 3D but not saved. */
	let preview = $state<PalettePreview | null>(null);
	/** role → filament the user just picked, shown at once while the save is in flight. */
	let optimistic = $state<Record<string, PickedFilament>>({});
	let picker = $state<{ mode: 'edit'; role: string } | { mode: 'new' } | null>(null);

	let selected = $state<string | null>(null);
	let bothSides = $state(true);
	let roleFilter = $state<string | null>(null);
	/** slug → role the user just chose, shown at once while the save is in flight. */
	let pending = $state<Record<string, string>>({});
	let ready = $state<{ rendered: string[]; unplaced: string[] } | null>(null);
	let stage = $state<ReturnType<typeof ModelStage>>();

	// The view with the user's not-yet-saved changes applied (part moves, picked filaments,
	// a previewed palette): drives 3D colors, totals and lists.
	const live = $derived.by((): BuildView => {
		const v = ctx.view;
		const fil = { ...optimistic, ...(preview?.slots ?? {}) };
		if (!Object.keys(pending).length && !Object.keys(fil).length) return v;
		const ov = <T extends { slug: string; role: string }>(p: T): T =>
			pending[p.slug] ? { ...p, role: pending[p.slug] } : p;
		return {
			...v,
			filaments: v.filaments.map((f) => (fil[f.key] ? { ...f, ...fil[f.key] } : f)),
			parts: v.parts.map(ov),
			allParts: v.allParts.map(ov)
		};
	});
	const colors = $derived(designColors(live));
	const hidden = $derived(hiddenSlugs(live));
	const stats = $derived(filamentStats(live));
	const part = $derived(live.allParts.find((p) => p.slug === selected) ?? null);

	// Parts without a visible 3D counterpart, so the list can say so.
	const noPreview = $derived.by((): string[] => {
		if (!ctx.view.model || !ready) return [];
		const shown = ready.rendered;
		return ctx.view.parts.filter((p) => !shown.includes(p.slug)).map((p) => p.slug);
	});

	function openPicker(p: NonNullable<typeof picker>) {
		picker = p;
		// On phones the stage is pinned above the sheet, so the recolor stays visible without scrolling.
	}

	function setTab(t: Tab) {
		tab = t;
		// Choosing a mode (also re-choosing Colors) returns to its main view and drops any preview.
		palettesOpen = false;
		preview = null;
	}

	function openPalettes() {
		palettesOpen = true;
		paletteSeen = true;
	}

	function closePalettes() {
		palettesOpen = false;
		preview = null;
	}

	/** Arrow keys / Home / End move between the mode tabs (roving tabindex). */
	function tabKey(e: KeyboardEvent) {
		const i = TABS.findIndex((t) => t.id === tab);
		const n =
			e.key === 'ArrowRight'
				? (i + 1) % TABS.length
				: e.key === 'ArrowLeft'
					? (i + TABS.length - 1) % TABS.length
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? TABS.length - 1
							: -1;
		if (n < 0) return;
		e.preventDefault();
		setTab(TABS[n].id);
		document.getElementById(`tab-${TABS[n].id}`)?.focus();
	}

	async function move(role: string) {
		if (!part) return;
		const r = applyPartRole(live, part.slug, role, { bothSides });
		if (!Object.keys(r.changes).length) return;
		pending = { ...pending, ...r.changes };
		await ctx.act(() => setBuildDesign(ctx.id, { partRoles: r.changes }));
		const next = { ...pending };
		for (const [slug, v] of Object.entries(r.changes)) if (next[slug] === v) delete next[slug];
		pending = next;
	}

	async function pickFilament(role: string, v: PickedFilament) {
		optimistic = { ...optimistic, [role]: v };
		await ctx.act(() => updateFilament(ctx.id, role, v));
		if (optimistic[role] === v) {
			const next = { ...optimistic };
			delete next[role];
			optimistic = next;
		}
	}

	async function addSlot(v: PickedFilament) {
		picker = null;
		await ctx.act(() => setBuildDesign(ctx.id, { addRole: v }));
	}

	const pickerSlot = $derived.by(() => {
		const p = picker;
		return p?.mode === 'edit' ? live.filaments.find((f) => f.key === p.role) : undefined;
	});
	// Close the picker if its slot disappears or the user loses edit rights.
	$effect(() => {
		if (picker && (!ctx.canEdit || (picker.mode === 'edit' && !pickerSlot))) picker = null;
	});

	function pick(slug: string | null) {
		// Picking the selected part again toggles it off.
		slug = slug === selected ? null : slug;
		selected = slug;
		// Phones: the stage is pinned, so the model never scrolls away. Only bring the sheet into
		// view if it is off-screen (it has a scroll-margin that clears the pinned stage).
		if (slug && typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches) {
			queueMicrotask(() =>
				document.querySelector('[data-testid="part-sheet"]')?.scrollIntoView({ block: 'nearest' })
			);
		}
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && selected !== null && !picker) selected = null;
	}}
/>

<svelte:head
	>{#if !embedded}<title>Design · {ctx.view.build.name} · TMT Build Tracker</title
		>{/if}</svelte:head
>

<div
	class="design"
	class:embedded
	bind:this={root}
	data-testid="design-workspace"
	style="--stick:{stick}px;{fill ? `--fill:${fill}` : ''}"
>
	<div class="stagecol">
		<div class="stagebox">
			<ModelStage
				bind:this={stage}
				model={ctx.view.model}
				{colors}
				{hidden}
				{selected}
				dimOthers={selected !== null}
				onpick={pick}
				onready={(info) => (ready = info)}
				siteAdmin={page.data.siteAdmin === true}
				addFilesHref={resolve('/(app)/builds/[id]/files', { id: ctx.id }) + '#settings'}
			/>
			{#if preview}
				<p
					class="prev"
					role="status"
					data-testid="preview-banner"
					data-hexes={Object.entries(preview.slots)
						.map(([k, v]) => `${k}:${v.hex}`)
						.join(',')}
				>
					<span>Previewing <b>{preview.label}</b>. Not saved yet.</span>
					<button type="button" class="btn sm" onclick={() => (preview = null)}>Stop</button>
				</p>
			{/if}
		</div>
	</div>

	<div class="panel">
		<div class="tabs" role="tablist" aria-label="Design panel" tabindex="-1" onkeydown={tabKey}>
			{#each TABS as t (t.id)}
				<button
					type="button"
					role="tab"
					id="tab-{t.id}"
					aria-selected={tab === t.id}
					aria-controls="tabpanel-{t.id}"
					tabindex={tab === t.id ? 0 : -1}
					class="tab"
					onclick={() => setTab(t.id)}>{t.label}</button
				>
			{/each}
		</div>

		{#if part}
			<PartSheet
				view={live}
				{part}
				bind:bothSides
				noPreview={noPreview.includes(part.slug)}
				onmove={move}
				onclose={() => (selected = null)}
			/>
		{:else}
			<p class="muted hint">
				{ctx.view.model ? 'Tap a part in the 3D view' : 'Pick a part from the list'} to move it to another
				color slot.
			</p>
		{/if}

		<div
			role="tabpanel"
			id="tabpanel-colors"
			aria-labelledby="tab-colors"
			hidden={tab !== 'colors'}
		>
			<div class="view" hidden={palettesOpen}>
				<div class="palrow">
					<span class="muted">Try a ready-made or generated color scheme.</span>
					<button
						type="button"
						class="btn"
						data-testid="open-palettes"
						aria-expanded={palettesOpen}
						onclick={openPalettes}>Palettes</button
					>
				</div>
				<SlotPanel
					view={live}
					{stats}
					activeRole={roleFilter}
					editingRole={picker?.mode === 'edit' ? picker.role : null}
					onfilter={(r) => {
						roleFilter = r;
						if (r) setTab('parts');
					}}
					onedit={(role) => openPicker({ mode: 'edit', role })}
					onadd={() => openPicker({ mode: 'new' })}
				/>
			</div>

			{#if paletteSeen}
				<div class="view" data-testid="palettes-drawer" hidden={!palettesOpen}>
					<div class="palhead">
						<button type="button" class="btn sm" onclick={closePalettes}>
							<span aria-hidden="true">←</span> Back to colors
						</button>
					</div>
					<PalettePanel view={ctx.view} {preview} onpreview={(p) => (preview = p)} />
				</div>
			{/if}
		</div>

		<div
			class="partsTab"
			role="tabpanel"
			id="tabpanel-parts"
			aria-labelledby="tab-parts"
			hidden={tab !== 'parts'}
		>
			{#if roleFilter}
				<p class="muted filt">
					Showing only the parts in the {roleLabel(
						roleFilter,
						live.filaments.find((f) => f.key === roleFilter)
					)}
					slot.
					<button type="button" class="btn sm" onclick={() => (roleFilter = null)}>Show all</button>
				</p>
			{/if}
			<PartList
				view={live}
				{selected}
				{noPreview}
				{roleFilter}
				onselect={(slug) => {
					pick(slug);
					if (selected) stage?.focus(slug);
				}}
			/>

			{#if ctx.view.variantGroups.length}
				<section class="card" aria-label="Variant options">
					<h2>Options</h2>
					<p class="muted">
						Switching an option updates the 3D view, the part list and the totals.
					</p>
					<VariantChooser
						groups={ctx.view.variantGroups}
						choices={ctx.view.variantChoices}
						partNames={Object.fromEntries(ctx.view.allParts.map((p) => [p.slug, p.name]))}
						disabled={!ctx.canEdit}
						onselect={(group, option) => ctx.act(() => setVariant(ctx.id, group, option))}
					/>
				</section>
			{/if}
		</div>

		{#if !palettesOpen}
			<SaveDesign
				snapshot={ctx.view.model ? () => stage!.snapshot({ width: 800, height: 600 }) : undefined}
			/>
		{/if}

		{#if !embedded && !palettesOpen}
			<section class="next" aria-label="Next steps">
				<a href={resolve('/(app)/builds/[id]/files', { id: ctx.id })} data-testid="next-plates"
					>Next: files and export →</a
				>
			</section>
		{/if}
	</div>
</div>

{#if picker?.mode === 'edit' && pickerSlot}
	<SwatchPicker
		title={roleLabel(pickerSlot.key, pickerSlot)}
		family={pickerSlot.tpu ? 'tpu' : 'petg'}
		current={{ name: pickerSlot.name, material: pickerSlot.material, hex: pickerSlot.hex }}
		slotMaterial={pickerSlot.material}
		organizationId={ctx.view.build.organizationId}
		onpick={(v) => pickFilament(pickerSlot.key, v)}
		onclose={() => (picker = null)}
	/>
{:else if picker?.mode === 'new'}
	<SwatchPicker
		title="Add a color"
		organizationId={ctx.view.build.organizationId}
		mode="new"
		onpick={(v) => addSlot(v)}
		onclose={() => (picker = null)}
	/>
{/if}

<style>
	.design {
		--stageh: clamp(200px, 34vh, 320px);
		display: grid;
		gap: 12px;
		align-items: start;
	}
	.design.embedded {
		padding-bottom: 16px;
	}
	/* Phones: the stage is pinned right under the page's tab bar while the panel scrolls beneath. */
	.stagecol {
		position: sticky;
		top: var(--stick, 0px);
		z-index: 6;
		background: var(--paper);
		padding: 0 0 8px;
	}
	.stagebox {
		position: relative;
		height: var(--stageh);
	}
	.panel {
		display: grid;
		gap: 16px;
		min-width: 0;
	}
	/* "Previewing X" sits on top of the stage so it never moves the layout; the viewer below keeps its touches. */
	.prev {
		position: absolute;
		top: 8px;
		left: 8px;
		right: 8px;
		z-index: 2;
		margin: 0;
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
		padding: 6px 8px 6px 12px;
		font-size: 14px;
		background: var(--card);
		border: 1px solid var(--accent);
		border-radius: 8px;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
		pointer-events: none;
	}
	.prev .btn {
		pointer-events: auto;
		flex: none;
	}
	.hint {
		margin: 0;
	}
	.next {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: center;
	}
	h2 {
		margin: 0;
	}
	.tabs {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 4px;
		padding: 4px;
		background: var(--accent-soft);
		border-radius: 10px;
		position: sticky;
		top: calc(var(--stick, 0px) + var(--stageh) + 8px);
		z-index: 5;
	}
	.tab {
		border: 0;
		background: transparent;
		color: var(--ink);
		font: 600 15px/1 var(--f-body);
		padding: 11px 8px;
		border-radius: 7px;
		cursor: pointer;
	}
	.tab[aria-selected='true'] {
		background: var(--card);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.18);
		color: var(--accent);
	}
	.tab:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	[role='tabpanel'],
	.view {
		display: grid;
		gap: 16px;
		min-width: 0;
	}
	[role='tabpanel'][hidden],
	.view[hidden] {
		display: none;
	}
	.palrow {
		display: flex;
		gap: 10px 14px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.palhead {
		display: flex;
		align-items: center;
	}
	.filt {
		margin: 0;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	/* The part sheet scrolls into view below the pinned stage and tab bar. */
	.panel :global([data-testid='part-sheet']) {
		scroll-margin-top: calc(var(--stick, 0px) + var(--stageh) + 64px);
	}
	/* Desktop: fixed-viewport two panes. The stage fills the left, the panel scrolls on its own. */
	@media (min-width: 900px) {
		.design,
		.design.embedded {
			grid-template-columns: minmax(0, 1fr) minmax(340px, 460px);
			height: var(--fill, 70vh);
			padding-bottom: 0;
			align-items: stretch;
			gap: 16px;
		}
		.stagecol {
			position: static;
			background: none;
			padding: 0;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}
		.stagebox {
			height: auto;
			flex: 1;
			min-height: 0;
		}
		.panel {
			display: flex;
			flex-direction: column;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: 0 6px 24px 0;
			scrollbar-gutter: stable;
		}
		.panel > * {
			flex: none;
		}
		.tabs {
			top: 0;
			margin: 0;
		}
		.panel :global([data-testid='part-sheet']) {
			scroll-margin-top: 0;
		}
	}
</style>
