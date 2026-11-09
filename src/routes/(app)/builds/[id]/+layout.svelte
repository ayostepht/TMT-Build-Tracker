<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { subscribeBuild } from '#lib/client/live.ts';
	import { BuildCtx, setBuildCtx } from '#lib/components/build-context.svelte.ts';
	import BuildHeader from '#lib/components/BuildHeader.svelte';
	import DraftHeader from '#lib/components/DraftHeader.svelte';
	import TabBar from '#lib/components/TabBar.svelte';
	import GuideViewer from '#lib/components/GuideViewer.svelte';
	import Toast from '#lib/components/Toast.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const ctx = new BuildCtx(untrack(() => data.view));
	setBuildCtx(ctx);

	// A fresh load (invalidateAll, reload) replaces our copy. Only when the loaded view is a
	// different object: SvelteKit hands the layout a new `data` object on every child
	// navigation, and re-assigning the same (by now stale) view would undo live updates.
	let loaded = untrack(() => data.view);
	$effect(() => {
		const v = data.view;
		if (v === untrack(() => loaded)) return;
		loaded = v;
		ctx.view = v;
	});
	const buildId = $derived(data.view.build.id);

	// Live updates for this build; any "changed" event re-fetches the view.
	$effect(() => {
		return subscribeBuild(buildId, () => void ctx.refresh(), {
			onStatus: (s: unknown) => {
				ctx.sync = s === true || s === 'live' || s === 'open' || s === 'on' ? 'on' : 'off';
			}
		});
	});

	// 30 s tick so elapsed / remaining timers move.
	$effect(() => {
		const t = setInterval(() => (ctx.now = Date.now()), 30000);
		return () => clearInterval(t);
	});

	const inSetup = $derived(page.route.id === '/(app)/builds/[id]/setup');
	const isDraft = $derived(ctx.view.build.kind === 'draft');
	const chapter = $derived(
		(data as { teams?: { id: string; name: string }[] }).teams?.find(
			(t) => t.id === data.view.build.organizationId
		)?.name ?? ''
	);
</script>

<svelte:head><title>{ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

{#if !inSetup}
	{#if isDraft}
		<DraftHeader {chapter} />
	{:else}
		<BuildHeader {chapter} />
	{/if}
{/if}
{#if !ctx.canEdit}
	<div class="banner" role="note">
		You have view-only access to this {isDraft ? 'draft' : 'build'}. Ask a chapter owner for editor
		access to make changes.
	</div>
{/if}
{#if ctx.error}
	<div class="banner bad" role="alert">{ctx.error}</div>
{/if}
{#if !inSetup}
	<TabBar id={ctx.id} draft={isDraft} />
{/if}
{@render children()}
<GuideViewer />
<Toast />

<style>
	/* The Design tab is a work area: wider container, tighter bottom padding, no page scroll on desktop. */
	:global(.wrap:has(.design-route)) {
		max-width: 1680px;
		padding-bottom: 16px;
		gap: 12px;
	}
</style>
