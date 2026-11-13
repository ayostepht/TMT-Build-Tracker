<script lang="ts">
	import { resolve } from '$app/paths';
	import ChairViewer from '#lib/components/ChairViewer.svelte';
	import KitCredit from '#lib/components/kit/KitCredit.svelte';
	import type { PartPlacement, TemplateModelInfo } from '#lib/domain/types.ts';

	/**
	 * The 3D stage of the Design tab and the designs gallery. The only place that
	 * imports ChairViewer; shows a friendly empty state while the template has no
	 * model, and forwards the viewer's methods.
	 */
	let {
		model,
		colors,
		hidden = [],
		selected = null,
		dimOthers = false,
		placements,
		onpick,
		onready,
		autoRotate = false,
		siteAdmin = false,
		addFilesHref = undefined,
		label = 'Chair preview',
		raised = false
	}: {
		model: TemplateModelInfo | null;
		colors: Record<string, string>;
		hidden?: string[];
		selected?: string | null;
		dimOthers?: boolean;
		placements?: PartPlacement[];
		onpick?: (slug: string | null) => void;
		onready?: (info: { rendered: string[]; unplaced: string[] }) => void;
		autoRotate?: boolean;
		siteAdmin?: boolean;
		/** Where the 3D files get added (the build's Print settings); shown in the empty state. */
		addFilesHref?: string;
		label?: string;
		/** Move "Reset view" to the top right (a part chip floats over the bottom). */
		raised?: boolean;
	} = $props();

	let viewer = $state<ReturnType<typeof ChairViewer>>();

	export function snapshot(opts?: {
		width?: number;
		height?: number;
		background?: string;
	}): Promise<Blob> {
		if (!viewer) return Promise.reject(new Error('No 3D view to capture'));
		return viewer.snapshot(opts);
	}
	export function resetView() {
		viewer?.resetView();
	}
	export function focus(slug: string) {
		viewer?.focus(slug);
	}
	/** Give keyboard focus back to the stage (after the part chip closes). */
	export function focusStage() {
		box?.focus();
	}
	let box = $state<HTMLElement>();
</script>

<div class="stage" role="group" aria-label={label} tabindex="-1" bind:this={box}>
	{#if model}
		<ChairViewer
			bind:this={viewer}
			{model}
			{colors}
			{hidden}
			{selected}
			{dimOthers}
			{placements}
			{onpick}
			{onready}
			{autoRotate}
		>
			{#snippet fallback()}
				<div class="empty">
					<strong>3D preview is not available in this browser</strong>
					<p class="muted">Colors still work: use the part list and the color slots.</p>
				</div>
			{/snippet}
		</ChairViewer>
		<button type="button" class="reset btn sm" class:raised onclick={() => viewer?.resetView()}>
			Reset view
		</button>
		<KitCredit class="credit" />
	{:else}
		<div class="empty" data-testid="no-model">
			<strong>No 3D model yet</strong>
			<p class="muted">
				The 3D chair comes with the kit files. Until they are added, pick colors from the part list.
			</p>
			{#if addFilesHref}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="btn sm" href={addFilesHref}>See the kit files</a>
			{:else if siteAdmin}
				<a class="btn sm" href={resolve('/(app)/admin/templates')}>Open kit admin</a>
			{/if}
		</div>
	{/if}
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 220px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		overflow: hidden;
	}
	.empty {
		height: 100%;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--sp-4);
		text-align: center;
		padding: var(--sp-10);
	}
	.empty p {
		margin: 0;
		max-width: 38ch;
	}
	.stage :global(.credit) {
		position: absolute;
		left: 10px;
		bottom: 8px;
		max-width: calc(100% - 20px);
		white-space: nowrap;
		pointer-events: none;
	}
	.reset {
		position: absolute;
		right: 10px;
		bottom: 46px; /* above the two credit lines, so the credit never runs over the chair at 360 px */
		opacity: 0.9;
	}
	.reset.raised {
		bottom: auto;
		top: 10px;
	}
	.stage:focus {
		outline: none;
	}
</style>
