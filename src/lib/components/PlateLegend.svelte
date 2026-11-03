<script lang="ts">
	import type { LegendRow } from '#lib/domain/plate-legend.ts';
	import { edgeColor } from '#lib/domain/silhouette.ts';

	/**
	 * Legend of a plate diagram: number, filament swatch, part name and copies. Rows are
	 * buttons: hover or focus highlights the part in the diagram, a click pins it.
	 */
	let {
		rows,
		colorOf,
		active = null,
		pinned = null,
		onactive,
		onselect
	}: {
		rows: LegendRow[];
		colorOf: (role: string) => string;
		active?: string | null;
		pinned?: string | null;
		onactive?: (slug: string | null) => void;
		onselect?: (slug: string) => void;
	} = $props();
</script>

<ul class="legend" data-testid="plate-legend">
	{#each rows as r (r.slug)}
		{@const c = colorOf(r.role)}
		<li>
			<button
				type="button"
				class="row"
				class:on={active === r.slug}
				aria-pressed={pinned === r.slug}
				data-legend={r.slug}
				data-testid="legend-row"
				onpointerenter={() => onactive?.(r.slug)}
				onpointerleave={() => onactive?.(null)}
				onfocus={() => onactive?.(r.slug)}
				onblur={() => onactive?.(null)}
				onclick={() => onselect?.(r.slug)}
			>
				<span class="n num" aria-hidden="true">{r.n}</span>
				<span class="sw" style="background:{c};border-color:{edgeColor(c)}" aria-hidden="true"
				></span>
				<span class="txt">
					<span class="name">{r.label}</span>
					{#if r.reoriented}
						<span class="note turned" data-testid="legend-reoriented"
							><span
								class="tag"
								title="Does not fit the bed in its usual orientation, so it is turned onto another face: {r.reoriented}. Check supports in your slicer."
								>re-oriented</span
							>
							{r.reoriented}</span
						>
					{/if}
					{#if r.tilted != null}
						<span class="note"
							><span class="tag" title="Turned {r.tilted}° so it fits the bed diagonally"
								>tilted {Math.round(r.tilted)}°</span
							></span
						>
					{/if}
					{#if r.approx}
						<span class="note"
							><span
								class="tag approx"
								title="No exact outline: shown as a box. Import print geometry for exact shapes."
								>approx.</span
							></span
						>
					{/if}
				</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 6px 8px;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
		min-height: 36px;
	}
	.row:hover,
	.row.on {
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.row[aria-pressed='true'] {
		border-color: var(--accent);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.n {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		border: 1.5px solid #1b2033;
		color: #1b2033;
		font: 700 12px/1 var(--f-body);
		margin-top: 1px;
	}
	.sw {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid;
		margin-top: 4px;
	}
	.txt {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.note {
		justify-self: start;
		font-size: 12px;
		color: var(--muted);
		line-height: 1.35;
	}
	.tag {
		display: inline-block;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--warn-soft);
		color: var(--warn);
		font-weight: 600;
		font-size: 11px;
		line-height: 17px;
	}
	.tag.approx {
		background: var(--line);
		color: var(--muted);
	}
</style>
