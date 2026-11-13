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
			const row = root?.querySelector<HTMLElement>(
				`[data-testid="part-row"][data-slug="${CSS.escape(slug)}"]`
			);
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
							class="prow"
							data-testid="part-row"
							class:on={selected === p.slug}
							data-slug={p.slug}
							aria-pressed={selected === p.slug}
							onclick={() => onselect(p.slug)}
						>
							{#if f}<Swatch hex={f.hex} tpu={f.tpu} size="mini" />{/if}
							<span class="name">{p.name}</span>
							{#if p.locked}<span
									class="pl-lock ds-badge ds-badge--sm"
									data-testid="part-row-locked"
									title="Color locked: a palette leaves it alone"
								>
									<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
										<rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
										<path
											d="M5 7V5a3 3 0 0 1 6 0v2"
											fill="none"
											stroke="currentColor"
											stroke-width="1.6"
											stroke-linecap="round"
										/>
									</svg>Locked</span
								>{/if}
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
		gap: var(--sp-3);
	}
	.phead {
		display: grid;
		gap: var(--sp-3);
		background: var(--paper);
	}
	.top {
		display: flex;
		gap: var(--sp-5);
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}
	h2,
	h3 {
		margin: 0;
	}
	h3 {
		font-size: var(--fs-sm);
		color: var(--muted);
		padding: var(--sp-2) var(--sp-1);
		background: var(--paper);
		position: sticky;
		top: var(--pt, 0px);
		z-index: 2;
	}
	input {
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font-size: var(--fs-base);
		min-width: 0;
		flex: 1 1 160px;
	}
	.pchips {
		display: flex;
		gap: var(--sp-3);
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		padding-bottom: var(--sp-1);
	}
	.pchip {
		flex: none;
		display: inline-flex;
		gap: var(--sp-3);
		align-items: center;
		min-height: 32px;
		padding: var(--sp-2) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--card);
		color: var(--ink);
		font: 500 var(--fs-sm)/1 var(--f-body);
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
		gap: var(--sp-1);
	}
	.prow {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		min-height: 36px;
		padding: var(--sp-2) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--card);
		cursor: pointer;
		/* Keep a scrolled-to row clear of the sticky group header (and the filter row on desktop). */
		scroll-margin-top: calc(var(--pt, 0px) + 34px);
		scroll-margin-bottom: var(--sp-4);
	}
	.prow:hover {
		border-color: var(--accent);
	}
	.prow:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.prow.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.name {
		font-weight: 500;
		font-size: var(--fs-md);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.slotname {
		margin-left: auto;
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.pl-lock {
		flex: none;
		gap: var(--sp-2);
	}
	.tag {
		font: 500 var(--fs-xs)/1 var(--f-mono);
		padding: var(--sp-2) var(--sp-3);
		border-radius: var(--r-sm);
		background: var(--paper);
		border: 1px solid var(--line);
		color: var(--muted);
		white-space: nowrap;
	}
	/* Touch screens (any width): 44 px targets for the filter chips and the part rows. */
	@media (pointer: coarse) {
		.pchip,
		.prow {
			min-height: 44px;
		}
		.pchip {
			min-width: 44px;
			justify-content: center;
		}
		input {
			min-height: 44px;
		}
	}
	/* Desktop: the pane scrolls, so the search + chips and then the group headers stick under the tabs. */
	@media (min-width: 900px) {
		.phead {
			position: sticky;
			top: var(--pt, 0px);
			z-index: 3;
			padding-top: var(--sp-2);
		}
		.pchips {
			flex-wrap: wrap;
			overflow: visible;
		}
		h3 {
			top: calc(var(--pt, 0px) + var(--headh, 0px));
		}
		.prow {
			scroll-margin-top: calc(var(--pt, 0px) + var(--headh, 0px) + 34px);
		}
	}
</style>
