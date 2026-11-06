<script lang="ts">
	import { overallProgress, filamentStats, timeStats, timeLeftText } from '#lib/domain/index.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	let { chapter = '' }: { chapter?: string } = $props();
	const ctx = getBuildCtx();

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

<header class="head">
	<div>
		<div class="kicker">{kicker}</div>
		<h1>
			{b.name}<span class="phase">{b.phase}</span>
		</h1>
	</div>
	<div
		class="sync"
		class:on={ctx.sync === 'on'}
		class:off={ctx.sync === 'off'}
		role="status"
		aria-live="polite"
	>
		<span class="dot"></span><span>{syncText}</span>
	</div>
	<div class="overall">
		<div class="overall-top">
			<span><b class="num">{prog.printed} of {prog.total}</b> parts printed</span>
			<span><b class="num">{prog.printing}</b> printing</span>
			<span><b class="num">{prog.reprint}</b> to reprint</span>
			<span><b class="num">{usedKg.toFixed(1)} kg</b> used of ~{estKg.toFixed(1)} kg estimated</span
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
</header>
