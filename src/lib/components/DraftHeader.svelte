<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { promoteDraft } from '#lib/client/api.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	let { chapter = '' }: { chapter?: string } = $props();
	const ctx = getBuildCtx();
	const b = $derived(ctx.view.build);
	const kicker = $derived(['Studio', chapter, b.templateName].filter(Boolean).join(' · '));
	let busy = $state(false);
	const compact = $derived(page.route.id === '/(app)/builds/[id]/design');

	async function promote() {
		busy = true;
		const ok = await ctx.act(() => promoteDraft(ctx.id));
		if (ok) {
			await invalidateAll();
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(resolve('/(app)/builds/[id]/setup', { id: ctx.id }) + '?step=5');
		}
		busy = false;
	}
</script>

<header class="draft-head" class:compact data-testid="draft-header">
	<div>
		<div class="kicker">{kicker}</div>
		<h1>
			{b.name}<span class="ds-badge ds-badge--accent draft-phase" data-testid="draft-badge"
				>Draft</span
			>
		</h1>
		<p class="muted desc">
			A scratch design: nothing here is tracked and it stays out of your build lists.
		</p>
	</div>
	{#if ctx.canEdit}
		<button
			class="btn primary"
			type="button"
			data-testid="make-build"
			disabled={busy}
			onclick={promote}>Make this a build</button
		>
	{/if}
</header>

<style>
	.draft-phase {
		margin-left: var(--sp-4);
		vertical-align: middle;
	}
	.draft-head {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 20px;
		align-items: end;
		justify-content: space-between;
	}
	h1,
	p {
		margin: 0;
	}
	@media (max-width: 899px) {
		.draft-head.compact {
			flex-wrap: nowrap;
			align-items: center;
			gap: 8px;
		}
		.draft-head.compact .desc,
		.draft-head.compact .kicker {
			display: none;
		}
		.draft-head.compact h1 {
			font-size: 18px;
		}
	}
</style>
