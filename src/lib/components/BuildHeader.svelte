<script lang="ts">
	import { overallProgress, filamentStats, timeStats, timeLeftText } from '#lib/domain/index.ts';
	import { page } from '$app/state';
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
	const pct = (n: number) => `${prog.total ? (n / prog.total) * 100 : 0}%`;
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
			<span class="bh-name">{b.name}</span><span class="phase">{b.phase}</span>
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
	{#if !compact}
		<button
			type="button"
			class="bh-more"
			aria-expanded={details}
			aria-controls="build-details"
			data-testid="header-details"
			onclick={() => (details = !details)}
			><span class="num">{prog.printed}/{prog.total}</span>
			<span class="bh-caret" aria-hidden="true">▾</span><span class="sr-only"
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
			<div
				class="bar"
				role="progressbar"
				aria-label="Parts printed"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(prog.pct)}
			>
				<span style="width:{pct(prog.printed)};background:var(--ok)"></span>
				<span style="width:{pct(prog.printing)};background:var(--run)"></span>
				<span style="width:{pct(prog.reprint)};background:var(--bad)"></span>
			</div>
		</div>
	{/if}
</header>

<style>
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
			gap: 0 10px;
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
			gap: 0 10px;
			align-items: center;
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
		.bh .phase {
			flex: none;
			margin-left: 0;
		}
		.bh .sync {
			justify-self: end;
			grid-column: auto;
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
			margin-top: 6px;
		}
		.bh-open .overall {
			display: grid;
		}
		.bh-open .bh-title {
			grid-column: 1;
		}
	}
</style>
