<script lang="ts">
	import type { ArrangedPlate } from '#lib/domain/arrange.ts';
	import type { LegendRow } from '#lib/domain/plate-legend.ts';
	import { layoutBadges } from '#lib/domain/badge-layout.ts';
	import {
		edgeColor,
		placeRings,
		ringsToPath,
		roundedRectPath,
		type Silhouette
	} from '#lib/domain/silhouette.ts';
	import type { PrintFootprint } from '#lib/domain/print-footprint.ts';

	/**
	 * Top view of one arranged plate, drawn like a slicer's plate preview: a textured build
	 * plate with a grid, each part as its real outline (holes included) in its filament color
	 * with a soft shadow, and a numbered badge on every piece. The
	 * numbers match the legend next to it. Badges scale to their part; parts too small for one
	 * get it beside them on a thin leader (copies close together share one), see `badge-layout`.
	 * A small arrow arc around a badge marks a part rotated flat on the bed. Pieces without a known mesh are drawn as dashed
	 * rounded boxes ("approximate"). Presentational; bed y points up, so the SVG flips it.
	 */
	let {
		plate,
		footprints,
		silhouettes = {},
		rows,
		colorOf,
		active = null,
		onactive,
		onselect
	}: {
		plate: ArrangedPlate;
		footprints: Record<string, PrintFootprint>;
		silhouettes?: Record<string, Silhouette>;
		rows: LegendRow[];
		colorOf: (role: string) => string;
		/** Slug of the highlighted part (hover or pinned from the legend). */
		active?: string | null;
		onactive?: (slug: string | null) => void;
		onselect?: (slug: string) => void;
	} = $props();

	const uid = $props.id();
	const bed = $derived(plate.bed);
	// extra room around the bed so oversize parts are visible; labels live in the bottom strip
	const pad = $derived(plate.oversize ? 40 : 7);
	const footer = 15;
	const scale = $derived(Math.max(1, Math.max(bed.x, bed.y) / 256));
	const numberOf = $derived(new Map(rows.map((r) => [r.slug, r])));

	const grid = $derived.by(() => {
		let minor = '';
		let major = '';
		for (let x = 10; x < bed.x; x += 10)
			if (x % 50 === 0) major += `M${x} 0V${bed.y}`;
			else minor += `M${x} 0V${bed.y}`;
		for (let y = 10; y < bed.y; y += 10) {
			const sy = bed.y - y;
			if (y % 50 === 0) major += `M0 ${sy}H${bed.x}`;
			else minor += `M0 ${sy}H${bed.x}`;
		}
		return { minor, major };
	});

	const shapes = $derived(
		plate.items.map((it, i) => {
			const sil = it.sil ? silhouettes[it.sil] : undefined;
			const piece = footprints[it.slug]?.pieces[it.piece];
			// For an oversize part the box can exceed the bed: draw it unrotated
			const flat = plate.oversize;
			const rot = flat ? 0 : it.rotation;
			const dx = it.x - (flat ? 0 : (it.ox ?? 0));
			const dy = it.y - (flat ? 0 : (it.oy ?? 0));
			let d: string;
			let pole: [number, number];
			let inr: number;
			let rings: [number, number][][];
			if (sil) {
				const placed = placeRings(sil.rings, rot, dx, dy);
				d = ringsToPath(placed, bed.y);
				rings = placed.map((rg) => rg.map(([x, y]) => [x, bed.y - y] as [number, number]));
				const p = placeRings([[sil.pole]], rot, dx, dy)[0][0];
				pole = [p[0], bed.y - p[1]];
				inr = sil.r;
			} else {
				const w = flat && piece ? piece.w : it.w;
				const dd = flat && piece ? piece.d : it.d;
				d = roundedRectPath(it.x, bed.y - it.y, w, dd);
				pole = [it.x, bed.y - it.y];
				inr = Math.min(w, dd) / 2;
				rings = [
					[
						[it.x - w / 2, bed.y - it.y - dd / 2],
						[it.x + w / 2, bed.y - it.y - dd / 2],
						[it.x + w / 2, bed.y - it.y + dd / 2],
						[it.x - w / 2, bed.y - it.y + dd / 2]
					]
				];
			}
			const color = colorOf(it.role);
			const row = numberOf.get(it.slug);
			return {
				i,
				it,
				d,
				pole,
				inr,
				rings,
				color,
				edge: edgeColor(color),
				approx: !sil,
				n: row?.n ?? 0,
				name: row?.name ?? it.slug,
				rotated: it.rotation % 90 !== 0
			};
		})
	);
	const rMin = $derived(5 * scale);
	const badges = $derived.by(() => {
		const m = plate.oversize ? pad - 1 : 1;
		return layoutBadges(
			shapes.map((s) => ({
				id: s.i,
				slug: s.it.slug,
				pole: s.pole,
				inr: s.inr,
				rings: s.rings
			})),
			{
				rMin,
				rMax: 8.5 * scale,
				bounds: { x0: -m, y0: -m, x1: bed.x + m, y1: bed.y + m }
			}
		).map((b) => {
			const its = b.ids.map((i) => shapes[i]);
			const rotated = its.find((s) => s.rotated);
			const row = numberOf.get(b.slug);
			return {
				...b,
				n: row?.n ?? 0,
				rotated: rotated ? Math.round(rotated.it.rotation) : null
			};
		});
	});
	const arc = (r: number) => {
		// 240 degree arc with an arrow head, drawn just outside a badge of radius r
		const R = r + 3;
		const a0 = (-60 * Math.PI) / 180;
		const a1 = (180 * Math.PI) / 180;
		const p = (a: number) => `${R * Math.cos(a)} ${R * Math.sin(a)}`;
		const ex = R * Math.cos(a1);
		const ey = R * Math.sin(a1);
		// head: tangent at the end points down (clockwise travel), two short barbs
		const h = Math.max(2.2, r * 0.42);
		return `M${p(a0)}A${R} ${R} 0 1 1 ${ex} ${ey}M${ex - h * 0.9} ${ey - h * 0.6}L${ex} ${ey}L${ex + h * 0.9} ${ey - h * 0.6}`;
	};
	const pick = (slug: string | null) => onactive?.(slug);
</script>

<svg
	class="plate-diagram"
	class:has-active={active != null}
	viewBox="{-pad} {-pad} {bed.x + pad * 2} {bed.y + pad * 2 + footer}"
	role="img"
	aria-label="Top view of plate {plate.number}: {plate.name}"
	data-testid="plate-diagram"
>
	<defs>
		<pattern id="{uid}-pei" width="2.4" height="2.4" patternUnits="userSpaceOnUse">
			<circle cx="0.6" cy="0.7" r="0.22" class="pei-dot" />
			<circle cx="1.8" cy="1.9" r="0.18" class="pei-dot" />
			<circle cx="1.5" cy="0.3" r="0.14" class="pei-dot" />
		</pattern>
		<pattern
			id="{uid}-hatch"
			width="5"
			height="5"
			patternUnits="userSpaceOnUse"
			patternTransform="rotate(45)"
		>
			<rect width="5" height="5" class="ko-fill" />
			<path d="M0 0V5" class="ko-line" />
		</pattern>
		<linearGradient id="{uid}-bedglow" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" class="glow-hi" />
			<stop offset="1" class="glow-lo" />
		</linearGradient>
		<linearGradient id="{uid}-gloss" x1="0.15" y1="0" x2="0.5" y2="1">
			<stop offset="0" stop-color="#fff" stop-opacity="0.34" />
			<stop offset="0.45" stop-color="#fff" stop-opacity="0.04" />
			<stop offset="1" stop-color="#000" stop-opacity="0.2" />
		</linearGradient>
		<filter
			id="{uid}-shadow"
			x="-4%"
			y="-4%"
			width="108%"
			height="108%"
			color-interpolation-filters="sRGB"
		>
			<feDropShadow dx="0.6" dy="1.5" stdDeviation="1.3" flood-color="#000" flood-opacity="0.42" />
		</filter>
		{#each shapes as s (s.i)}<path id="{uid}-p{s.i}" d={s.d} />{/each}
	</defs>

	<!-- build plate -->
	<rect class="bed" x="0" y="0" width={bed.x} height={bed.y} rx="7" />
	<rect class="bed-tex" x="0" y="0" width={bed.x} height={bed.y} rx="7" fill="url(#{uid}-pei)" />
	<rect
		class="bed-glow"
		x="0"
		y="0"
		width={bed.x}
		height={bed.y}
		rx="7"
		fill="url(#{uid}-bedglow)"
	/>
	<path class="grid minor" d={grid.minor} />
	<path class="grid major" d={grid.major} />
	<rect class="bed-edge" x="0" y="0" width={bed.x} height={bed.y} rx="7" />
	<rect
		class="margin"
		x={bed.margin}
		y={bed.margin}
		width={bed.x - bed.margin * 2}
		height={bed.y - bed.margin * 2}
		rx="3"
	/>
	<!-- keep-out areas (filament cutter, ...): parts stay clear of these -->
	{#each bed.keepOut ?? [] as z, zi (zi)}
		<g
			class="keepout"
			data-testid="keep-out"
			role="img"
			aria-label="Keep-out area: {z.label || 'keep-out'}"
		>
			<title>{z.label || 'Keep-out'}: parts stay out of this area</title>
			<rect x={z.x} y={bed.y - z.y - z.d} width={z.w} height={z.d} fill="url(#{uid}-hatch)" />
			<rect class="ko-edge" x={z.x} y={bed.y - z.y - z.d} width={z.w} height={z.d} />
		</g>
	{/each}
	<!-- origin axes (front-left) -->
	<g class="origin" aria-hidden="true">
		<path class="ax-x" d="M3.5 {bed.y - 3.5}H17" />
		<path class="ax-y" d="M3.5 {bed.y - 3.5}V{bed.y - 17}" />
		<circle cx="3.5" cy={bed.y - 3.5} r="1.5" class="ax-o" />
	</g>
	<!-- front edge and size -->
	<g class="bed-meta" aria-hidden="true">
		<path class="front" d="M{bed.x / 2 - 9} {bed.y + 4.5}H{bed.x / 2 + 9}" />
		<text x={bed.x / 2} y={bed.y + 12} text-anchor="middle">FRONT</text>
		<text x={bed.x} y={bed.y + 12} text-anchor="end">{bed.x} × {bed.y} mm</text>
	</g>

	<!-- parts -->
	<g filter="url(#{uid}-shadow)">
		{#each shapes as s (s.i)}
			<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
			<use
				href="#{uid}-p{s.i}"
				class="part"
				class:approx={s.approx}
				class:over={plate.oversize}
				class:dim={active != null && active !== s.it.slug}
				class:on={active === s.it.slug}
				fill={s.color}
				stroke={s.edge}
				fill-rule="evenodd"
				data-slug={s.it.slug}
				data-testid="plate-part"
				onpointerenter={() => pick(s.it.slug)}
				onpointerleave={() => pick(null)}
				onclick={() => onselect?.(s.it.slug)}
			>
				<title>{s.n ? `${s.n}. ` : ''}{s.name}{s.approx ? ' (approximate shape)' : ''}</title>
			</use>
		{/each}
	</g>
	<g class="gloss" aria-hidden="true">
		{#each shapes as s (s.i)}
			{#if !s.approx}
				<use
					href="#{uid}-p{s.i}"
					fill="url(#{uid}-gloss)"
					fill-rule="evenodd"
					class:dim={active != null && active !== s.it.slug}
				/>
			{/if}
		{/each}
	</g>

	<!-- badges -->
	<g class="badges">
		{#each badges as b (b.ids[0])}
			<g
				class="badge"
				class:on={active === b.slug}
				class:dim={active != null && active !== b.slug}
				data-slug={b.slug}
				data-testid="plate-badge"
				data-outside={b.outside ? '1' : undefined}
				aria-hidden="true"
			>
				{#each b.leaders as [from, to] (to[0] + ',' + to[1])}
					<path class="lead-halo" d="M{from[0]} {from[1]}L{to[0]} {to[1]}" />
					<path class="lead" d="M{from[0]} {from[1]}L{to[0]} {to[1]}" />
					<circle class="anchor" cx={to[0]} cy={to[1]} r={Math.max(0.9, b.r * 0.2)} />
				{/each}
				<g transform="translate({b.x} {b.y})">
					{#if b.rotated != null}
						<g data-testid="rotated-badge" data-slug={b.slug}>
							<title>{numberOf.get(b.slug)?.name ?? b.slug}: rotated {b.rotated}° on the bed</title>
							<path class="ring-halo" d={arc(b.r)} />
							<path class="ring-rotated" d={arc(b.r)} />
						</g>
					{/if}
					<circle class="disc" r={b.r} />
					<text dy="0.36em" text-anchor="middle" font-size={b.r * (b.n > 9 ? 1.05 : 1.3)}
						>{b.n}</text
					>
				</g>
			</g>
		{/each}
	</g>
	{#each bed.keepOut ?? [] as z, zi (zi)}
		{#if z.label}
			<text
				class="ko-label"
				x={z.x + z.w / 2 > bed.x / 2 ? Math.min(bed.x - 1, z.x + z.w) : Math.max(1, z.x)}
				y={Math.max(9, bed.y - z.y - z.d - 3)}
				text-anchor={z.x + z.w / 2 > bed.x / 2 ? 'end' : 'start'}
				aria-hidden="true">{z.label}</text
			>
		{/if}
	{/each}
</svg>

<style>
	.plate-diagram {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
		-webkit-user-select: none;
		user-select: none;
	}
	.bed {
		fill: var(--bed);
	}
	.pei-dot {
		fill: var(--bed-dot);
		opacity: 0.55;
	}
	.glow-hi {
		stop-color: #fff;
		stop-opacity: 0.16;
	}
	.glow-lo {
		stop-color: #000;
		stop-opacity: 0.08;
	}
	.grid {
		fill: none;
		stroke: var(--bed-line);
		vector-effect: non-scaling-stroke;
	}
	.grid.minor {
		stroke-width: 0.6px;
		opacity: 0.13;
	}
	.grid.major {
		stroke-width: 0.9px;
		opacity: 0.3;
	}
	.bed-edge {
		fill: none;
		stroke: var(--bed-edge);
		stroke-width: 1.4px;
		vector-effect: non-scaling-stroke;
	}
	.ko-fill {
		fill: color-mix(in srgb, var(--bed-text) 16%, transparent);
	}
	.ko-line {
		stroke: var(--bed-text);
		stroke-width: 1.1;
		opacity: 0.55;
	}
	.ko-edge {
		fill: none;
		stroke: var(--bed-text);
		stroke-width: 1px;
		opacity: 0.7;
		vector-effect: non-scaling-stroke;
	}
	.ko-label {
		fill: var(--bed-text);
		stroke: var(--bed);
		stroke-width: 2.4px;
		paint-order: stroke;
		font-size: 7px;
		font-weight: 600;
		pointer-events: none;
	}
	.margin {
		fill: none;
		stroke: var(--bed-text);
		stroke-width: 1px;
		stroke-dasharray: 4 3;
		opacity: 0.5;
		vector-effect: non-scaling-stroke;
	}
	.ax-x,
	.ax-y {
		fill: none;
		stroke-width: 1.6px;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
	.ax-x {
		stroke: #e0483c;
	}
	.ax-y {
		stroke: #3aa655;
	}
	.ax-o {
		fill: var(--bed-text);
	}
	.bed-meta text {
		fill: var(--muted);
		font: 600 6.2px var(--f-body);
		letter-spacing: 0.08em;
	}
	.front {
		stroke: var(--muted);
		stroke-width: 1.6px;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
	.part {
		stroke-width: 1px;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.part.approx {
		fill-opacity: 0.78;
		stroke-dasharray: 3 2.5;
		stroke-width: 1.3px;
	}
	.part.over {
		stroke: var(--bad);
		stroke-dasharray: 5 3;
		stroke-width: 1.6px;
	}
	.part.on {
		stroke: var(--accent);
		stroke-width: 2.4px;
	}
	.part.dim,
	.gloss .dim {
		opacity: 0.32;
	}
	.gloss {
		pointer-events: none;
	}
	.badge {
		pointer-events: none;
		transition: opacity 0.15s;
	}
	.badge text {
		fill: #1b2033;
		font-family: var(--f-body);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.badge.on text {
		fill: #fff;
	}
	.badge.dim {
		opacity: 0.45;
	}
	.badge .disc {
		fill: #fff;
		stroke: #1b2033;
		stroke-width: 1.1px;
		vector-effect: non-scaling-stroke;
	}
	.badge.on .disc {
		fill: var(--accent);
		stroke: #fff;
		stroke-width: 1.6px;
	}
	.lead,
	.lead-halo {
		fill: none;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
	.lead {
		stroke: #1b2033;
		stroke-width: 1px;
	}
	.lead-halo {
		stroke: #fff;
		stroke-width: 2.6px;
		opacity: 0.85;
	}
	.anchor {
		fill: #1b2033;
		stroke: #fff;
		stroke-width: 0.9px;
		vector-effect: non-scaling-stroke;
	}
	.badge.on .lead {
		stroke: var(--accent);
	}
	.ring-halo,
	.ring-rotated {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}
	.ring-halo {
		stroke: #fff;
		stroke-width: 4.2px;
	}
	.ring-rotated {
		stroke: #d98200;
		stroke-width: 2.2px;
	}
</style>
