<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { promoteDraft } from '#lib/client/api.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	let { chapter = '' }: { chapter?: string } = $props();
	const ctx = getBuildCtx();
	const b = $derived(ctx.view.build);
	const kicker = $derived(['Studio', chapter, b.templateName].filter(Boolean).join(' · '));
	let busy = $state(false);

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

<header class="draft-head" data-testid="draft-header">
	<div>
		<div class="kicker">{kicker}</div>
		<h1>
			{b.name}<span class="phase" data-testid="draft-badge">Draft</span>
		</h1>
		<p class="muted">
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
</style>
