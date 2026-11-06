<script lang="ts">
	import { fmt, fmtH, filamentStats, timeStats, timeLeftText } from '#lib/domain/index.ts';
	import { updateFilament } from '#lib/client/api.ts';
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';
	import Swatch from './Swatch.svelte';
	import SpoolRemaining from './SpoolRemaining.svelte';

	const ctx = getBuildCtx();
	const stats = $derived(filamentStats(ctx.view));
	const time = $derived(timeStats(ctx.view));
	const timeDone = $derived(time.totalSec ? (1 - time.leftSec / time.totalSec) * 100 : 0);
	const tl = $derived(timeLeftText(time));

	function saveSpools(role: string, raw: string) {
		const v = Math.min(99, Math.max(0, Math.round((Number(raw) || 0) * 100) / 100));
		ctx.act(() => updateFilament(ctx.id, role, { spools: v }));
	}
</script>

<section class="tiles" aria-label="Filament">
	{#each stats as s (s.role)}
		{@const f = ctx.filament(s.role)}
		{@const cap = s.haveGrams}
		{@const spare = cap - s.used - s.need}
		{@const scale = Math.max(cap, s.used + s.need, 1)}
		<article class="tile">
			<div class="tile-top">
				{#if f}<Swatch hex={f.hex} tpu={f.tpu} />{/if}
				<div>
					<div class="tile-name">{filLabel(f, s.role)}</div>
				</div>
			</div>
			<div class="tile-stats">
				<div><b>{fmt(s.used)} g</b>used</div>
				<div>
					<b>{fmt(s.need)} g</b>still to print{s.unweighed ? ` (+${s.unweighed} unweighed)` : ''}
				</div>
			</div>
			<div class="tbar" title="Used, then still to print, against spools on hand">
				<span class="used" style="width:{(s.used / scale) * 100}%"></span>
				<span class="need" style="left:{(s.used / scale) * 100}%;width:{(s.need / scale) * 100}%"
				></span>
			</div>
			<div class="spools">
				<label for="sp-{s.role}" title="Use decimals for partial spools, e.g. 4.85"
					>Spools (kg)</label
				>
				<input
					id="sp-{s.role}"
					type="number"
					min="0"
					step="0.25"
					inputmode="decimal"
					value={f?.spools ?? 0}
					disabled={!ctx.canEdit}
					aria-label="{filLabel(f, s.role)} spools on hand"
					onchange={(e) => saveSpools(s.role, e.currentTarget.value)}
				/>
			</div>
			<SpoolRemaining role={s.role} />
			<div class="verdict" class:ok={spare >= 0} class:short={spare < 0}>
				{#if spare >= 0}About {fmt(spare)} g spare{:else}Short about {fmt(-spare)} g. Get {Math.ceil(
						-spare / 1000
					)} more spool{Math.ceil(-spare / 1000) > 1 ? 's' : ''}{/if}
			</div>
		</article>
	{/each}

	<article class="tile">
		<div class="tile-top">
			<span class="clock" aria-hidden="true"></span>
			<div>
				<div class="tile-name">Print time</div>
				<div class="tile-mat">All {ctx.view.plates.length} plates</div>
			</div>
		</div>
		<div class="tile-stats">
			<div>
				<b>{tl.text}</b>left{time.adjustedLeftSec && time.known ? ' at your pace' : ''}{tl.kind ===
				'estimate'
					? ' (est.)'
					: time.learned
						? ' (from your slice)'
						: ''}
			</div>
			<div>
				<b>{time.loggedHours ? Math.round(time.loggedHours * 10) / 10 : 0} h</b>logged so far
			</div>
		</div>
		<div class="tbar" title="Share of estimated print time done">
			<span class="used" style="width:{timeDone}%;background:var(--ok)"></span>
		</div>
		<div class="spools">
			{#if time.known}~{fmtH(time.totalSec)}{time.estimated ? ' (est.)' : ''} total, about {Math.round(
					time.totalSec / 86400
				)} days nonstop{:else}— total{/if}
		</div>
		<div class="verdict info">
			{time.paceRatio
				? `Your prints run ${Math.round(time.paceRatio * 100)}% of the estimates`
				: !time.known
					? 'No time estimate yet. Upload a sliced file to get one.'
					: time.estimated
						? (time.rough ? 'Rough estimate' : 'Estimate') +
							" from MakeGood's X/P/A plate times. Log hours to calibrate."
						: 'Estimates from the template profile. Log hours to calibrate.'}
		</div>
	</article>
</section>
