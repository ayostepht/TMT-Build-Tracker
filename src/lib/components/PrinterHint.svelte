<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { printerStoreFor } from '#lib/client/printer-store.svelte.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	/**
	 * One quiet line for editors of a workspace that has no printer at all (connected or not):
	 * points at Integrations. Dismissed per browser; hidden until the printer list has loaded.
	 */
	const KEY = 'tmt-hint:connect-printer';
	const ctx = getBuildCtx();
	const store = printerStoreFor(ctx, ctx.view.build.organizationId, ctx.view.build.id);
	$effect(() => store.acquire());

	let dismissed = $state(false);
	try {
		dismissed = localStorage.getItem(KEY) === '1';
	} catch {
		/* storage blocked: show it */
	}
	function dismiss() {
		dismissed = true;
		try {
			localStorage.setItem(KEY, '1');
		} catch {
			/* ignore */
		}
	}

	const slug = $derived(
		(page.data as { teams?: { id: string; slug: string }[] }).teams?.find(
			(t) => t.id === ctx.view.build.organizationId
		)?.slug
	);
	const show = $derived(
		ctx.canEdit && store.loaded && !store.error && store.printers.length === 0 && !dismissed && slug
	);
</script>

{#if show && slug}
	<p class="ph muted" data-testid="printer-hint">
		<span>
			<a
				href={resolve('/(app)/teams/[slug]/integrations', { slug })}
				data-testid="printer-hint-link">Connect a printer</a
			>
			to follow prints automatically, or add one that is not connected to keep track of which printer
			a plate ran on.
		</span>
		<button class="ph-x" type="button" aria-label="Dismiss" onclick={dismiss}>×</button>
	</p>
{/if}

<style>
	.ph {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-4);
		margin: 0 0 var(--sp-6);
		font-size: var(--fs-sm);
	}
	.ph-x {
		flex: none;
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: var(--fs-lg);
		line-height: 1;
		min-width: 32px;
		min-height: 32px;
		cursor: pointer;
	}
</style>
