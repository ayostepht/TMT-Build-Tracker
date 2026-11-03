<script lang="ts">
	import { page } from '$app/state';
	import { filamentStats } from '#lib/domain/index.ts';
	import { applyPartRole, designColors, hiddenSlugs } from '#lib/domain/design.ts';
	import type { BuildView } from '#lib/domain/types.ts';
	import { setBuildDesign, setVariant } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import VariantChooser from '#lib/components/VariantChooser.svelte';
	import ModelStage from '#lib/components/design/ModelStage.svelte';
	import PartList from '#lib/components/design/PartList.svelte';
	import PartSheet from '#lib/components/design/PartSheet.svelte';
	import SaveDesign from '#lib/components/design/SaveDesign.svelte';
	import SlotPanel from '#lib/components/design/SlotPanel.svelte';

	const ctx = getBuildCtx();

	let selected = $state<string | null>(null);
	let bothSides = $state(true);
	let roleFilter = $state<string | null>(null);
	/** slug → role the user just chose, shown at once while the save is in flight. */
	let pending = $state<Record<string, string>>({});
	let ready = $state<{ rendered: string[]; unplaced: string[] } | null>(null);
	let stage = $state<ReturnType<typeof ModelStage>>();

	// The view with the user's not-yet-saved moves applied: drives 3D colors, totals and lists.
	const live = $derived.by((): BuildView => {
		const v = ctx.view;
		if (!Object.keys(pending).length) return v;
		const ov = <T extends { slug: string; role: string }>(p: T): T =>
			pending[p.slug] ? { ...p, role: pending[p.slug] } : p;
		return { ...v, parts: v.parts.map(ov), allParts: v.allParts.map(ov) };
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

	function pick(slug: string | null) {
		selected = slug;
		if (slug && typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches) {
			queueMicrotask(() =>
				document.querySelector('[data-testid="part-sheet"]')?.scrollIntoView({ block: 'nearest' })
			);
		}
	}
</script>

<svelte:head><title>Design · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<div class="design">
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
			/>
		</div>
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

		<SlotPanel view={live} {stats} activeRole={roleFilter} onfilter={(r) => (roleFilter = r)} />

		<PartList
			view={live}
			{selected}
			{noPreview}
			{roleFilter}
			onselect={(slug) => {
				pick(slug);
				stage?.focus(slug);
			}}
		/>

		{#if ctx.view.variantGroups.length}
			<section class="card" aria-label="Variant options">
				<h2>Options</h2>
				<p class="muted">Switching an option updates the 3D view, the part list and the totals.</p>
				<VariantChooser
					groups={ctx.view.variantGroups}
					choices={ctx.view.variantChoices}
					partNames={Object.fromEntries(ctx.view.allParts.map((p) => [p.slug, p.name]))}
					disabled={!ctx.canEdit}
					onselect={(group, option) => ctx.act(() => setVariant(ctx.id, group, option))}
				/>
			</section>
		{/if}

		<SaveDesign
			snapshot={ctx.view.model ? () => stage!.snapshot({ width: 800, height: 600 }) : undefined}
		/>
	</div>
</div>

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
	.hint {
		margin: 0;
	}
	h2 {
		margin: 0;
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
	}
</style>
