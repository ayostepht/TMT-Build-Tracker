<script lang="ts">
	import { placedHull, type ArrangedPlate } from '#lib/domain/arrange.ts';
	import type { PrintFootprint } from '#lib/domain/print-footprint.ts';

	/**
	 * Top view of one arranged plate: the bed, the edge margin and each part's outline
	 * (hull when known, else its box) at its planned position, colored by filament and
	 * labelled. Presentational; y points up on the bed so the SVG flips it.
	 */
	let {
		plate,
		footprints,
		colorOf,
		labelOf
	}: {
		plate: ArrangedPlate;
		footprints: Record<string, PrintFootprint>;
		colorOf: (role: string) => string;
		labelOf: (slug: string) => string;
	} = $props();

	const bed = $derived(plate.bed);
	// extra room around the bed so oversize parts are visible
	const pad = $derived(plate.oversize ? 40 : 6);
	const shapes = $derived(
		plate.items.map((it) => {
			const piece = footprints[it.slug]?.pieces[it.piece];
			const hull = piece?.hull?.length
				? placedHull(piece.hull, it.rotation)
				: ([
						[-it.w / 2, -it.d / 2],
						[it.w / 2, -it.d / 2],
						[it.w / 2, it.d / 2],
						[-it.w / 2, it.d / 2]
					] as [number, number][]);
			// For an oversize part the box can exceed the bed; draw the unrotated footprint box
			const pts = (
				plate.oversize && piece
					? [
							[-piece.w / 2, -piece.d / 2],
							[piece.w / 2, -piece.d / 2],
							[piece.w / 2, piece.d / 2],
							[-piece.w / 2, piece.d / 2]
						]
					: hull
			).map(([x, y]) => `${(it.x + x).toFixed(1)},${(bed.y - (it.y + y)).toFixed(1)}`);
			return { it, points: pts.join(' ') };
		})
	);
	const fit = (t: string, w: number, fs: number) => {
		const max = Math.max(3, Math.floor(w / (fs * 0.55)));
		return t.length > max ? `${t.slice(0, max - 1)}…` : t;
	};
	const big = (w: number, d: number) => w > 34 && d > 22;
	// piece copies of the same part would repeat the label; label the first and the large ones
	const labelled = $derived(
		new Set(
			plate.items
				.map((it, i) => [it, i] as const)
				.filter(
					([it, i]) => big(it.w, it.d) && plate.items.findIndex((x) => x.slug === it.slug) === i
				)
				.map(([, i]) => i)
		)
	);
</script>

<svg
	class="plate-diagram"
	viewBox="{-pad} {-pad} {bed.x + pad * 2} {bed.y + pad * 2}"
	role="img"
	aria-label="Top view of plate {plate.number}: {plate.name}"
	data-testid="plate-diagram"
>
	<rect class="bed" x="0" y="0" width={bed.x} height={bed.y} rx="4" />
	<rect
		class="margin"
		x={bed.margin}
		y={bed.margin}
		width={bed.x - bed.margin * 2}
		height={bed.y - bed.margin * 2}
	/>
	{#each shapes as s, i (i)}
		<polygon
			class="part"
			class:over={plate.oversize}
			points={s.points}
			fill={colorOf(s.it.role)}
			data-slug={s.it.slug}
		/>
		{#if labelled.has(i) || plate.oversize}
			<text
				class="lbl"
				x={s.it.x}
				y={bed.y - s.it.y}
				text-anchor="middle"
				dominant-baseline="middle"
				font-size={Math.max(7, Math.min(16, Math.min(s.it.w, s.it.d) / 3.2))}
				>{fit(
					labelOf(s.it.slug),
					s.it.w,
					Math.max(7, Math.min(16, Math.min(s.it.w, s.it.d) / 3.2))
				)}</text
			>
		{/if}
	{/each}
</svg>

<style>
	.plate-diagram {
		display: block;
		width: 100%;
		max-width: 340px;
		height: auto;
		aspect-ratio: auto;
	}
	.bed {
		fill: rgba(127, 127, 127, 0.08);
		stroke: var(--line);
		stroke-width: 1.5;
	}
	.margin {
		fill: none;
		stroke: var(--line);
		stroke-width: 0.8;
		stroke-dasharray: 3 3;
	}
	.part {
		fill-opacity: 0.55;
		stroke: currentColor;
		stroke-width: 1;
		stroke-linejoin: round;
	}
	.part.over {
		stroke: var(--bad);
		stroke-dasharray: 5 3;
		stroke-width: 1.6;
		fill-opacity: 0.25;
	}
	.lbl {
		fill: currentColor;
		paint-order: stroke;
		stroke: var(--card);
		stroke-width: 2.5px;
		stroke-opacity: 0.7;
		pointer-events: none;
	}
</style>
