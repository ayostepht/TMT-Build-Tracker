<script lang="ts">
	import { roleLabel, sortRoles } from '#lib/domain/labels.ts';
	import type { BuildView, PartDef } from '#lib/domain/types.ts';
	import Swatch from '#lib/components/Swatch.svelte';

	let {
		view,
		selected = null,
		noPreview = [] as string[],
		roleFilter = $bindable<string | null>(null),
		visible = true,
		onselect
	}: {
		view: BuildView;
		selected?: string | null;
		/** Parts that cannot be seen in the 3D view (no model, not placed, not in the GLB). */
		noPreview?: string[];
		/** Only parts in this slot (set from the chips or from the Colors tab). */
		roleFilter?: string | null;
		/** The list is on screen (its tab is open): the selected row is scrolled into view then. */
		visible?: boolean;
		onselect: (slug: string) => void;
	} = $props();

	let q = $state('');
	let root = $state<HTMLElement>();
	let headH = $state(0);

	const needle = $derived(q.trim().toLowerCase());
	const matches = (p: PartDef) =>
		!needle || `${p.name} ${p.section}`.toLowerCase().includes(needle);

	const groups = $derived.by(() => {
		const by: Record<string, PartDef[]> = {};
		for (const p of view.parts) {
			if (roleFilter && p.role !== roleFilter) continue;
			if (!matches(p)) continue;
			(by[p.section] ??= []).push(p);
		}
		const order = view.build.sections;
		return Object.entries(by).sort(
			([a], [b]) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)
		);
	});
	/** Slots that have parts, with how many match the search (so the chips stay honest). */
	const chips = $derived(
		sortRoles(
			view.filaments.filter((f) => view.parts.some((p) => p.role === f.key)),
			(f) => f.key
		).map((f) => ({
			f,
			n: view.parts.filter((p) => p.role === f.key && matches(p)).length
		}))
	);
	const slot = (role: string) => view.filaments.find((f) => f.key === role);

	// Bring the selected row into view inside the pane (never scrolls past the sticky headers:
	// rows carry a scroll-margin for them).
	$effect(() => {
		const slug = selected;
		if (!slug || !visible || !root) return;
		queueMicrotask(() => {
			const row = root?.querySelector<HTMLElement>(`button.row[data-slug="${CSS.escape(slug)}"]`);
			if (row && row.offsetParent) row.scrollIntoView({ block: 'nearest' });
		});
	});
</script>

<section class="parts" aria-label="Parts" bind:this={root} style="--headh:{headH}px">
	<div class="phead" bind:clientHeight={headH}>
		<div class="top">
			<h2>Parts</h2>
			<input
				type="search"
				placeholder="Find a part"
				aria-label="Find a part"
				bind:value={q}
				autocomplete="off"
			/>
		</div>
		<div class="pchips" role="group" aria-label="Show parts in slot">
			<button
				type="button"
				class="pchip"
				aria-pressed={roleFilter === null}
				data-filter="all"
				onclick={() => (roleFilter = null)}>All</button
			>
			{#each chips as { f, n } (f.key)}
				<button
					type="button"
					class="pchip"
					aria-pressed={roleFilter === f.key}
					data-filter={f.key}
					onclick={() => (roleFilter = roleFilter === f.key ? null : f.key)}
				>
					<Swatch hex={f.hex} tpu={f.tpu} size="mini" />
					{roleLabel(f.key, f)}
					<span class="muted">{n}</span>
				</button>
			{/each}
		</div>
	</div>
	{#each groups as [section, parts] (section)}
		<div class="pgroup">
			<h3>{section}</h3>
			<ul>
				{#each parts as p (p.slug)}
					{@const f = slot(p.role)}
					<li>
						<button
							type="button"
							class="row"
							class:on={selected === p.slug}
							data-slug={p.slug}
							aria-pressed={selected === p.slug}
							onclick={() => onselect(p.slug)}
						>
							{#if f}<Swatch hex={f.hex} tpu={f.tpu} size="mini" />{/if}
							<span class="name">{p.name}</span>
							{#if noPreview.includes(p.slug)}<span class="tag">no 3D preview</span>{/if}
							<span class="muted slotname">{roleLabel(p.role, f)}</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="muted">No parts match.</p>
	{/each}
</section>

<style>
	.parts {
		display: grid;
		gap: 6px;
	}
	.phead {
		display: grid;
		gap: 6px;
		background: var(--paper);
	}
	.top {
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	h2,
	h3 {
		margin: 0;
	}
	h3 {
		font-size: 13px;
		color: var(--muted);
		padding: 4px 2px;
		background: var(--paper);
		position: sticky;
		top: var(--pt, 0px);
		z-index: 2;
	}
	input {
		padding: 7px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		color: var(--ink);
		font-size: 15px;
		min-width: 0;
		flex: 1 1 160px;
	}
	.pchips {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 2px;
	}
	.pchip {
		flex: none;
		display: inline-flex;
		gap: 6px;
		align-items: center;
		min-height: 32px;
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--card);
		color: var(--ink);
		font: 500 13px/1 var(--f-body);
		cursor: pointer;
	}
	.pchip:hover {
		border-color: var(--accent);
	}
	.pchip[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.pchip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.row {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		display: flex;
		gap: 8px;
		align-items: center;
		min-height: 36px;
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--card);
		cursor: pointer;
		/* Keep a scrolled-to row clear of the sticky group header (and the filter row on desktop). */
		scroll-margin-top: calc(var(--pt, 0px) + 34px);
		scroll-margin-bottom: 8px;
	}
	.row:hover {
		border-color: var(--accent);
	}
	.row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.row.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.name {
		font-weight: 500;
		font-size: 14px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.slotname {
		margin-left: auto;
		font-size: 12px;
		white-space: nowrap;
	}
	.tag {
		font: 500 10px/1 var(--f-mono);
		padding: 3px 5px;
		border-radius: 4px;
		background: var(--paper);
		border: 1px solid var(--line);
		color: var(--muted);
		white-space: nowrap;
	}
	/* Desktop: the pane scrolls, so the search + chips and then the group headers stick under the tabs. */
	@media (min-width: 900px) {
		.phead {
			position: sticky;
			top: var(--pt, 0px);
			z-index: 3;
			padding-top: 4px;
		}
		.pchips {
			flex-wrap: wrap;
			overflow: visible;
		}
		h3 {
			top: calc(var(--pt, 0px) + var(--headh, 0px));
		}
		.row {
			scroll-margin-top: calc(var(--pt, 0px) + var(--headh, 0px) + 34px);
		}
	}
</style>
