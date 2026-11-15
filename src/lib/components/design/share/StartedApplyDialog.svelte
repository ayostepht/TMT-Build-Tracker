<script lang="ts">
	import { onMount } from 'svelte';
	import type { ApplyMode, ApplyPreview } from '#lib/domain/design-apply.ts';
	import Dialog from './Dialog.svelte';

	/**
	 * Asks how to apply a design (or palette) to a build that has started printing: "Colors only"
	 * (recommended) or "Colors and print files" (refused while a plate is printing or a printer job is
	 * live). Cancel is first and focused. The parent opens it only for a started build and closes it
	 * (`{#if}`) on `oncancel` or after `onchoose` resolves.
	 *
	 * Props:
	 * - `load`: returns the preview (`ApplyPreview`: started info, summary, skipped slots, slots that keep
	 *   spools, `fullBlocked`). For a design it is the dry run `previewApplyDesign(id, buildId)`.
	 * - `onchoose(mode)`: does the apply. When it throws, the dialog stays open and shows the message.
	 * - `oncancel`: Cancel, Escape, backdrop or the close button.
	 * - Optional wording: `title`, `colorsTitle`, `colorsText`, `colorsButton`, `fullTitle`, `fullText`,
	 *   `fullButton`, `testid`.
	 */
	let {
		load,
		onchoose,
		oncancel,
		title = 'This build has started printing',
		colorsTitle = 'Colors only',
		colorsText = "Changes your slots' colors. Plates, print files, progress, logs, spools and locked parts stay as they are.",
		colorsButton = 'Apply colors only',
		fullTitle = 'Colors and print files',
		fullText = "Also moves parts to the design's slots. Plates will need re-arranging afterwards.",
		fullButton = 'Replace colors and print files',
		testid = 'started-apply-dialog'
	}: {
		load: () => Promise<ApplyPreview>;
		onchoose: (mode: ApplyMode) => Promise<void> | void;
		oncancel: () => void;
		title?: string;
		colorsTitle?: string;
		colorsText?: string;
		colorsButton?: string;
		fullTitle?: string;
		fullText?: string;
		fullButton?: string;
		testid?: string;
	} = $props();

	let preview = $state<ApplyPreview | null>(null);
	let error = $state<string | null>(null);
	let busy = $state<ApplyMode | null>(null);

	onMount(() => {
		let live = true;
		load()
			.then((p) => live && (preview = p))
			.catch(
				(e) => live && (error = e instanceof Error ? e.message : 'Could not check the build.')
			);
		return () => (live = false);
	});

	async function choose(mode: ApplyMode) {
		if (busy) return;
		busy = mode;
		error = null;
		try {
			await onchoose(mode);
		} catch (e) {
			error = e instanceof Error ? e.message : 'That did not save.';
		} finally {
			busy = null;
		}
	}

	const REASON = {
		material: "the design's color is another material",
		locked: 'it holds locked parts'
	} as const;

	const noChange = $derived(!!preview && preview.changes.length === 0);
	const closeGuard = () => {
		if (!busy) oncancel();
	};
</script>

<Dialog {title} onclose={closeGuard} {testid} danger>
	<div class="sad">
		{#if preview?.summary}
			<p class="sad-summary" data-testid="started-apply-summary">{preview.summary}.</p>
		{:else if !preview && !error}
			<p class="muted" role="status">Checking the build…</p>
		{/if}

		<section class="sad-opt" aria-labelledby="sad-colors">
			<h3 id="sad-colors">{colorsTitle} <span class="sad-rec">Recommended</span></h3>
			<p class="sad-text">{colorsText}</p>
			{#if preview}
				{#if preview.skipped.length}
					<div class="sad-note" data-testid="started-apply-skipped">
						<b>Left as they are</b>
						<ul>
							{#each preview.skipped as s (s.role)}
								<li><span class="sad-name">{s.name}</span>: {REASON[s.reason]}</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if preview.keptStock.length}
					<div class="sad-note" data-testid="started-apply-kept">
						<b>Change filament but keep their spools</b>
						<ul>
							{#each preview.keptStock as k (k.role)}
								<li>
									<span class="sad-name">{k.was}</span> becomes
									<span class="sad-name">{k.name}</span>
									({k.spools > 0 ? `${k.spools} kg on hand` : 'no spools'}{k.spoolman
										? ', linked to Spoolman'
										: ''})
								</li>
							{/each}
						</ul>
						<p class="muted small">Check the spools on the shelf still match.</p>
					</div>
				{/if}
				{#if noChange}
					<p class="muted small" data-testid="started-apply-nochange">
						No slot would change color.
					</p>
				{/if}
			{/if}
			<button
				type="button"
				class="btn primary"
				data-testid="started-apply-colors"
				disabled={!preview || noChange || !!busy}
				onclick={() => choose('colors')}
			>
				{busy === 'colors' ? 'Applying…' : colorsButton}
			</button>
		</section>

		<section class="sad-opt" aria-labelledby="sad-full">
			<h3 id="sad-full">{fullTitle}</h3>
			<p class="sad-text">{fullText}</p>
			{#if preview?.fullBlocked}
				<p class="sad-block" id="sad-full-why" data-testid="started-apply-blocked">
					{preview.fullBlocked} Not available until it finishes.
				</p>
			{/if}
			<button
				type="button"
				class="btn"
				data-testid="started-apply-full"
				disabled={!preview || !!preview.fullBlocked || !!busy}
				aria-describedby={preview?.fullBlocked ? 'sad-full-why' : undefined}
				onclick={() => choose('full')}
			>
				{busy === 'full' ? 'Applying…' : fullButton}
			</button>
		</section>

		{#if error}<div class="error" role="alert" data-testid="started-apply-error">{error}</div>{/if}

		<div class="sad-foot">
			<button type="button" class="btn" data-cancel disabled={!!busy} onclick={oncancel}
				>Cancel</button
			>
		</div>
	</div>
</Dialog>

<style>
	.sad {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-6);
		min-width: 0;
	}
	p,
	h3,
	ul {
		margin: 0;
	}
	.sad-summary {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.sad-opt {
		display: grid;
		gap: var(--sp-3);
		min-width: 0;
		padding: var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.sad-opt h3 {
		font-size: var(--fs-md);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
	}
	.sad-rec {
		font-size: var(--fs-xs);
		font-weight: 600;
		color: var(--accent);
		border: 1px solid var(--accent);
		border-radius: var(--r-pill);
		padding: 0 var(--sp-3);
	}
	.sad-text {
		overflow-wrap: anywhere;
	}
	.sad-note {
		display: grid;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
		padding: var(--sp-3) var(--sp-4);
		border-radius: var(--r-sm);
		background: var(--warn-soft);
		border: 1px solid var(--line);
	}
	.sad-note ul {
		padding-left: var(--sp-5);
		display: grid;
		gap: var(--sp-1);
	}
	.sad-note li {
		overflow-wrap: anywhere;
	}
	.sad-name {
		font-weight: 600;
	}
	.sad-block {
		font-size: var(--fs-sm);
		color: var(--bad);
		overflow-wrap: anywhere;
	}
	.sad-opt .btn {
		justify-self: stretch;
	}
	.sad-foot {
		display: flex;
		justify-content: flex-start;
	}
	.sad-foot .btn {
		min-width: 40%;
	}
</style>
