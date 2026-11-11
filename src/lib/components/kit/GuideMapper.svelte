<script lang="ts">
	import AskDialog from '#lib/components/AskDialog.svelte';
	import { createAsk } from '#lib/client/ask.svelte.ts';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		clearGuideImages,
		getGuideStatus,
		saveGuideMapping,
		uploadedGuidePageUrl,
		type GuideStatusDto
	} from '#lib/client/api.ts';
	import { guessOffset } from '#lib/domain/kit-import.ts';

	/**
	 * Guide page mapping: which uploaded PDF page each of our guide pages shows. The offset starts
	 * from the last saved mapping (or 3). `refresh()` reloads after the importer uploaded pages
	 * and applies the offset.
	 */
	let {
		templateId,
		onavailable,
		onchange
	}: { templateId: string; onavailable?: (has: boolean) => void; onchange?: () => void } = $props();

	let status = $state<GuideStatusDto | null>(null);
	let busy = $state(false);
	let error = $state('');
	let version = $state(String(Date.now()));
	let offset = $state(3);
	let map = $state<Record<number, number | null>>({});
	let selected = $state<number | null>(null);
	let saved = $state('');

	async function load(applyGuess = false) {
		try {
			status = await getGuideStatus(templateId);
			map = Object.fromEntries(status.pages.map((p) => [p.page, p.pdfPage]));
			if (applyGuess) offset = guessOffset(status.pages);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load the guide status';
		}
	}
	onMount(() => load(true));

	/** After new pages were uploaded: reload, keep the last offset and apply it to the mapping. */
	export async function refresh() {
		version = String(Date.now());
		const keep = offset;
		await load();
		offset = keep;
		applyOffset();
	}

	/** Our page N shows PDF page N - offset (for pages that exist in the upload). */
	function applyOffset() {
		if (!status) return;
		const up = new Set(status.uploaded);
		const next: Record<number, number | null> = {};
		for (const p of status.pages) {
			const pdf = p.page - offset;
			next[p.page] = up.has(pdf) ? pdf : null;
		}
		map = next;
		saved = '';
	}

	function setPdfPage(page: number, v: string) {
		const n = Number(v);
		map[page] = v.trim() && Number.isInteger(n) && n > 0 ? n : null;
		saved = '';
	}

	const mappedCount = $derived(Object.values(map).filter((v) => v !== null).length);
	const unknown = $derived(
		Object.values(map).filter((v) => v !== null && !status?.uploaded.includes(v as number)).length
	);

	async function saveMap() {
		error = '';
		busy = true;
		try {
			await saveGuideMapping(templateId, map);
			saved = `Saved. ${mappedCount} guide pages now show an image.`;
			await load();
			await invalidateAll();
			onchange?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not save the mapping';
		} finally {
			busy = false;
		}
	}

	async function clearAll() {
		if (
			!(await asking.ask('Remove every imported guide image from this server?', {
				title: 'Remove guide images?',
				confirmLabel: 'Remove them'
			}))
		)
			return;
		busy = true;
		try {
			await clearGuideImages(templateId);
			saved = '';
			selected = null;
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not remove the images';
		} finally {
			busy = false;
		}
	}

	const hasUploads = $derived((status?.uploaded.length ?? 0) > 0);
	$effect(() => {
		onavailable?.(hasUploads);
	});
	const thumb = (pdf: number) => uploadedGuidePageUrl(templateId, pdf, version);
	const selPdf = $derived(selected !== null ? (map[selected] ?? null) : null);
	const asking = createAsk();
</script>

<AskDialog ask={asking} />

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if status && hasUploads}
	<div class="gm">
		<h3>Match pages</h3>
		<p class="muted">
			Our page numbers come from the newest guide; an older PDF can be a few pages behind. Set the
			difference and apply it, then fix single pages by hand. {status.uploaded.length} PDF pages are uploaded.
		</p>
		<div class="arow">
			<label class="inline">
				PDF is behind by
				<input
					type="number"
					min="0"
					max="200"
					bind:value={offset}
					class="offset"
					aria-label="Page offset"
				/>
				pages
			</label>
			<button type="button" class="btn" onclick={applyOffset}>Apply offset</button>
		</div>

		<div class="map" role="table" aria-label="Guide page mapping">
			{#each status.pages as p (p.page)}
				{@const pdf = map[p.page] ?? null}
				<div
					class="mrow"
					class:sel={selected === p.page}
					class:bad={pdf !== null && !status.uploaded.includes(pdf)}
					role="row"
				>
					<button type="button" class="pick" onclick={() => (selected = p.page)}>
						<b>p{p.page}</b>
						{p.title}
					</button>
					<label class="inline">
						<span class="sr-only">PDF page for guide page {p.page}</span>
						PDF page
						<input
							type="number"
							min="1"
							value={pdf ?? ''}
							oninput={(e) => setPdfPage(p.page, e.currentTarget.value)}
							class="pdfp"
							aria-label="PDF page for guide page {p.page}"
						/>
					</label>
					{#if pdf !== null && status.uploaded.includes(pdf)}
						<button
							type="button"
							class="tb"
							onclick={() => (selected = p.page)}
							aria-label="Preview page {p.page}"
						>
							<img src={thumb(pdf)} alt="" loading="lazy" />
						</button>
					{:else}
						<span class="tb none">no image</span>
					{/if}
				</div>
			{/each}
		</div>

		{#if selected !== null}
			{@const sp = status.pages.find((x) => x.page === selected)}
			<div class="compare" aria-label="Side by side preview">
				{#each [-1, 0, 1] as d (d)}
					{@const n = selPdf !== null ? selPdf + d : null}
					<figure class:cur={d === 0}>
						{#if n !== null && status.uploaded.includes(n)}
							<img src={thumb(n)} alt="PDF page {n}" />
						{:else}
							<div class="blank">none</div>
						{/if}
						<figcaption>
							{d === 0 ? `Our p${selected}: ${sp?.title ?? ''}` : 'Neighbour'}
							{#if n !== null}<span class="muted">(PDF page {n})</span>{/if}
						</figcaption>
					</figure>
				{/each}
			</div>
		{/if}

		<div class="arow">
			<button type="button" class="btn primary" disabled={busy} onclick={saveMap}
				>Save mapping</button
			>
			<button type="button" class="btn danger" disabled={busy} onclick={clearAll}
				>Remove guide images</button
			>
			<span class="muted">{mappedCount} of {status.pages.length} pages mapped</span>
			{#if unknown}<span class="error">{unknown} point at pages that were not uploaded</span>{/if}
			{#if saved}<span class="ok" role="status">{saved}</span>{/if}
		</div>
	</div>
{/if}

<style>
	.gm {
		display: grid;
		gap: 10px;
	}
	.arow {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	.ok {
		color: var(--ok);
	}
	.inline {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-md);
	}
	.offset,
	.pdfp {
		width: 64px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
	}
	.map {
		display: grid;
		gap: 4px;
		max-height: 420px;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: 4px;
	}
	.mrow {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 56px;
		gap: 8px;
		align-items: center;
		padding: 4px 6px;
		border-radius: var(--r-md);
	}
	.mrow.sel {
		background: var(--accent-soft);
	}
	.mrow.bad {
		outline: 1px solid var(--bad);
	}
	.pick {
		text-align: left;
		border: 0;
		background: none;
		color: var(--ink);
		padding: 4px 0;
		min-width: 0;
		font: inherit;
		cursor: pointer;
	}
	.tb {
		width: 56px;
		height: 40px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		overflow: hidden;
		background: #fff;
		display: grid;
		place-items: center;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	/* Text on a thumbnail slot: --paper keeps --muted at 4.5:1+ in both themes (it was white). */
	.tb.none {
		background: var(--paper);
	}
	.tb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top;
	}
	.compare {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.compare figure {
		margin: 0;
		display: grid;
		gap: 4px;
		opacity: 0.7;
	}
	.compare figure.cur {
		opacity: 1;
	}
	.compare img,
	.blank {
		width: 100%;
		aspect-ratio: 3 / 4;
		object-fit: contain;
		background: #fff;
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
	}
	.blank {
		display: grid;
		place-items: center;
		color: var(--muted);
		background: var(--paper);
	}
	figcaption {
		font-size: var(--fs-xs);
	}
	@media (max-width: 760px) {
		.compare {
			grid-template-columns: 1fr;
		}
		.mrow {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.mrow .tb {
			display: none;
		}
	}
</style>
