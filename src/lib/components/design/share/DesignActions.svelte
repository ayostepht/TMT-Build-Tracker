<script lang="ts">
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import ApplyDesign from './ApplyDesign.svelte';
	import Dialog from './Dialog.svelte';
	import SaveDesign from '../SaveDesign.svelte';

	/**
	 * Header actions of the Design workspace: autosave status, "Share / Save as design" and
	 * "Saved designs" (apply one to this build). Edits save on their own; nothing here is a commit step.
	 * `embedded` (setup wizard) already has its own "Start from a design" selector, so only Share shows.
	 */
	let { snapshot, embedded = false }: { snapshot?: () => Promise<Blob>; embedded?: boolean } =
		$props();
	const ctx = getBuildCtx();

	let open = $state<'share' | 'apply' | null>(null);
</script>

<div class="actions" data-testid="design-actions">
	<span class="status muted" role="status" data-testid="autosave-status">
		<span aria-hidden="true">✓</span>
		{ctx.error ? 'Not saved' : 'Saved automatically'}
	</span>
	<span class="btns">
		{#if ctx.canEdit && !embedded}
			<button type="button" class="btn sm" data-testid="open-apply" onclick={() => (open = 'apply')}
				>Saved designs</button
			>
		{/if}
		<button type="button" class="btn sm" data-testid="open-share" onclick={() => (open = 'share')}
			>Share / Save as design</button
		>
	</span>
</div>

{#if open === 'share'}
	<Dialog title="Share / Save as design" onclose={() => (open = null)} testid="share-dialog">
		<SaveDesign {snapshot} />
	</Dialog>
{:else if open === 'apply'}
	<Dialog title="Apply a saved design" onclose={() => (open = null)} testid="apply-dialog">
		<ApplyDesign ondone={() => (open = null)} />
	</Dialog>
{/if}

<style>
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--sp-3) var(--sp-5);
	}
	.status {
		font-size: var(--fs-sm);
	}
	.btns {
		display: flex;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
</style>
