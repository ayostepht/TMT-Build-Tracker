<script lang="ts">
	import { printerCameraInfo } from '#lib/client/api.ts';

	/**
	 * The printer's camera on the Now printing card: a snapshot every 5 s, or the MJPEG stream
	 * behind the Live toggle. Shows nothing when the printer has no camera, and a quiet
	 * "Camera unavailable" with Retry when it fails. Pauses while the tab is hidden.
	 */
	let { printerId, name = '' }: { printerId: string; name?: string } = $props();
	const label = $derived(name ? `Live camera: ${name}` : 'Live camera');

	const REFRESH_MS = 5000;
	let available = $state(false);
	let live = $state(false);
	let failed = $state(false);
	let loaded = $state(false);
	let hidden = $state(typeof document !== 'undefined' && document.hidden);
	let frame = $state<string | null>(null);
	let streamKey = $state(0);
	let dlg = $state<HTMLDialogElement>();
	let opener: HTMLElement | null = null;
	let zoomed = $state(false);
	let attempt = $state(0); // bumped by Retry
	let collapsed = $state(false);
	const bodyId = $props.id();

	const storeKey = $derived(`tmt-camera-collapsed:${printerId}`);

	// Remembered per printer (browser only; storage may be blocked).
	$effect(() => {
		try {
			collapsed = localStorage.getItem(storeKey) === '1';
		} catch {
			collapsed = false;
		}
	});

	function toggle() {
		collapsed = !collapsed;
		try {
			if (collapsed) localStorage.setItem(storeKey, '1');
			else localStorage.removeItem(storeKey);
		} catch {
			/* storage unavailable: still works for this visit */
		}
		if (collapsed) {
			// Drop the stream and the last frame; expanding starts over in snapshot mode.
			live = false;
			failed = false;
			loaded = false;
			if (frame) URL.revokeObjectURL(frame);
			frame = null;
			dlg?.close();
		}
	}

	const base = $derived(`/api/printers/${encodeURIComponent(printerId)}/camera`);
	const streamSrc = $derived(`${base}/stream?t=${streamKey}`);
	const shown = $derived(collapsed ? null : live ? (hidden ? null : streamSrc) : frame);

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
		if (!available || live || hidden || failed || collapsed) return;
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
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		zoomed = true;
		dlg?.showModal();
	}
	/** Native dialogs restore focus themselves; make sure of it (the opener may have re-rendered). */
	function onclosed() {
		zoomed = false;
		if (opener?.isConnected) opener.focus();
		opener = null;
	}
	function onbackdrop(e: MouseEvent) {
		if (e.target === dlg) dlg?.close();
	}
</script>

{#if available}
	<div class="cam" data-testid="camera-tile">
		<button
			class="camhead"
			type="button"
			aria-expanded={!collapsed}
			aria-controls={bodyId}
			onclick={toggle}
			data-testid="camera-toggle"
		>
			<svg
				class="chev"
				class:open={!collapsed}
				viewBox="0 0 16 16"
				width="14"
				height="14"
				aria-hidden="true"
			>
				<path
					d="M5 3l5 5-5 5"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<span>Camera</span>
		</button>
		<div id={bodyId} class="cambody" hidden={collapsed}>
			{#if !collapsed}
				<div class="viewport">
					{#if failed}
						<div class="unavail" data-testid="camera-error">
							<span>Camera unavailable</span>
							<button class="btn sm" type="button" onclick={retry} data-testid="camera-retry"
								>Retry</button
							>
						</div>
					{:else if shown}
						<button
							class="zoom"
							type="button"
							onclick={open}
							aria-label="Enlarge camera view: {name || 'printer'}"
						>
							<img
								src={shown}
								alt={label}
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
			{/if}
		</div>
	</div>

	<dialog
		bind:this={dlg}
		class="lightbox"
		aria-label={label}
		onclick={onbackdrop}
		onclose={onclosed}
	>
		{#if zoomed && shown}
			<img src={shown} alt="{label}, enlarged" data-testid="camera-lightbox-img" />
		{/if}
		<button class="btn sm close" type="button" onclick={() => dlg?.close()}>Close</button>
	</dialog>
{/if}

<style>
	.cam {
		display: grid;
		gap: var(--sp-3);
		max-width: 640px;
	}
	.camhead {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		min-height: 40px;
		width: 100%;
		padding: 0 2px;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.chev {
		transition: transform 0.15s;
		color: var(--muted);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.cambody {
		display: grid;
		gap: var(--sp-3);
	}
	.cambody[hidden] {
		display: none;
	}
	.viewport {
		position: relative;
		aspect-ratio: 16 / 9;
		background: #0c0e16; /* camera stage: dark in both themes */
		border-radius: var(--r-md);
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
		gap: var(--sp-5);
		color: #aab0c4; /* on the dark stage */
		font-size: var(--fs-sm);
		pointer-events: none;
	}
	.unavail {
		pointer-events: auto;
	}
	.cambar {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		font-size: var(--fs-xs);
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
		background: var(--scrim-strong);
	}
	.lightbox img {
		display: block;
		max-width: 96vw;
		max-height: 88vh;
		border-radius: var(--r-md);
	}
	.close {
		margin-top: var(--sp-4);
	}
	@media (pointer: coarse) {
		.close {
			min-height: 44px;
			min-width: 44px;
		}
	}
</style>
