<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		VARIANTS,
		VARIANT_IDS,
		SOCIAL_SIZES,
		SOCIAL_SIZE_IDS,
		SECTION_BODY_MAX,
		SECTION_HEADING_MAX,
		pictureDims,
		pictureFileName,
		type PictureFormat,
		type PictureVariant,
		type SocialSize,
		type TextSection
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
	let size = $state<SocialSize>('square');
	// Sections are kept while the size changes; the size decides how many are drawn.
	let sections = $state<TextSection[]>([]);
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
	const dims = $derived(pictureDims(variant, size));
	const limit = $derived(variant === 'social' ? SOCIAL_SIZES[size].maxSections : 0);
	const fileName = $derived(pictureFileName(variant, format, size));

	function addSection() {
		if (sections.length >= limit) return;
		sections.push({ heading: '', body: '' });
		note = 'Section added.';
		const n = sections.length - 1;
		void tick().then(() =>
			document
				.querySelector<HTMLInputElement>(`[data-testid="share-picture-section-${n}-heading"]`)
				?.focus()
		);
	}
	function removeSection(n: number) {
		sections.splice(n, 1);
		note = 'Section removed.';
		void tick().then(() =>
			(
				document.querySelector<HTMLElement>(
					'[data-testid="share-picture-add-section"]:not([disabled])'
				) ?? document.querySelector<HTMLElement>('[data-testid="share-picture-size-' + size + '"]')
			)?.focus()
		);
	}

	function revoke() {
		if (url) URL.revokeObjectURL(url);
		url = null;
	}

	let waiting = $state(false);
	let stopped = false;
	/**
	 * Take the chair shot. While the 3D view is still loading the viewer refuses, so ask again every
	 * 300 ms for up to 15 s ("Getting the 3D view ready…"); only then, or when the view can never
	 * work (no WebGL, model error), show the error with "Try again".
	 */
	async function takeShot() {
		busy = true;
		error = null;
		const deadline = Date.now() + 15_000;
		for (;;) {
			try {
				waiting = false;
				chair = await shot();
				return;
			} catch (e) {
				chair = null;
				const gone = e instanceof Error && e.name === 'ViewUnavailable';
				if (stopped) return;
				if (!gone && Date.now() < deadline) {
					waiting = true;
					await new Promise((r) => setTimeout(r, 300));
					if (stopped) return;
					continue;
				}
				waiting = false;
				error = gone
					? 'The 3D view is not available here, so a picture cannot be made.'
					: 'The 3D view did not get ready. Wait for it to finish loading, then try again.';
				busy = false;
				return;
			}
		}
	}

	onMount(() => {
		canShare = canShareImages();
		void takeShot();
		return () => {
			stopped = true;
			revoke();
		};
	});

	// Redraw whenever something that shows on the picture changes (typing is debounced).
	let token = 0;
	/** Bumped by "Try again" after a failed draw: runs the compose step again with the current inputs. */
	let redraw = $state(0);
	$effect(() => {
		void redraw;
		const input = {
			variant,
			size,
			sections: sections.map((x) => ({ ...x })),
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
		note = 'Download started.';
	}

	async function share() {
		if (!blob) return;
		note = null;
		try {
			if (await sharePicture(pictureFile(blob, variant, format, size))) note = 'Shared.';
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
	{#if variant === 'social'}
		<div class="ds-seg ds-seg--fill ds-seg--sm sp-size" role="group" aria-label="Size">
			{#each SOCIAL_SIZE_IDS as z (z)}
				<button
					type="button"
					data-testid="share-picture-size-{z}"
					aria-pressed={size === z}
					onclick={() => (size = z)}
					><span class="sp-size-label"
						><span class="sp-size-name">{SOCIAL_SIZES[z].label}</span><span class="sp-size-hint"
							>{SOCIAL_SIZES[z].hint}</span
						></span
					></button
				>
			{/each}
		</div>
		<p class="muted sp-hint" data-testid="share-picture-size-info">
			{SOCIAL_SIZES[size].width} × {SOCIAL_SIZES[size].height} px.
			{#if size === 'story'}Text and colors stay clear of the top and bottom, where the app covers a
				story.{/if}
		</p>
	{/if}

	<figure class="sp-frame" style:aspect-ratio="{dims.width} / {dims.height}" data-variant={variant}>
		{#if url}
			<img
				src={url}
				alt={altText}
				width={dims.width}
				height={dims.height}
				data-testid="share-picture-preview"
				class:sp-stale={busy}
			/>
		{:else}
			<div class="sp-wait muted" data-testid="share-picture-preview" role="status">
				{error ? 'No preview' : waiting ? 'Getting the 3D view ready…' : 'Making the picture…'}
			</div>
		{/if}
	</figure>

	{#if error}
		<div class="error" role="alert">
			{error}
			{#if !chair}
				<button type="button" class="btn sm" onclick={takeShot}>Try again</button>
			{:else}
				<button
					type="button"
					class="btn sm"
					data-testid="share-picture-retry"
					onclick={() => {
						error = null;
						redraw++;
					}}>Try again</button
				>
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
		{#if variant === 'social'}
			<div class="sp-sections" role="group" aria-labelledby="{uid}-sections">
				<h3 id="{uid}-sections" class="sp-sections-h">Text sections</h3>
				{#if limit === 0}
					<p class="muted sp-hint">
						Choose Portrait or Tall to add text sections.{#if sections.length}
							Your {sections.length === 1 ? 'section is' : 'sections are'} kept.{/if}
					</p>
				{:else}
					<p class="muted sp-hint">
						Optional: a bold heading and a short paragraph. Up to {limit}
						{limit === 1 ? 'section' : 'sections'} in this size.
					</p>
				{/if}
				{#each sections as sec, n (n)}
					<fieldset class="sp-sec" class:sp-sec-off={n >= limit}>
						<legend>Section {n + 1}</legend>
						{#if n >= limit}
							<p class="muted sp-hint" data-testid="share-picture-section-{n}-off">
								Not in the picture at this size. It is kept if you switch back.
							</p>
						{/if}
						<label class="field">
							Heading
							<input
								data-testid="share-picture-section-{n}-heading"
								bind:value={sec.heading}
								maxlength={SECTION_HEADING_MAX}
								autocomplete="off"
								placeholder="About the recipient"
							/>
						</label>
						<label class="field">
							<span class="sp-label-row"
								>Text <span class="sp-count" aria-hidden="true"
									>{sec.body.length}/{SECTION_BODY_MAX}</span
								></span
							>
							<textarea
								data-testid="share-picture-section-{n}-body"
								bind:value={sec.body}
								maxlength={SECTION_BODY_MAX}
								rows="3"
								placeholder="A short note about the child or how people can help"></textarea>
						</label>
						<button
							type="button"
							class="btn sm ghost"
							data-testid="share-picture-section-{n}-remove"
							onclick={() => removeSection(n)}>Remove section {n + 1}</button
						>
					</fieldset>
				{/each}
				<button
					type="button"
					class="btn sm"
					data-testid="share-picture-add-section"
					disabled={sections.length >= limit}
					onclick={addSection}>Add a section</button
				>
				<p class="muted sp-hint">Only share details about a child with the family's OK.</p>
			</div>
		{/if}
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
				disabled={!blob || busy || !!error}
				onclick={share}>Share</button
			>
		{/if}
		<button
			type="button"
			class="btn"
			class:primary={!canShare}
			data-testid="share-picture-download"
			disabled={!blob || busy || !!error}
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
	.sp-fields select,
	.sp-fields textarea {
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
		.sp-fields select,
		.sp-fields textarea {
			font-size: 16px;
		}
	}
	.sp-fields textarea {
		resize: vertical;
		min-height: 88px;
	}
	.sp-size-label {
		display: grid;
		justify-items: center;
		line-height: 1.2;
	}
	.sp-size-name,
	.sp-size-hint {
		display: block;
		white-space: nowrap;
	}
	.sp-label-row {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	.sp-size-hint {
		font-size: var(--fs-sm);
		font-weight: 400;
		color: var(--muted);
	}
	.sp-sections {
		display: grid;
		gap: var(--sp-4);
		min-width: 0;
	}
	.sp-sections-h {
		margin: 0;
		font-size: var(--fs-md);
	}
	.sp-sec {
		display: grid;
		gap: var(--sp-3);
		margin: 0;
		min-width: 0;
		padding: var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.sp-sec legend {
		font-size: var(--fs-sm);
		color: var(--muted);
		padding: 0 var(--sp-2);
	}
	.sp-sec-off {
		opacity: 0.7;
	}
	.sp-count {
		font-variant-numeric: tabular-nums;
	}
	.sp-sections > .btn {
		justify-self: start;
		min-height: 44px;
	}
	.sp-sec > .btn {
		justify-self: start;
		min-height: 44px;
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
			position: sticky;
			top: 84px;
			max-height: calc(100dvh - 190px);
		}
	}
</style>
