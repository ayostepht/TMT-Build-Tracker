<script lang="ts">
	import { overallProgress, filamentStats, timeStats, timeLeftText } from '#lib/domain/index.ts';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { buildKpis } from '#lib/domain/kpis.ts';
	import StatTile from './charts/StatTile.svelte';
	import { getBuildCtx } from './build-context.svelte.ts';

	let { chapter = '' }: { chapter?: string } = $props();
	const ctx = getBuildCtx();

	/** The Design tab is a work area: drop the progress stats so the chair starts near the top. */
	const compact = $derived(page.route.id === '/(app)/builds/[id]/design');
	const prog = $derived(overallProgress(ctx.view));
	const fil = $derived(filamentStats(ctx.view));
	const time = $derived(timeStats(ctx.view));
	const tl = $derived(timeLeftText(time));
	const usedKg = $derived(fil.reduce((a, s) => a + s.used, 0) / 1000);
	const estKg = $derived(fil.reduce((a, s) => a + s.used + s.need, 0) / 1000);
	/** The four Stats headline numbers, from the same function as the Stats tab so the text matches. */
	const k = $derived(buildKpis(ctx.view, new Date(ctx.now)));
	/** Phones: shorter labels and no detail line, so four cards fit across. */
	let narrow = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 760px)');
		const set = () => (narrow = mq.matches);
		set();
		mq.addEventListener('change', set);
		return () => mq.removeEventListener('change', set);
	});
	const cards = $derived([
		{
			key: 'parts',
			label: narrow ? 'Parts' : 'Parts printed',
			value: String(k.parts.printed),
			unit: narrow ? `/ ${k.parts.total}` : `of ${k.parts.total}`,
			detail: k.parts.detail,
			name: `Parts printed: ${k.parts.label}`,
			split: [
				{ value: k.parts.printed, tone: 'good' as const },
				{ value: Math.max(0, k.parts.total - k.parts.printed), tone: 'neutral' as const }
			]
		},
		{
			key: 'time',
			label: narrow ? 'Time' : 'Printing time',
			value: k.time.value,
			unit: 'h',
			detail: k.time.detail,
			name: `Printing time: ${k.time.label} logged`,
			split: [
				{ value: k.time.goodH, tone: 'good' as const },
				{ value: k.time.failedH, tone: 'bad' as const }
			]
		},
		{
			key: 'filament',
			label: narrow ? 'Filament' : 'Filament used',
			value: k.filament.value,
			unit: k.filament.unit,
			detail: k.filament.detail,
			name: `Filament used: ${k.filament.label}`,
			split: [
				{ value: k.filament.keptKg, tone: 'good' as const },
				{ value: k.filament.lostKg, tone: 'bad' as const }
			]
		},
		{
			key: 'finish',
			label: narrow ? 'Finish' : 'Projected finish',
			value: k.finish.label,
			unit: undefined,
			detail: k.finish.detail,
			name: `Projected finish: ${k.finish.label}`,
			split: undefined
		}
	]);
	const b = $derived(ctx.view.build);
	const kicker = $derived(
		[chapter, b.templateName, [b.recipient, b.hospital].filter(Boolean).join(' · ')]
			.filter(Boolean)
			.join(' · ')
	);
	/** Phones: the header is one line; the kicker and the progress numbers sit behind a tap. */
	let details = $state(false);
	const syncText = $derived(
		!ctx.canEdit && ctx.sync === 'on'
			? 'Live · read only'
			: ctx.sync === 'on'
				? 'Live'
				: ctx.sync === 'off'
					? 'Reconnecting…'
					: 'Connecting…'
	);
</script>

<header class="head bh" class:compact class:bh-open={details}>
	<div class="bh-title">
		<div class="kicker bh-kicker">{kicker}</div>
		<h1>
			<span class="bh-name">{b.name}</span><span
				class="ds-badge ds-badge--accent bh-phase"
				data-testid="build-phase">{b.phase}</span
			>
		</h1>
	</div>
	<div
		class="sync"
		class:on={ctx.sync === 'on'}
		class:off={ctx.sync === 'off'}
		role="status"
		aria-live="polite"
	>
		<span class="dot"></span><span class="sync-t">{syncText}</span>
	</div>
	<nav class="bh-kpis" aria-label="Build numbers" data-testid="header-kpis">
		{#each cards as c (c.key)}
			<a
				class="bh-kpi"
				href={resolve('/(app)/builds/[id]/stats', { id: ctx.id })}
				data-testid="header-kpi-{c.key}"
				aria-label="{c.name}. {c.detail}. Open Stats"
			>
				<span class:bh-long={narrow && c.value.length > 7} class="bh-kpi-in">
					<StatTile
						compact
						label={c.label}
						value={c.value}
						unit={c.unit}
						detail={c.detail}
						split={c.split}
					/>
				</span>
			</a>
		{/each}
	</nav>
	{#if !compact}
		<button
			type="button"
			class="bh-more"
			aria-expanded={details}
			aria-controls="build-details"
			data-testid="header-details"
			onclick={() => (details = !details)}
			><span class="bh-caret" aria-hidden="true">▾</span><span class="sr-only"
				>{details ? 'Hide' : 'Show'} build details</span
			></button
		>
		<div class="overall" id="build-details">
			<div class="overall-top">
				<span><b class="num">{prog.printed} of {prog.total}</b> parts printed</span>
				<span><b class="num">{prog.printing}</b> printing</span>
				<span><b class="num">{prog.reprint}</b> to reprint</span>
				<span
					><b class="num">{usedKg.toFixed(1)} kg</b> used of ~{estKg.toFixed(1)} kg estimated</span
				>
				<span title={tl.hint ?? undefined}
					><b class="num">{tl.text}</b> of printing left{#if tl.kind === 'estimate'}<em class="est"
							>(estimate)</em
						>{:else if tl.hint}<em class="est">({tl.hint})</em>{/if}</span
				>
				{#if b.deliveryDate}<span>Deliver by <b class="num">{b.deliveryDate}</b></span>{/if}
			</div>
		</div>
	{/if}
</header>

<style>
	/* Header grid. Wide: title | four cards | live dot, details line below. Narrower: cards get
	   their own full-width row under the title. */
	.bh {
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas: 'title sync' 'kpis kpis' 'overall overall';
		align-items: center;
		gap: var(--sp-5) var(--sp-9);
	}
	.bh-title {
		grid-area: title;
		min-width: 0;
	}
	.bh :global(.sync) {
		grid-area: sync;
	}
	.bh .overall {
		grid-area: overall;
	}
	.bh-kpis {
		grid-area: kpis;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--sp-4);
		min-width: 0;
	}
	.bh-kpi {
		display: block;
		min-width: 0;
		color: inherit;
		text-decoration: none;
		border-radius: var(--r-md);
	}
	.bh-kpi-in {
		display: block;
		height: 100%;
	}
	.bh-kpi :global(.st-tile) {
		height: 100%;
		transition: border-color 0.12s;
	}
	.bh-kpi:hover :global(.st-tile) {
		border-color: var(--accent);
	}
	.bh-kpi:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	@media (min-width: 1000px) {
		.bh {
			grid-template-columns: minmax(0, 1fr) minmax(0, 640px) auto;
			grid-template-areas: 'title kpis sync' 'overall overall overall';
		}
	}
	.bh-phase {
		margin-left: var(--sp-4);
		vertical-align: middle;
	}
	.bh-more {
		display: none;
	}
	.bh-name {
		min-width: 0;
	}
	.bh.compact {
		gap: 0 20px;
		align-items: center;
	}
	.bh.compact h1 {
		font-size: var(--fs-2xl);
	}
	.bh.compact .kicker {
		margin-bottom: 3px;
	}
	@media (max-width: 899px) {
		.bh.compact {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'title sync' 'kpis kpis';
			gap: 6px 10px;
		}
		.bh.compact h1 {
			font-size: var(--fs-lg);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.bh.compact .kicker {
			display: none;
		}
		.bh.compact .sync {
			justify-self: end;
		}
	}
	/* Phones: name + status on one line; the rest behind the details button. */
	@media (max-width: 760px) {
		.bh {
			grid-template-columns: minmax(0, 1fr) auto auto;
			grid-template-areas: 'title more sync' 'kpis kpis kpis' 'overall overall overall';
			gap: 4px 6px;
			align-items: center;
		}
		.bh-kpis {
			gap: var(--sp-3);
		}
		/* Phones: label, value and bar only; the detail sentence is in each card's link name. */
		.bh-kpi :global(.st-detail) {
			display: none;
		}
		.bh-kpi :global(.st-tile) {
			padding: var(--sp-4) var(--sp-4) var(--sp-4);
		}
		.bh-long :global(.st-value) {
			font-size: var(--fs-md);
			line-height: 1.5;
		}
		.bh-title {
			min-width: 0;
		}
		.bh h1 {
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: var(--fs-lg);
			line-height: 1.2;
		}
		.bh .bh-name {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.bh .bh-phase {
			flex: none;
			margin-left: 0;
		}
		.bh .sync {
			justify-self: end;
		}
		.bh .sync-t {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.bh-kicker {
			display: none;
		}
		.bh-open .bh-kicker {
			display: block;
			margin-bottom: 4px;
		}
		.bh-more {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			min-height: 40px;
			min-width: 40px;
			padding: 0 6px;
			border: 0;
			border-radius: var(--r-lg);
			background: transparent;
			color: var(--muted);
			font: 600 var(--fs-sm)/1 var(--f-body);
		}
		@media (pointer: coarse) {
			.bh-more {
				min-height: 44px;
				min-width: 44px;
			}
		}
		.bh-more:hover {
			background: var(--accent-soft);
		}
		.bh-caret {
			transition: transform 0.15s;
		}
		.bh-open .bh-caret {
			transform: rotate(180deg);
		}
		.bh .overall {
			display: none;
			margin-top: 2px;
		}
		.bh-open .overall {
			display: grid;
		}
	}
</style>
