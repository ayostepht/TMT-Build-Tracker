<script lang="ts">
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import ApplyDesign from './ApplyDesign.svelte';
	import Dialog from './Dialog.svelte';
	import SaveDesign from '../SaveDesign.svelte';
	import SharePicture from './SharePicture.svelte';
	import { onMount } from 'svelte';
	import { webglAvailable } from '#lib/client/three/chair-scene.ts';

	/**
	 * Header actions of the Design workspace: autosave status, "Share / Save as design" and
	 * "Saved designs" (apply one to this build). Edits save on their own; nothing here is a commit step.
	 * `embedded` (setup wizard) already has its own "Start from a design" selector, so only Share shows.
	 * `picture` (issue #99) turns on "Share a picture" (a PNG/JPEG of the chair for families or social
	 * media, drawn in the browser): `shot` is a clean transparent snapshot, `swatches` the chair's colors.
	 * It needs the 3D model and WebGL, and is not offered in the wizard.
	 */
	let {
		snapshot,
		picture,
		embedded = false
	}: {
		snapshot?: () => Promise<Blob>;
		picture?: { shot: () => Promise<Blob>; swatches: string[] };
		embedded?: boolean;
	} = $props();
	const ctx = getBuildCtx();

	let open = $state<'share' | 'apply' | 'picture' | null>(null);
	let webgl = $state(false);
	onMount(() => (webgl = webglAvailable()));
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
		{#if picture && webgl && !embedded}
			<button
				type="button"
				class="btn sm"
				data-testid="open-share-picture"
				onclick={() => (open = 'picture')}>Share a picture</button
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
{:else if open === 'picture' && picture}
	<Dialog title="Share a picture" wide onclose={() => (open = null)} testid="share-picture-dialog">
		<SharePicture shot={picture.shot} swatches={picture.swatches} />
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
