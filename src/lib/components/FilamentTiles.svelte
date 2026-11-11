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
		<article class="ds-card ds-card--compact ft" data-testid="filament-tile">
			<div class="ft-top">
				{#if f}<Swatch hex={f.hex} tpu={f.tpu} />{/if}
				<div>
					<div class="ft-name">{filLabel(f, s.role)}</div>
				</div>
			</div>
			<div class="ft-stats">
				<div><b>{fmt(s.used)} g</b>used</div>
				<div>
					<b>{fmt(s.need)} g</b>still to print{s.unweighed ? ` (+${s.unweighed} unweighed)` : ''}
				</div>
			</div>
			<div class="ft-bar" title="Used, then still to print, against spools on hand">
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
			<div
				class="ds-badge ft-verdict"
				class:ds-badge--ok={spare >= 0}
				class:ds-badge--bad={spare < 0}
			>
				{#if spare >= 0}About {fmt(spare)} g spare{:else}Short about {fmt(-spare)} g. Get {Math.ceil(
						-spare / 1000
					)} more spool{Math.ceil(-spare / 1000) > 1 ? 's' : ''}{/if}
			</div>
		</article>
	{/each}

	<article class="ds-card ds-card--compact ft" data-testid="filament-tile">
		<div class="ft-top">
			<span class="clock" aria-hidden="true"></span>
			<div>
				<div class="ft-name">Print time</div>
				<div class="ft-mat">All {ctx.view.plates.length} plates</div>
			</div>
		</div>
		<div class="ft-stats">
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
		<div class="ft-bar" title="Share of estimated print time done">
			<span class="used" style="width:{timeDone}%;background:var(--ok)"></span>
		</div>
		<div class="spools">
			{#if time.known}~{fmtH(time.totalSec)}{time.estimated ? ' (est.)' : ''} total, about {Math.round(
					time.totalSec / 86400
				)} days nonstop{:else}— total{/if}
		</div>
		<div class="ds-badge ds-badge--accent ft-verdict">
			{time.paceRatio
				? `Calibrated: ${time.pace?.text ?? ''}`
				: !time.known
					? 'No time estimate yet. Upload a sliced file to get one.'
					: time.estimated
						? (time.rough ? 'Rough estimate' : 'Estimate') +
							" from MakeGood's X/P/A plate times. Log hours to calibrate."
						: 'Estimates from the template profile. Log hours to calibrate.'}
		</div>
	</article>
</section>

<style>
	.ft {
		display: grid;
		gap: var(--sp-5);
		align-content: start;
	}
	.ft-top {
		display: flex;
		gap: var(--sp-5);
		align-items: center;
	}
	.ft-name {
		font: 600 var(--fs-lg) / 1.1 var(--f-display);
	}
	.ft-mat {
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.ft-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-2) var(--sp-6);
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ft-stats b {
		display: block;
		color: var(--ink);
		font: 600 var(--fs-lg) / 1.2 var(--f-body);
		font-variant-numeric: tabular-nums;
	}
	.ft-bar {
		height: 8px;
		border-radius: var(--r-sm);
		background: var(--line);
		position: relative;
		overflow: hidden;
	}
	.ft-bar .used {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--muted);
	}
	.ft-bar .need {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--accent);
		opacity: 0.45;
	}
	/* The badge holds a sentence: let it wrap instead of staying one pill line. */
	.ft-verdict {
		white-space: normal;
		border-radius: var(--r-md);
		justify-self: start;
	}
</style>
