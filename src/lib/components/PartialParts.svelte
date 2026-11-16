<script lang="ts">
	import { partialTicksOk } from '#lib/domain/logrun.ts';

	/**
	 * "Which parts printed OK?" for a Partial print: a tick per part (or piece). Ticked parts count as
	 * printed, the rest are flagged for reprint. Starts empty; needs at least one ticked and one
	 * unticked, otherwise it says to choose Success or Failed. Shared by the log sheet and the
	 * printer-job confirmation; the caller owns the list of ticked slugs.
	 */
	let {
		parts,
		ticked = $bindable([]),
		legend = 'Which parts printed OK?'
	}: {
		parts: { slug: string; name: string; label?: string }[];
		ticked?: string[];
		legend?: string;
	} = $props();

	const uid = $props.id();
	const ok = $derived(
		partialTicksOk(
			parts.map((p) => p.slug),
			ticked
		)
	);

	function toggle(slug: string, on: boolean) {
		ticked = on ? [...ticked.filter((s) => s !== slug), slug] : ticked.filter((s) => s !== slug);
	}
</script>

<fieldset class="pp" data-testid="partial-parts" aria-describedby="{uid}-hint">
	<legend>{legend}</legend>
	<div class="pp-list">
		{#each parts as p (p.slug)}
			<label class="pp-row">
				<input
					type="checkbox"
					data-testid="partial-part-{p.slug}"
					checked={ticked.includes(p.slug)}
					onchange={(e) => toggle(p.slug, e.currentTarget.checked)}
				/>
				<span class="pp-name">{p.name}</span>
				{#if p.label}<small class="pp-label">{p.label}</small>{/if}
			</label>
		{/each}
	</div>
	<small
		id="{uid}-hint"
		class="pp-hint"
		class:pp-warn={!ok}
		data-testid="partial-hint"
		aria-live="polite"
	>
		{#if ok}
			Ticked parts count as printed; the others are flagged for reprint.
		{:else}
			Tick at least one part that printed OK and leave at least one unticked, or choose Success or
			Failed.
		{/if}
	</small>
</fieldset>

<style>
	.pp {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: grid;
		gap: var(--sp-3);
	}
	legend {
		font-size: var(--fs-sm);
		color: var(--muted);
		padding: 0;
		margin-bottom: var(--sp-2);
	}
	.pp-list {
		display: grid;
		gap: var(--sp-2);
		max-height: 14rem;
		overflow-y: auto;
	}
	.pp-row {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 44px;
		padding: 0 var(--sp-5);
		border: 1px solid var(--field-line);
		border-radius: var(--r-lg);
		background: var(--paper);
		cursor: pointer;
		min-width: 0;
	}
	.pp-row input {
		width: 20px;
		height: 20px;
		flex: none;
		margin: 0;
	}
	.pp-name {
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--ink);
		font-size: var(--fs-md);
	}
	.pp-label {
		margin-left: auto;
		color: var(--muted);
		white-space: nowrap;
	}
	.pp-hint {
		color: var(--muted);
	}
	.pp-warn {
		color: var(--bad);
	}
</style>
