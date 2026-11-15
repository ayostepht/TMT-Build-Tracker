<script lang="ts">
	import { resolve } from '$app/paths';
	import { describeActivitySegments } from '#lib/domain/activity.ts';
	import { getBuildCtx, ago } from '#lib/components/build-context.svelte.ts';
	import NowPrinting from '#lib/components/NowPrinting.svelte';
	import FilamentTiles from '#lib/components/FilamentTiles.svelte';
	import PhaseSuggest from '#lib/components/PhaseSuggest.svelte';

	const ctx = getBuildCtx();
	const step = $derived(ctx.view.build.setupStep);
	const last = $derived(ctx.view.activity[0]);
	const lastText = $derived(
		last
			? describeActivitySegments(last, ctx.view)
					.map((s) => s.text)
					.join('')
			: ''
	);
</script>

{#if step !== null && ctx.canEdit}
	<div class="card cont" data-testid="continue-setup">
		<div>
			<strong>Finish setting up this build</strong>
			<div class="muted">Template, options, colors, printer and export.</div>
		</div>
		<a class="btn primary" href={resolve('/(app)/builds/[id]/setup', { id: ctx.id })}
			>Continue setup (step {step} of 5)</a
		>
	</div>
{/if}
<PhaseSuggest />
<NowPrinting />
<FilamentTiles />
{#if last}
	<p class="last" data-testid="last-change">
		<span class="last-t">Last change: {lastText}</span>
		<time datetime={last.at}>{ago(last.at, ctx.now)}</time>
		<a class="pill-link" href={resolve('/(app)/builds/[id]/activity', { id: ctx.id })}
			>All activity <span class="btn-arrow" aria-hidden="true">→</span></a
		>
	</p>
{/if}
<p class="foot">
	Estimates use each part's BOM weight until you enter slicer grams for a plate, then the slicer
	grams (per run where a plate prints more than once). Filament used only counts finished prints you
	log (failures included); a plate marked printed with no grams logged counts at its estimate.
</p>

<style>
	.last {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		margin: 0;
		color: var(--muted);
		font-size: var(--fs-md);
	}
	.last-t {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.last time {
		white-space: nowrap;
	}
	.cont {
		grid-auto-flow: column;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-color: var(--accent);
	}
	@media (max-width: 760px) {
		.cont {
			grid-auto-flow: row;
		}
	}
</style>
