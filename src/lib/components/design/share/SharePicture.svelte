<script lang="ts">
	import { onMount } from 'svelte';
	import {
		VARIANTS,
		VARIANT_IDS,
		pictureFileName,
		type PictureFormat,
		type PictureVariant
	} from '#lib/domain/share-picture.ts';
	import {
		canShareImages,
		composePicture,
		downloadPicture,
		encodePicture,
		pictureFile,
		sharePicture
	} from '#lib/client/share-picture.ts';

	/**
	 * Body of the "Share a picture" dialog (issue #99): pick a layout, type a title and a line, pick
	 * PNG or JPEG, see the finished picture, then Share or Download. The chair comes from the 3D view
	 * (one snapshot when the dialog opens); the rest is drawn in the browser and never uploaded.
	 */
	let {
		shot,
		swatches
	}: {
		/** Transparent PNG of the chair in the 3D view (no selection highlight). */
		shot: () => Promise<Blob>;
		/** Distinct chair colors, most used first. */
		swatches: string[];
	} = $props();

	const uid = $props.id();

	let variant = $state<PictureVariant>('family');
	let format = $state<PictureFormat>('png');
	// Each layout keeps its own texts while the dialog is open.
	let titles = $state<Record<PictureVariant, string>>({
		family: VARIANTS.family.defaultTitle,
		social: VARIANTS.social.defaultTitle
	});
	let lines = $state<Record<PictureVariant, string>>({
		family: VARIANTS.family.defaultLine,
		social: VARIANTS.social.defaultLine
	});

	let chair = $state<Blob | null>(null);
	let blob = $state<Blob | null>(null);
	let url = $state<string | null>(null);
	let busy = $state(true);
	let error = $state<string | null>(null);
	let canShare = $state(false);
	let note = $state<string | null>(null);

	const spec = $derived(VARIANTS[variant]);
	const fileName = $derived(pictureFileName(variant, format));

	function revoke() {
		if (url) URL.revokeObjectURL(url);
		url = null;
	}

	async function takeShot() {
		busy = true;
		error = null;
		try {
			chair = await shot();
		} catch (e) {
			chair = null;
			error =
				e instanceof Error && e.message
					? `${e.message}. Wait for the 3D view to finish loading, then try again.`
					: 'The 3D view is not ready. Wait for it to finish loading, then try again.';
			busy = false;
		}
	}

	onMount(() => {
		canShare = canShareImages();
		void takeShot();
		return revoke;
	});

	// Redraw whenever something that shows on the picture changes (typing is debounced).
	let token = 0;
	$effect(() => {
		const input = {
			variant,
			title: titles[variant],
			line: lines[variant],
			swatches: [...swatches],
			chair
		};
		const fmt = format;
		if (!input.chair) return;
		const mine = ++token;
		busy = true;
		const timer = setTimeout(async () => {
			try {
				const canvas = await composePicture({ ...input, chair: input.chair! });
				const out = await encodePicture(canvas, fmt);
				if (mine !== token) return;
				revoke();
				blob = out;
				url = URL.createObjectURL(out);
				error = null;
			} catch (e) {
				if (mine !== token) return;
				error = e instanceof Error ? e.message : 'The picture could not be made.';
			} finally {
				if (mine === token) busy = false;
			}
		}, 180);
		return () => clearTimeout(timer);
	});

	function download() {
		if (!blob) return;
		downloadPicture(blob, fileName);
		note = 'Saved to your downloads.';
	}

	async function share() {
		if (!blob) return;
		note = null;
		try {
			if (await sharePicture(pictureFile(blob, variant, format))) note = 'Shared.';
		} catch {
			error = 'Sharing did not work here. Use Download instead.';
		}
	}

	const altText = $derived(
		`Preview of the ${variant === 'family' ? 'family' : 'social media'} picture: the chair in its colors` +
			(swatches.length ? `, with ${swatches.length} color swatches` : '') +
			(titles[variant].trim() ? `, titled "${titles[variant].trim()}"` : '')
	);
</script>

<div class="sp" data-testid="share-picture">
	<div class="ds-seg ds-seg--fill sp-seg" role="group" aria-label="Layout">
		{#each VARIANT_IDS as v (v)}
			<button
				type="button"
				data-testid="share-picture-variant-{v}"
				aria-pressed={variant === v}
				onclick={() => {
					variant = v;
					note = null;
				}}>{VARIANTS[v].label}</button
			>
		{/each}
	</div>
	<p class="muted sp-hint">{spec.hint}</p>

	<figure class="sp-frame" style:aspect-ratio="{spec.width} / {spec.height}" data-variant={variant}>
		{#if url}
			<img
				src={url}
				alt={altText}
				width={spec.width}
				height={spec.height}
				data-testid="share-picture-preview"
				class:sp-stale={busy}
			/>
		{:else}
			<div class="sp-wait muted" data-testid="share-picture-preview" role="status">
				{error ? 'No preview' : 'Making the picture…'}
			</div>
		{/if}
	</figure>

	{#if error}
		<div class="error" role="alert">
			{error}
			{#if !chair}
				<button type="button" class="btn sm" onclick={takeShot}>Try again</button>
			{/if}
		</div>
	{/if}

	<div class="sp-fields">
		<label class="field">
			Title
			<input
				data-testid="share-picture-title"
				bind:value={titles[variant]}
				maxlength={spec.titleMax}
				autocomplete="off"
				placeholder="Optional"
			/>
		</label>
		<label class="field">
			One more line
			<input
				data-testid="share-picture-line"
				bind:value={lines[variant]}
				maxlength={spec.lineMax}
				autocomplete="off"
				placeholder={spec.linePlaceholder}
			/>
		</label>
		<label class="field sp-format">
			File type
			<select data-testid="share-picture-format" bind:value={format}>
				<option value="png">PNG (sharpest)</option>
				<option value="jpeg">JPEG (smaller file)</option>
			</select>
		</label>
	</div>

	<p class="muted sp-privacy" id="{uid}-privacy">
		The picture only contains what you type here, the chair, its colors and a credit to MakeGood. No
		build, team, recipient or filament names. It uses the angle shown in the 3D view and is made on
		this device; nothing is uploaded.
	</p>

	<div class="sp-actions">
		{#if canShare}
			<button
				type="button"
				class="btn primary"
				data-testid="share-picture-share"
				disabled={!blob || busy}
				onclick={share}>Share</button
			>
		{/if}
		<button
			type="button"
			class="btn"
			class:primary={!canShare}
			data-testid="share-picture-download"
			disabled={!blob || busy}
			onclick={download}>Download {format === 'png' ? 'PNG' : 'JPEG'}</button
		>
	</div>
	<div class="sr-only" role="status" aria-live="polite">{note ?? ''}</div>
	{#if note}<p class="muted sp-note" aria-hidden="true">{note}</p>{/if}
</div>

<style>
	.sp {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-5);
		min-width: 0;
	}
	.sp-hint {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.sp-frame {
		margin: 0;
		min-width: 0;
		justify-self: center;
		width: 100%;
		/* The frame keeps the picture's shape and never grows past the screen height. */
		max-height: 46dvh;
		border-radius: var(--r-lg);
		overflow: hidden;
		background: var(--accent-soft);
		border: 1px solid var(--line);
		display: grid;
	}
	.sp-frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		transition: opacity 0.15s;
	}
	.sp-frame img.sp-stale {
		opacity: 0.55;
	}
	.sp-wait {
		display: grid;
		place-items: center;
		min-height: 160px;
	}
	.sp-fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-4);
	}
	.sp-fields input,
	.sp-fields select {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		min-height: 44px;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: var(--fs-base);
	}
	@media (pointer: coarse) {
		.sp-fields input,
		.sp-fields select {
			font-size: 16px;
		}
	}
	.sp-privacy {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.sp-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
	.sp-actions .btn {
		flex: 1 1 140px;
		min-height: 44px;
	}
	.sp-note {
		margin: 0;
		font-size: var(--fs-sm);
	}
	/* Roomy dialog: the picture beside its controls. */
	@media (min-width: 761px) {
		.sp {
			grid-template-columns: minmax(0, 1fr) minmax(0, 340px);
			column-gap: var(--sp-8);
			align-items: start;
		}
		.sp > * {
			grid-column: 2;
		}
		.sp > .sp-frame {
			grid-column: 1;
			grid-row: 1 / span 8;
			max-height: calc(100dvh - 190px);
		}
	}
</style>
