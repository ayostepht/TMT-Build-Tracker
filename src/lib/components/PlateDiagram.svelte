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
			// A re-oriented item carries the outline of its own pose
			const src = it.pose?.hull?.length ? it.pose.hull : piece?.hull;
			const hull = src?.length
				? placedHull(src, it.rotation)
				: ([
						[-it.w / 2, -it.d / 2],
						[it.w / 2, -it.d / 2],
						[it.w / 2, it.d / 2],
						[-it.w / 2, it.d / 2]
					] as [number, number][]);
			// For an oversize part the box can exceed the bed; draw the unrotated footprint box
			const pts = (
				plate.oversize && piece && !it.pose
					? [
							[-piece.w / 2, -piece.d / 2],
							[piece.w / 2, -piece.d / 2],
							[piece.w / 2, piece.d / 2],
							[-piece.w / 2, piece.d / 2]
						]
					: hull
			).map(
				([x, y]) =>
					`${(it.x - (it.ox ?? 0) + x).toFixed(1)},${(bed.y - (it.y - (it.oy ?? 0) + y)).toFixed(1)}`
			);
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
		{#if s.it.pose}
			<g class="badge" data-testid="reoriented-badge" data-slug={s.it.slug}>
				<title>Re-oriented: {s.it.pose.desc}</title>
				<rect x={s.it.x - 22} y={bed.y - s.it.y - s.it.d / 2 + 3} width="44" height="11" rx="3" />
				<text x={s.it.x} y={bed.y - s.it.y - s.it.d / 2 + 11.2} text-anchor="middle"
					>re-oriented</text
				>
			</g>
		{/if}
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
	.badge rect {
		fill: var(--card);
		stroke: currentColor;
		stroke-width: 0.8;
	}
	.badge text {
		fill: currentColor;
		font-size: 7px;
		pointer-events: none;
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
