<script lang="ts">
	import { filamentLabel } from '#lib/domain/labels.ts';
	import type { BuildView, PartDef } from '#lib/domain/types.ts';
	import Swatch from '#lib/components/Swatch.svelte';

	let {
		view,
		selected = null,
		noPreview = [] as string[],
		roleFilter = null,
		onselect
	}: {
		view: BuildView;
		selected?: string | null;
		/** Parts that cannot be seen in the 3D view (no model, not placed, not in the GLB). */
		noPreview?: string[];
		roleFilter?: string | null;
		onselect: (slug: string) => void;
	} = $props();

	let q = $state('');

	const groups = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		const by: Record<string, PartDef[]> = {};
		for (const p of view.parts) {
			if (roleFilter && p.role !== roleFilter) continue;
			if (needle && !`${p.name} ${p.section}`.toLowerCase().includes(needle)) continue;
			(by[p.section] ??= []).push(p);
		}
		const order = view.build.sections;
		return Object.entries(by).sort(
			([a], [b]) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999)
		);
	});
	const slot = (role: string) => view.filaments.find((f) => f.key === role);
</script>

<section class="parts" aria-label="Parts">
	<div class="head">
		<h2>Parts</h2>
		<input
			type="search"
			placeholder="Find a part"
			aria-label="Find a part"
			bind:value={q}
			autocomplete="off"
		/>
	</div>
	{#each groups as [section, parts] (section)}
		<div class="group">
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
							<span class="muted slotname">{filamentLabel(f, p.role)}</span>
							{#if noPreview.includes(p.slug)}<span class="tag">no 3D preview</span>{/if}
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
		gap: 10px;
	}
	.head {
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
		font-size: 15px;
		color: var(--muted);
		margin-bottom: 4px;
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
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.row {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--card);
		cursor: pointer;
		flex-wrap: wrap;
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
	}
	.slotname {
		margin-left: auto;
		font-size: 13px;
	}
	.tag {
		font: 500 11px/1 var(--f-mono);
		padding: 3px 6px;
		border-radius: 4px;
		background: var(--paper);
		border: 1px solid var(--line);
		color: var(--muted);
	}
</style>
