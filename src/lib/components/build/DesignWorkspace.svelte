<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { filamentStats } from '#lib/domain/index.ts';
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

	type Tab = 'slots' | 'palettes' | 'parts';
	const ALL_TABS: { id: Tab; label: string }[] = [
		{ id: 'slots', label: 'Slots' },
		{ id: 'palettes', label: 'Palettes' },
		{ id: 'parts', label: 'Parts' }
	];
	const TABS = ALL_TABS;
	let root = $state<HTMLElement>();
	/** Embedded on desktop: height left below the workspace's top edge (minus the wizard's bar). */
	let fill = $state('');
	$effect(() => {
		if (!embedded || !root) return;
		const el = root;
		const measure = () => {
			if (!window.matchMedia('(min-width: 900px)').matches) {
				fill = '';
				return;
			}
			const top = el.getBoundingClientRect().top + window.scrollY;
			fill = `${Math.max(480, Math.round(window.innerHeight - top - 84))}px`;
		};
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});
	let tab = $state<Tab>('slots');
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
		// On phones the sheet covers the lower half: bring the 3D view up so the recolor stays visible.
		if (window.matchMedia('(max-width: 899px)').matches)
			document.querySelector('.stagebox')?.scrollIntoView({ block: 'start' });
	}

	function setTab(t: Tab) {
		tab = t;
		if (t === 'palettes') paletteSeen = true;
		else preview = null;
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
	style={fill ? `--fill:${fill}` : undefined}
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
		</div>
		{#if preview}
			<p
				class="banner prev"
				role="status"
				data-testid="preview-banner"
				data-hexes={Object.entries(preview.slots)
					.map(([k, v]) => `${k}:${v.hex}`)
					.join(',')}
			>
				Previewing <b>{preview.label}</b>. Not saved yet.
				<button type="button" class="btn sm" onclick={() => (preview = null)}>Stop</button>
			</p>
		{/if}
	</div>

	<div class="panel">
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
			class="tabs"
			role="tablist"
			aria-label="Design panel"
			style="grid-template-columns:repeat({TABS.length}, 1fr)"
		>
			{#each TABS as t (t.id)}
				<button
					type="button"
					role="tab"
					id="tab-{t.id}"
					aria-selected={tab === t.id}
					aria-controls="tabpanel-{t.id}"
					class="tab"
					onclick={() => setTab(t.id)}>{t.label}</button
				>
			{/each}
		</div>

		<div role="tabpanel" id="tabpanel-slots" aria-labelledby="tab-slots" hidden={tab !== 'slots'}>
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
			<div
				role="tabpanel"
				id="tabpanel-palettes"
				aria-labelledby="tab-palettes"
				hidden={tab !== 'palettes'}
			>
				<PalettePanel view={ctx.view} {preview} onpreview={(p) => (preview = p)} />
			</div>
		{/if}

		<div
			class="partsTab"
			role="tabpanel"
			id="tabpanel-parts"
			aria-labelledby="tab-parts"
			hidden={tab !== 'parts'}
		>
			{#if roleFilter}
				<p class="muted filt">
					Showing only the parts in the {live.filaments.find((f) => f.key === roleFilter)?.name ??
						'selected'}
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

		<SaveDesign
			snapshot={ctx.view.model ? () => stage!.snapshot({ width: 800, height: 600 }) : undefined}
		/>

		{#if !embedded}
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
		title="Change {pickerSlot.name}"
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
		display: grid;
		gap: 16px;
		align-items: start;
	}
	.panel {
		display: grid;
		gap: 16px;
		min-width: 0;
	}
	.stagebox {
		height: 55vh;
		min-height: 260px;
	}
	.prev {
		margin: 8px 0 0;
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
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
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
		padding: 4px;
		background: var(--accent-soft);
		border-radius: 10px;
		position: sticky;
		top: 0;
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
	[role='tabpanel'] {
		display: grid;
		gap: 16px;
		min-width: 0;
	}
	[role='tabpanel'][hidden] {
		display: none;
	}
	.filt {
		margin: 0;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	@media (min-width: 900px) {
		.design {
			grid-template-columns: minmax(0, 1.25fr) minmax(340px, 1fr);
		}
		.stagecol {
			position: sticky;
			top: 12px;
		}
		.stagebox {
			height: min(72vh, 720px);
		}
		.tabs {
			top: 4px;
		}
	}
	/* Inside the setup wizard: stage first (~50vh on phones), panel scrolls on its own on desktop. */
	.design.embedded {
		padding-bottom: 16px;
	}
	.design.embedded .stagebox {
		height: 50vh;
		height: 50dvh;
	}
	@media (min-width: 900px) {
		.design.embedded {
			grid-template-columns: minmax(0, 1.5fr) minmax(340px, 1fr);
			height: var(--fill, 70vh);
			padding-bottom: 0;
			align-items: stretch;
		}
		.design.embedded .stagecol {
			position: static;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}
		.design.embedded .stagebox {
			height: auto;
			flex: 1;
			min-height: 0;
		}
		.design.embedded .panel {
			display: flex;
			flex-direction: column;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
			padding: 0 6px 24px 0;
			scrollbar-gutter: stable;
		}
		.design.embedded .panel > *:not(.never) {
			flex: none;
		}
		.design.embedded .tabs {
			margin: 0;
		}
	}
</style>
