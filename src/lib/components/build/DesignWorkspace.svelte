<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { filamentStats, roleLabel } from '#lib/domain/index.ts';
	import { applyPartRole, designColors, hiddenSlugs } from '#lib/domain/design.ts';
	import type { BuildView } from '#lib/domain/types.ts';
	import { getArrangement, setBuildDesign, setVariant, updateFilament } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import VariantChooser from '#lib/components/VariantChooser.svelte';
	import ModelStage from '#lib/components/design/ModelStage.svelte';
	import PalettePanel, { type PalettePreview } from '#lib/components/design/PalettePanel.svelte';
	import PartList from '#lib/components/design/PartList.svelte';
	import PartSheet from '#lib/components/design/PartSheet.svelte';
	import DesignActions from '#lib/components/design/share/DesignActions.svelte';
	import SlotPanel from '#lib/components/design/SlotPanel.svelte';
	import SwatchPicker, { type PickedFilament } from '#lib/components/design/SwatchPicker.svelte';
	import { prefetchSwatches } from '#lib/client/swatches.ts';

	/**
	 * `embedded`: shown inside the setup wizard's Colors step. Same workspace and behaviour; it
	 * only fills the height left under the wizard's step bar (desktop) and drops the "Next" link.
	 */
	let { embedded = false }: { embedded?: boolean } = $props();
	const ctx = getBuildCtx();

	type Tab = 'colors' | 'palettes' | 'parts';
	const TABS: { id: Tab; label: string }[] = [
		{ id: 'colors', label: 'Colors' },
		{ id: 'palettes', label: 'Palettes' },
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
	// Warm the catalog while the phone is idle, so the picker and the palettes open without a wait.
	$effect(() => prefetchSwatches());
	let tab = $state<Tab>('colors');
	let paletteSeen = $state(false);
	/** Palette shown in 3D but not saved. */
	let preview = $state<PalettePreview | null>(null);
	/** role → filament the user just picked, shown at once while the save is in flight. */
	let optimistic = $state<Record<string, PickedFilament>>({});
	let picker = $state<{ mode: 'edit'; role: string } | { mode: 'new' } | null>(null);

	let selected = $state<string | null>(null);
	let bothSides = $state(true);
	let roleFilter = $state<string | null>(null);
	let tabsH = $state(0);
	/** Where the selection came from, so closing returns focus there. */
	let origin: 'row' | 'canvas' = 'canvas';
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

	// "Plates and export are out of date": the same server rule Files uses (`arrangement.stale`),
	// shown here for real builds with a printer, where the colour or part change was made.
	let platesStale = $state(false);
	let dismissedKey = $state<string | null>(null);
	const staleKey = $derived(
		JSON.stringify([
			ctx.view.parts.map((p) => [p.slug, p.role]),
			ctx.view.filaments.map((f) => [f.key, f.hex, f.material]),
			ctx.view.plates.map((p) => [p.number, p.parts, p.source]),
			ctx.view.printer
		])
	);
	$effect(() => {
		void staleKey;
		if (embedded || !ctx.canEdit || ctx.view.build.kind !== 'build' || !ctx.view.printer) {
			platesStale = false;
			return;
		}
		getArrangement(ctx.id)
			.then((r) => (platesStale = r.stale))
			.catch(() => {});
	});
	const showStale = $derived(platesStale && dismissedKey !== staleKey);

	function openPicker(p: NonNullable<typeof picker>) {
		picker = p;
		// On phones the stage is pinned above the sheet, so the recolor stays visible without scrolling.
	}

	function setTab(t: Tab) {
		tab = t;
		// Choosing a tab (also re-choosing the current one) drops any un-applied palette preview.
		if (t === 'palettes') paletteSeen = true;
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

	/** Spoken (not shown) confirmation of a color or part change, for screen reader users. */
	let announce = $state('');

	async function move(role: string) {
		if (!part) return;
		const r = applyPartRole(live, part.slug, role, { bothSides });
		if (!Object.keys(r.changes).length) return;
		const to = live.filaments.find((f) => f.key === role);
		const n = Object.keys(r.changes).length;
		announce = `${part.name}${n > 1 ? ` and ${n - 1} matching part${n > 2 ? 's' : ''}` : ''} moved to ${roleLabel(role, to)}`;
		pending = { ...pending, ...r.changes };
		await ctx.act(() => setBuildDesign(ctx.id, { partRoles: r.changes }));
		const next = { ...pending };
		for (const [slug, v] of Object.entries(r.changes)) if (next[slug] === v) delete next[slug];
		pending = next;
	}

	async function pickFilament(role: string, v: PickedFilament) {
		optimistic = { ...optimistic, [role]: v };
		announce = `${roleLabel(
			role,
			live.filaments.find((f) => f.key === role)
		)} is now ${v.name}, ${v.material}`;
		await ctx.act(() => updateFilament(ctx.id, role, v));
		if (optimistic[role] === v) {
			const next = { ...optimistic };
			delete next[role];
			optimistic = next;
		}
	}

	async function addSlot(v: PickedFilament) {
		picker = null;
		announce = `Added a color slot: ${v.name}, ${v.material}`;
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

	function pick(slug: string | null, from: 'row' | 'canvas' = 'canvas') {
		// Picking the selected part again toggles it off.
		slug = slug === selected ? null : slug;
		if (slug) origin = from;
		selected = slug;
	}

	/** Deselect and hand focus back to where the selection started (its list row, else the stage). */
	function closePart() {
		const slug = selected;
		selected = null;
		queueMicrotask(() => {
			const row =
				origin === 'row' && slug
					? document.querySelector<HTMLElement>(
							`[data-testid="part-row"][data-slug="${CSS.escape(slug)}"]`
						)
					: null;
			if (row && row.offsetParent) row.focus();
			else stage?.focusStage();
		});
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && selected !== null && !picker) closePart();
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
	style="--stick:{stick}px;--tabsh:{tabsH}px;{fill ? `--fill:${fill}` : ''}"
>
	<div
		class="sr-only"
		role="status"
		aria-live="polite"
		aria-atomic="true"
		data-testid="design-announce"
	>
		{announce}
	</div>
	<div class="stagecol">
		<div class="stagebox">
			<ModelStage
				bind:this={stage}
				model={ctx.view.model}
				{colors}
				{hidden}
				{selected}
				dimOthers={selected !== null}
				onpick={(s) => pick(s, 'canvas')}
				raised={part !== null}
				onready={(info) => (ready = info)}
				siteAdmin={page.data.siteAdmin === true}
				addFilesHref={resolve('/(app)/builds/[id]/files', { id: ctx.id }) + '#settings'}
			/>
			{#if part}
				<div class="chipwrap">
					<PartSheet
						view={live}
						{part}
						bind:bothSides
						noPreview={noPreview.includes(part.slug)}
						onmove={move}
						onclose={closePart}
					/>
				</div>
			{/if}
			{#if preview}
				<p
					class="prev"
					class:low={part !== null}
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

	<div class="panel" class:picking={picker !== null}>
		<!-- Swatch picker (round 2): fills the panel while open, the rest of the panel is hidden (see .picking). -->
		{#if picker?.mode === 'edit' && pickerSlot}
			<div class="pickhost">
				<SwatchPicker
					title={roleLabel(pickerSlot.key, pickerSlot)}
					family={pickerSlot.tpu ? 'tpu' : 'petg'}
					current={{ name: pickerSlot.name, material: pickerSlot.material, hex: pickerSlot.hex }}
					slotMaterial={pickerSlot.material}
					organizationId={ctx.view.build.organizationId}
					onpick={(v) => pickFilament(pickerSlot.key, v)}
					onclose={() => (picker = null)}
				/>
			</div>
		{:else if picker?.mode === 'new'}
			<div class="pickhost">
				<SwatchPicker
					title="Add a color"
					organizationId={ctx.view.build.organizationId}
					mode="new"
					onpick={(v) => addSlot(v)}
					onclose={() => (picker = null)}
				/>
			</div>
		{/if}
		{#if showStale}
			<div class="stalenote" role="status" data-testid="design-stale">
				<span>Plates and export are out of date for these colors.</span>
				<span class="stale-actions">
					<a
						class="btn sm go"
						href={resolve('/(app)/builds/[id]/files', { id: ctx.id })}
						data-testid="design-stale-review"
						>Review plates in Files <span class="btn-arrow" aria-hidden="true">→</span></a
					>
					<button
						type="button"
						class="btn sm ghost"
						data-testid="design-stale-dismiss"
						onclick={() => (dismissedKey = staleKey)}>Dismiss</button
					>
				</span>
			</div>
		{/if}
		<DesignActions
			{embedded}
			snapshot={ctx.view.model ? () => stage!.snapshot({ width: 800, height: 600 }) : undefined}
		/>
		<div
			class="ds-seg ds-seg--fill dw-tabs"
			role="tablist"
			aria-label="Design panel"
			tabindex="-1"
			onkeydown={tabKey}
			bind:offsetHeight={tabsH}
		>
			{#each TABS as t (t.id)}
				<button
					type="button"
					role="tab"
					id="tab-{t.id}"
					aria-selected={tab === t.id}
					aria-controls="tabpanel-{t.id}"
					tabindex={tab === t.id ? 0 : -1}
					onclick={() => setTab(t.id)}>{t.label}</button
				>
			{/each}
		</div>

		{#if tab !== 'palettes'}
			<p class="muted hint">
				{#if part}
					Pick a slot in the part card to move {part.name}.
				{:else}
					{ctx.view.model
						? 'Tap a part in the 3D view, or pick one in the Parts tab,'
						: 'Pick a part from the list'} to move it to another color slot.
				{/if}
			</p>
		{/if}

		<div
			role="tabpanel"
			id="tabpanel-colors"
			aria-labelledby="tab-colors"
			hidden={tab !== 'colors'}
		>
			<div class="view">
				<button type="button" class="btn ghost sm step-aside" onclick={() => setTab('palettes')}
					>Try a palette <span class="btn-arrow" aria-hidden="true">→</span></button
				>
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
		</div>

		<div
			role="tabpanel"
			id="tabpanel-palettes"
			aria-labelledby="tab-palettes"
			data-testid="palettes-drawer"
			hidden={tab !== 'palettes'}
		>
			{#if paletteSeen}
				<PalettePanel view={ctx.view} {preview} onpreview={(p) => (preview = p)} />
			{/if}
		</div>

		<div
			class="partsTab"
			role="tabpanel"
			id="tabpanel-parts"
			aria-labelledby="tab-parts"
			hidden={tab !== 'parts'}
		>
			<PartList
				view={live}
				{selected}
				{noPreview}
				bind:roleFilter
				visible={tab === 'parts'}
				onselect={(slug) => {
					pick(slug, 'row');
					if (selected) stage?.focus(slug);
				}}
			/>

			{#if ctx.view.variantGroups.length}
				<section class="ds-card" aria-label="Variant options">
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

		{#if !embedded && tab !== 'palettes'}
			<section class="step-next" aria-label="Next steps">
				<a
					class="btn go"
					href={resolve('/(app)/builds/[id]/files', { id: ctx.id })}
					data-testid="next-plates"
					>Next: Files &amp; export <span class="btn-arrow" aria-hidden="true">→</span></a
				>
			</section>
		{/if}
	</div>
</div>

<style>
	.design {
		--stageh: clamp(200px, 34vh, 320px);
		display: grid;
		gap: var(--sp-6);
		align-items: start;
	}
	.design.embedded {
		padding-bottom: calc(16px + var(--bottom-bar-h, 0px));
	}
	/* Phones: the stage is pinned right under the page's tab bar while the panel scrolls beneath. */
	.stagecol {
		position: sticky;
		top: var(--stick, 0px);
		z-index: 6;
		background: var(--paper);
		padding: 0 0 var(--sp-4);
	}
	.stagebox {
		position: relative;
		height: var(--stageh);
	}
	.panel {
		display: grid;
		gap: var(--sp-8);
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
		gap: var(--sp-5);
		align-items: center;
		justify-content: space-between;
		padding: var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-6);
		font-size: var(--fs-md);
		background: var(--card);
		border: 1px solid var(--accent);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-1);
		pointer-events: none;
	}
	.prev .btn {
		pointer-events: auto;
		flex: none;
	}
	.hint {
		margin: 0;
	}
	.stalenote {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4) var(--sp-6);
		align-items: center;
		justify-content: space-between;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--r-lg);
		background: var(--warn-soft);
		color: var(--warn);
		font-size: var(--fs-md);
		font-weight: 600;
		min-width: 0;
	}
	.stale-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
	h2 {
		margin: 0;
	}
	.dw-tabs {
		position: sticky;
		top: calc(var(--stick, 0px) + var(--stageh) + 8px);
		z-index: 5;
	}
	@media (pointer: coarse) {
		.dw-tabs > button {
			min-height: 44px;
		}
	}
	.dw-tabs > button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	[role='tabpanel'],
	.view {
		display: grid;
		gap: var(--sp-8);
		min-width: 0;
	}
	[role='tabpanel'][hidden] {
		display: none;
	}
	/* The part chip floats over the bottom of the stage (above the credit line). Only its own box
	   takes pointer events, so canvas touches around it still pick and orbit. */
	.chipwrap {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: 26px;
		z-index: 3;
		display: flex;
		pointer-events: none;
	}
	.chipwrap > :global(*) {
		pointer-events: auto;
		flex: 1 1 auto;
	}
	.prev.low {
		top: 48px;
		right: 8px;
	}
	/* Sticky offsets for the parts list: just under the (sticky) tab bar. */
	.partsTab {
		--pt: calc(var(--stick, 0px) + var(--stageh) + 8px + var(--tabsh, 52px) + 4px);
	}
	/* Swatch picker: replaces the panel content while open. Phones: fills the area under the pinned stage. */
	.panel.picking > :global(:not(.pickhost)) {
		display: none;
	}
	.pickhost {
		display: flex;
		flex-direction: column;
		height: max(
			320px,
			calc(100dvh - var(--stick, 0px) - var(--stageh) - 24px - var(--bottom-bar-h, 0px))
		);
		min-height: 0;
		min-width: 0;
		/* The page can scroll past the picker, so its last row is never behind the build's bottom tab bar. */
		margin-bottom: var(--bottom-bar-h, 0px);
	}
	/* Desktop: fixed-viewport two panes. The stage fills the left, the panel scrolls on its own. */
	@media (min-width: 900px) {
		.design,
		.design.embedded {
			grid-template-columns: minmax(0, 1fr) minmax(340px, 460px);
			height: var(--fill, 70vh);
			padding-bottom: 0;
			align-items: stretch;
			gap: var(--sp-8);
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
			padding: 0 var(--sp-3) var(--sp-10) 0;
			scrollbar-gutter: stable;
		}
		.panel > * {
			flex: none;
		}
		.panel > .pickhost {
			flex: 1 1 auto;
			height: auto;
		}
		.panel.picking {
			overflow: hidden;
		}
		.dw-tabs {
			top: 0;
		}
		.partsTab {
			--pt: calc(var(--tabsh, 52px) + 4px);
		}
	}
</style>
