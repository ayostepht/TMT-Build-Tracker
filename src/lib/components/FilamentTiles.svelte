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

	// Wide screens show the spools field in every row; phones open it from the row.
	let wide = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(min-width: 900px)');
		wide = mq.matches;
		const on = () => (wide = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	let openRole = $state<string | null>(null);

	function saveSpools(role: string, raw: string) {
		const v = Math.min(99, Math.max(0, Math.round((Number(raw) || 0) * 100) / 100));
		ctx.act(() => updateFilament(ctx.id, role, { spools: v }));
	}
</script>

<section
	class="ft-card ds-card ds-card--compact"
	aria-label="Filament"
	data-testid="filament-tiles"
>
	<div class="ft-cols" aria-hidden="true">
		<span>Filament</span><span>Used</span><span>To print</span><span></span><span>Spools (kg)</span
		><span>Spare</span>
	</div>
	<ul class="ft-list">
		{#each stats as s (s.role)}
			{@const f = ctx.filament(s.role)}
			{@const spare = s.haveGrams - s.used - s.need}
			{@const scale = Math.max(s.haveGrams, s.used + s.need, 1)}
			{@const isOpen = openRole === s.role}
			{@const more = Math.ceil(-spare / 1000)}
			<li class="ft-row" data-testid="filament-tile" class:open={isOpen}>
				{#snippet nameCell()}
					{#if f}<Swatch hex={f.hex} tpu={f.tpu} />{:else}<span></span>{/if}
					<span class="ft-name">{filLabel(f, s.role)}</span>
				{/snippet}
				{#snippet badge()}
					<span
						class="ds-badge ft-verdict"
						class:ds-badge--ok={spare >= 0}
						class:ds-badge--bad={spare < 0}
						>{#if spare >= 0}{fmt(spare)} g spare{:else}short {fmt(-spare)} g{/if}</span
					>
				{/snippet}
				{#snippet bar()}
					<span class="ft-bar" title="Used, then still to print, against spools on hand">
						<span class="used" style="width:{(s.used / scale) * 100}%"></span>
						<span
							class="need"
							style="left:{(s.used / scale) * 100}%;width:{(s.need / scale) * 100}%"
						></span>
					</span>
				{/snippet}
				{#snippet field()}
					<label class="ft-spools">
						<span class="ft-spools-l" title="Use decimals for partial spools, e.g. 4.85"
							>Spools (kg)</span
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
					</label>
				{/snippet}
				{#if wide}
					<div class="ft-wide">
						<div class="ft-who">{@render nameCell()}</div>
						<span class="ft-num"><span class="sr-only">Used </span>{fmt(s.used)} g</span>
						<span class="ft-num"
							><span class="sr-only">To print </span>{fmt(s.need)} g{s.unweighed
								? ` (+${s.unweighed} unweighed)`
								: ''}</span
						>
						{@render bar()}
						{@render field()}
						<span class="ft-spare"><span class="sr-only">Spare </span>{@render badge()}</span>
					</div>
					<div class="ft-sub">
						<SpoolRemaining role={s.role} />
						{#if spare < 0}<span class="ft-more">Get {more} more spool{more > 1 ? 's' : ''}.</span
							>{/if}
					</div>
				{:else}
					<button
						type="button"
						class="ft-head"
						aria-expanded={isOpen}
						aria-controls="ft-edit-{s.role}"
						onclick={() => (openRole = isOpen ? null : s.role)}
					>
						<span class="ft-l1">
							<span class="ft-who">{@render nameCell()}</span>
							{@render badge()}
						</span>
						<span class="ft-l2">
							{@render bar()}
							<span class="ft-mono"
								>{fmt(s.used)} g used · {fmt(s.need)} g to print{s.unweighed
									? ` (+${s.unweighed} unweighed)`
									: ''}</span
							>
						</span>
						<span class="sr-only">{f?.spools ?? 0} kg of spools on hand. Tap to edit.</span>
					</button>
					{#if isOpen}
						<div class="ft-edit" id="ft-edit-{s.role}">
							{@render field()}
							{#if spare < 0}<span class="ft-more">Get {more} more spool{more > 1 ? 's' : ''}.</span
								>{/if}
							<SpoolRemaining role={s.role} />
						</div>
					{/if}
				{/if}
			</li>
		{/each}

		<li class="ft-row ft-time" data-testid="filament-tile">
			<div class="ft-timehead">
				<span class="ft-who"
					><span class="clock" aria-hidden="true"></span><span class="ft-name">Print time</span
					></span
				>
				<span class="ft-timeleft"
					><b>{tl.text}</b> left{time.adjustedLeftSec && time.known
						? ' at your pace'
						: ''}{tl.kind === 'estimate'
						? ' (est.)'
						: time.learned
							? ' (from your slice)'
							: ''}</span
				>
			</div>
			<div class="ft-l2">
				<span class="ft-bar" title="Share of estimated print time done">
					<span class="used" style="width:{timeDone}%;background:var(--ok)"></span>
				</span>
				<span class="ft-mono"
					>{time.loggedHours ? Math.round(time.loggedHours * 10) / 10 : 0} h logged · {#if time.known}~{fmtH(
							time.totalSec
						)}{time.estimated ? ' (est.)' : ''} total, about {Math.round(time.totalSec / 86400)} days
						nonstop{:else}— total{/if}</span
				>
			</div>
			<div class="ft-note">
				{time.paceRatio
					? `Calibrated: ${time.pace?.text ?? ''}`
					: !time.known
						? 'No time estimate yet. Upload a sliced file to get one.'
						: time.estimated
							? (time.rough ? 'Rough estimate' : 'Estimate') +
								" from MakeGood's X/P/A plate times. Log hours to calibrate."
							: 'Estimates from the template profile. Log hours to calibrate.'}
			</div>
		</li>
	</ul>
</section>

<style>
	.ft-card {
		padding: 0;
		overflow: hidden;
	}
	.ft-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ft-row {
		border-top: 1px solid var(--line);
		min-width: 0;
	}
	.ft-list > .ft-row:first-child {
		border-top: 0;
	}
	.ft-cols {
		display: none;
	}
	.ft-head {
		display: grid;
		gap: 6px;
		width: 100%;
		min-height: 56px;
		padding: 10px var(--sp-5);
		background: none;
		border: 0;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.ft-head:hover {
		background: var(--accent-soft);
	}
	.ft-l1 {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-width: 0;
	}
	.ft-who {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-width: 0;
		flex: 1;
	}
	.ft-name {
		font: 600 var(--fs-base) / 1.15 var(--f-display);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.ft-l2 {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.ft-time .ft-l2 {
		padding: 0 var(--sp-5);
	}
	.ft-mono {
		font: 400 var(--fs-xs) / 1.3 var(--f-mono);
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.ft-bar {
		display: block;
		height: 6px;
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
	.ft-verdict {
		white-space: nowrap;
		flex: none;
	}
	.ft-edit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3) var(--sp-5);
		padding: 2px var(--sp-5) 12px;
	}
	.ft-spools {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ft-spools input {
		width: 7ch;
		min-height: 40px;
	}
	.ft-more {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ft-time {
		display: grid;
		gap: 6px;
		padding: 10px 0;
	}
	.ft-timehead {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		padding: 0 var(--sp-5);
		min-width: 0;
		flex-wrap: wrap;
	}
	.ft-timeleft {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ft-timeleft b {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.ft-note {
		padding: 0 var(--sp-5);
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.ft-sub {
		display: none;
	}

	@media (min-width: 900px) {
		.ft-cols,
		.ft-wide {
			display: grid;
			grid-template-columns: minmax(0, 1.6fr) 90px 150px minmax(80px, 1fr) 150px 120px;
			align-items: center;
			gap: var(--sp-5);
			padding: 8px var(--sp-6);
		}
		.ft-cols {
			border-bottom: 1px solid var(--line);
			font: 600 var(--fs-xs) / 1 var(--f-body);
			color: var(--muted);
			text-transform: uppercase;
			letter-spacing: 0.06em;
		}
		.ft-wide {
			min-height: 48px;
		}
		/* The column header names the field; keep the label for assistive tech only. */
		.ft-wide .ft-spools-l {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.ft-num {
			font: 500 var(--fs-sm) / 1.2 var(--f-mono);
			font-variant-numeric: tabular-nums;
		}
		.ft-spare {
			justify-self: start;
		}
		.ft-sub:has(> *) {
			display: flex;
			gap: var(--sp-5);
			padding: 0 var(--sp-6) 8px;
		}
		.ft-time {
			padding: 10px var(--sp-6);
		}
		.ft-timehead,
		.ft-time .ft-l2,
		.ft-note {
			padding-inline: 0;
		}
	}
</style>
