<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import type { PartPlacement, TemplateModelInfo } from '#lib/domain/types.ts';
	import type { ChairScene } from '#lib/client/three/chair-scene.ts';

	interface Props {
		model: TemplateModelInfo;
		/** slug → hex colour; missing slugs are neutral grey. */
		colors?: Record<string, string>;
		/** Slugs that are not rendered (for example parts of an inactive variant). */
		hidden?: string[];
		selected?: string | null;
		/** Fade every other part while one is selected. */
		dimOthers?: boolean;
		/** Overrides `model.placements` (live preview while nudging). */
		placements?: PartPlacement[];
		/** Tap or click on a part (dimmed ones too) gives its slug; empty space gives null. Drags are ignored. */
		onpick?: (slug: string | null) => void;
		onready?: (info: { rendered: string[]; unplaced: string[] }) => void;
		/** Slow turntable; never when the user prefers reduced motion. */
		autoRotate?: boolean;
		/** Show the offline hardware GLB (bolts, bearings). The stand-in casters and harness are always drawn. */
		showHardware?: boolean;
		/** Shown instead of the canvas when WebGL is unavailable. */
		fallback?: Snippet;
	}

	let {
		model,
		colors = {},
		hidden = [],
		selected = null,
		dimOthers = false,
		placements,
		onpick,
		onready,
		autoRotate = false,
		showHardware = true,
		fallback
	}: Props = $props();

	let host: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let scene = $state.raw<ChairScene | null>(null);
	let status = $state<'loading' | 'ready' | 'nowebgl' | 'error'>('loading');
	let progress = $state(0);
	let errorText = $state('');

	/** The device took the WebGL context and has not given it back yet (iOS does this under memory pressure). */
	let lost = $state(false);
	let lostTimer: ReturnType<typeof setTimeout> | undefined;
	/** A new canvas is needed after a lost context: the old one can never get a context again. */
	let epoch = $state(0);
	let dead = false;
	let created: ChairScene | null = null;

	async function start() {
		try {
			const mod = await import('#lib/client/three/chair-scene.ts');
			if (dead) return;
			if (!mod.webglAvailable()) {
				status = 'nowebgl';
				return;
			}
			const libs = await mod.loadLibs();
			if (dead || !host || !canvas) return;
			created = new mod.ChairScene(libs, canvas, host, {
				onpick: (s) => onpick?.(s),
				onready: (i) => onready?.(i),
				onprogress: (f) => (progress = f),
				oncontext: (state) => {
					clearTimeout(lostTimer);
					if (state === 'restored') {
						lost = false;
						return;
					}
					// Usually back within a moment; only then say anything.
					lostTimer = setTimeout(() => (lost = true), 2000);
				}
			});
			scene = created;
			// Debug / test handle (screenshots, e2e): the scene object on the host element.
			(host as unknown as { __scene?: ChairScene }).__scene = created;
		} catch (e) {
			status = 'nowebgl';
			errorText = e instanceof Error ? e.message : String(e);
		}
	}

	/** "Reload 3D view": throw the dead canvas away and build the scene again (the GLB is cached). */
	async function reload() {
		clearTimeout(lostTimer);
		lost = false;
		created?.dispose();
		created = null;
		scene = null;
		status = 'loading';
		progress = 0;
		epoch++;
		await tick();
		await start();
	}

	onMount(() => {
		dead = false;
		void start();
		return () => {
			dead = true;
			clearTimeout(lostTimer);
			created?.dispose();
			scene = null;
		};
	});

	// (Re)load the GLB when the model or its hardware GLB changes.
	$effect(() => {
		const s = scene;
		const url = model.url;
		const hw = model.hardwareUrl;
		if (!s) return;
		let stale = false;
		status = 'loading';
		progress = 0;
		s.loadModel(url, hw).then(
			() => {
				if (!stale) status = 'ready';
			},
			(e) => {
				if (stale) return;
				status = 'error';
				errorText = e instanceof Error ? e.message : 'The 3D model could not be loaded';
			}
		);
		return () => (stale = true);
	});

	$effect(() => {
		scene?.setPlacements($state.snapshot(placements ?? model.placements) as PartPlacement[]);
	});
	$effect(() => {
		scene?.setColors($state.snapshot(colors));
	});
	$effect(() => {
		scene?.setHidden([...hidden]);
	});
	$effect(() => {
		scene?.setSelection(selected ?? null, dimOthers);
	});
	$effect(() => {
		scene?.setAutoRotate(autoRotate);
	});
	$effect(() => {
		scene?.setShowHardware(showHardware);
	});

	/** PNG of the current view. */
	export function snapshot(
		opts: { width?: number; height?: number; background?: string } = {}
	): Promise<Blob> {
		if (!scene) return Promise.reject(new Error('The 3D view is not ready'));
		return scene.snapshot(opts);
	}
	/** Re-frame the whole chair. */
	export function resetView() {
		scene?.resetView();
	}
	/** Fly the camera to one part. */
	export function focus(slug: string) {
		scene?.focus(slug);
	}
</script>

<div
	class="chair-viewer"
	bind:this={host}
	role="img"
	aria-label="3D view of the chair. Drag to turn it, pinch or scroll to zoom."
>
	{#if status === 'nowebgl'}
		{#if fallback}
			{@render fallback()}
		{:else}
			<div class="cv-msg">
				The 3D view needs WebGL, which this browser or device does not provide.
				{#if errorText}<small>{errorText}</small>{/if}
			</div>
		{/if}
	{:else}
		{#key epoch}
			<canvas bind:this={canvas} class="cv-canvas"></canvas>
		{/key}
		{#if lost}
			<div class="cv-msg lost" role="alert" data-testid="gl-lost">
				<span>The 3D view was paused by your device.</span>
				<button type="button" class="btn sm" onclick={reload}>Reload 3D view</button>
			</div>
		{/if}
		{#if status === 'loading'}
			<div class="cv-msg" aria-live="polite">
				Loading the 3D model{progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : '…'}
			</div>
		{:else if status === 'error'}
			<div class="cv-msg" role="alert">{errorText || 'The 3D model could not be loaded'}</div>
		{/if}
	{/if}
</div>

<style>
	.chair-viewer {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 260px;
		overflow: hidden;
		touch-action: none;
	}
	.cv-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		outline: none;
	}
	.cv-msg {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 16px;
		color: var(--muted, #6b7280);
		font-size: 0.9rem;
		pointer-events: none;
	}
	.cv-msg.lost {
		background: color-mix(in srgb, var(--card, #fff) 85%, transparent);
	}
	.cv-msg.lost .btn {
		pointer-events: auto;
	}
</style>
