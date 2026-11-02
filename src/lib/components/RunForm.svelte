<script module lang="ts">
	import type { RunResult } from '#lib/domain/types.ts';

	export interface RunFormValues {
		date: string;
		result: RunResult;
		grams: number | null;
		hours: number | null;
		note: string;
		partSlug: string | null;
	}
</script>

<script lang="ts">
	import { RUN_RESULTS } from '#lib/domain/types.ts';
	import { today } from '#lib/domain/index.ts';

	let {
		gramsLabel = 'grams',
		parts,
		submitLabel = 'Log print',
		idPrefix,
		onsubmit
	}: {
		gramsLabel?: string;
		/** Optional "which color/part" picker (perPartRuns plates). */
		parts?: { slug: string; label: string }[];
		submitLabel?: string;
		idPrefix: string;
		onsubmit: (v: RunFormValues) => Promise<boolean> | boolean;
	} = $props();

	let date = $state(today());
	let result = $state<RunResult>('Success');
	let grams = $state('');
	let hours = $state('');
	let note = $state('');
	let partSlug = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		const ok = await onsubmit({
			date: date || today(),
			result,
			grams: grams === '' ? null : Number(grams),
			hours: hours === '' ? null : Number(hours),
			note: note.trim(),
			partSlug: parts?.length ? partSlug || parts[0].slug : null
		});
		busy = false;
		if (ok) {
			grams = hours = note = '';
			result = 'Success';
		}
	}
</script>

<form class="logform" onsubmit={submit}>
	<input type="date" id="{idPrefix}-d" bind:value={date} aria-label="Date" />
	<select id="{idPrefix}-r" bind:value={result} aria-label="Result">
		{#each RUN_RESULTS as r (r)}<option>{r}</option>{/each}
	</select>
	<input
		type="number"
		id="{idPrefix}-g"
		min="0"
		step="1"
		placeholder={gramsLabel}
		bind:value={grams}
		aria-label="Filament used, grams"
	/>
	<input
		type="number"
		id="{idPrefix}-h"
		min="0"
		step="0.1"
		placeholder="hours"
		bind:value={hours}
		aria-label="Print time, hours"
	/>
	{#if parts && parts.length > 1}
		<select class="span2" bind:value={partSlug} aria-label="Which color this run was">
			{#each parts as p (p.slug)}<option value={p.slug}>{p.label}</option>{/each}
		</select>
	{/if}
	<div class="wide">
		<input
			type="text"
			id="{idPrefix}-n"
			placeholder="Note (warping, stringing, fit…)"
			aria-label="Note"
			bind:value={note}
		/>
		<button class="btn primary" type="submit" disabled={busy}>{submitLabel}</button>
	</div>
</form>
