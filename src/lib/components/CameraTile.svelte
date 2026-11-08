<script lang="ts">
	import { printerCameraInfo } from '#lib/client/api.ts';

	/**
	 * The printer's camera on the Now printing card: a snapshot every 5 s, or the MJPEG stream
	 * behind the Live toggle. Shows nothing when the printer has no camera, and a quiet
	 * "Camera unavailable" with Retry when it fails. Pauses while the tab is hidden.
	 */
	let { printerId }: { printerId: string } = $props();

	const REFRESH_MS = 5000;
	let available = $state(false);
	let live = $state(false);
	let failed = $state(false);
	let loaded = $state(false);
	let hidden = $state(typeof document !== 'undefined' && document.hidden);
	let frame = $state<string | null>(null);
	let streamKey = $state(0);
	let dlg = $state<HTMLDialogElement>();
	let zoomed = $state(false);
	let attempt = $state(0); // bumped by Retry

	const base = $derived(`/api/printers/${encodeURIComponent(printerId)}/camera`);
	const streamSrc = $derived(`${base}/stream?t=${streamKey}`);
	const shown = $derived(live ? (hidden ? null : streamSrc) : frame);

	$effect(() => {
		const onVis = () => (hidden = document.hidden);
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});

	$effect(() => {
		void printerId;
		let off = false;
		printerCameraInfo(printerId)
			.then((i) => {
				if (!off) available = i.supported && i.enabled && i.available;
			})
			.catch(() => {
				if (!off) available = false;
			});
		return () => {
			off = true;
		};
	});

	// Snapshot mode: fetch now and every 5 s while visible; the previous frame stays until the next arrives.
	$effect(() => {
		void attempt;
		if (!available || live || hidden || failed) return;
		const ctl = new AbortController();
		let busy = false;
		async function grab() {
			if (busy) return;
			busy = true;
			try {
				const res = await fetch(`${base}/snapshot?t=${Date.now()}`, {
					cache: 'no-store',
					signal: ctl.signal
				});
				if (res.status === 404) {
					available = false;
					return;
				}
				if (!res.ok) throw new Error('bad');
				const url = URL.createObjectURL(await res.blob());
				const old = frame;
				frame = url;
				loaded = true;
				if (old) URL.revokeObjectURL(old);
			} catch {
				if (!ctl.signal.aborted) failed = true;
			} finally {
				busy = false;
			}
		}
		void grab();
		const t = setInterval(grab, REFRESH_MS);
		return () => {
			ctl.abort();
			clearInterval(t);
		};
	});

	// Free the last frame when the card goes away.
	$effect(() => () => {
		if (frame) URL.revokeObjectURL(frame);
	});

	function setLive(v: boolean) {
		live = v;
		failed = false;
		loaded = false;
		if (v) streamKey = Date.now();
	}
	function retry() {
		failed = false;
		loaded = false;
		if (live) streamKey = Date.now();
		else attempt++;
	}
	function open() {
		zoomed = true;
		dlg?.showModal();
	}
	function onbackdrop(e: MouseEvent) {
		if (e.target === dlg) dlg?.close();
	}
</script>

{#if available}
	<div class="cam" data-testid="camera-tile">
		<div class="viewport">
			{#if failed}
				<div class="unavail" data-testid="camera-error">
					<span>Camera unavailable</span>
					<button class="btn sm" type="button" onclick={retry} data-testid="camera-retry"
						>Retry</button
					>
				</div>
			{:else if shown}
				<button class="zoom" type="button" onclick={open} aria-label="Enlarge camera view">
					<img
						src={shown}
						alt="Live view from the printer camera"
						data-testid="camera-img"
						onload={() => (loaded = true)}
						onerror={() => (failed = true)}
					/>
				</button>
			{/if}
			{#if !failed && !loaded}<span class="wait">Connecting…</span>{/if}
		</div>
		<div class="cambar">
			<button
				class="btn sm"
				type="button"
				aria-pressed={live}
				onclick={() => setLive(!live)}
				data-testid="camera-live">{live ? 'Live: on' : 'Live'}</button
			>
			<span class="muted">{live ? 'Streaming' : 'Updates every 5 s'}</span>
		</div>
	</div>

	<dialog
		bind:this={dlg}
		class="lightbox"
		aria-label="Printer camera"
		onclick={onbackdrop}
		onclose={() => (zoomed = false)}
	>
		{#if zoomed && shown}
			<img src={shown} alt="Printer camera, enlarged" data-testid="camera-lightbox-img" />
		{/if}
		<button class="btn sm close" type="button" onclick={() => dlg?.close()}>Close</button>
	</dialog>
{/if}

<style>
	.cam {
		display: grid;
		gap: 6px;
		max-width: 640px;
	}
	.viewport {
		position: relative;
		aspect-ratio: 16 / 9;
		background: #0c0e16;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid var(--line);
	}
	.zoom {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		cursor: zoom-in;
	}
	.zoom img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.wait,
	.unavail {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: #aab0c4;
		font-size: 13px;
		pointer-events: none;
	}
	.unavail {
		pointer-events: auto;
	}
	.cambar {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
	}
	.muted {
		color: var(--muted);
	}
	.lightbox {
		border: 0;
		padding: 0;
		background: transparent;
		max-width: 96vw;
		max-height: 96vh;
	}
	.lightbox::backdrop {
		background: rgba(8, 10, 18, 0.8);
	}
	.lightbox img {
		display: block;
		max-width: 96vw;
		max-height: 88vh;
		border-radius: 6px;
	}
	.close {
		margin-top: 8px;
	}
</style>
