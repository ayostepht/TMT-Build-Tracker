<script lang="ts">
	import { filamentLabel, roleLabel, sortRoles } from '#lib/domain/labels.ts';
	import { removeImpact, replacementOptions } from '#lib/domain/design.ts';
	import { fmtSpools } from '#lib/domain/index.ts';
	import type { BuildView } from '#lib/domain/types.ts';
	import Swatch from '#lib/components/Swatch.svelte';
	import Dialog from './share/Dialog.svelte';

	/**
	 * Removing a color that parts still use: lists the parts and asks which of the design's other
	 * filaments replaces it. Confirm reassigns them and removes the slot in one step; Cancel changes
	 * nothing. Blocked replacements (a part's material does not fit) stay visible but disabled.
	 */
	let {
		view,
		roleKey,
		busy = false,
		onconfirm,
		oncancel
	}: {
		view: BuildView;
		roleKey: string;
		busy?: boolean;
		onconfirm: (replaceWith: string) => void;
		oncancel: () => void;
	} = $props();

	const slot = $derived(view.filaments.find((f) => f.key === roleKey));
	const impact = $derived(removeImpact(view, roleKey));
	const options = $derived(sortRoles(replacementOptions(view, roleKey), (o) => o.filament.key));
	const stock = $derived(!!slot && (slot.spools > 0 || slot.spoolmanSpoolId !== null));
	let chosen = $state('');
	const n = $derived(impact.length);
</script>

<Dialog
	title="Remove {slot ? roleLabel(roleKey, slot, view.filaments) : 'this color'}"
	onclose={oncancel}
	testid="remove-color-dialog"
	danger
>
	<p class="rc-lead" data-testid="remove-color-lead">
		This filament is assigned to {n}
		{n === 1 ? 'part' : 'parts'}. Choose the filament that replaces it.
	</p>

	<ul class="rc-parts" aria-label="Parts that move" data-testid="remove-color-parts">
		{#each impact as { part, inactive } (part.slug)}
			<li data-slug={part.slug}>
				<span class="rc-name">{part.name}</span>
				{#if inactive}<span class="rc-tag" title="Not used by the current options; it moves too"
						>other option</span
					>{/if}
				{#if part.locked}<span class="rc-tag" title="Stays locked on the replacement">locked</span
					>{/if}
			</li>
		{/each}
	</ul>

	<fieldset class="rc-pick">
		<legend>Replacement filament</legend>
		{#each options as o (o.filament.key)}
			{@const f = o.filament}
			<label class="rc-opt" class:rc-off={!o.ok} class:rc-on={chosen === f.key}>
				<input
					type="radio"
					name="remove-replace"
					value={f.key}
					disabled={!o.ok}
					bind:group={chosen}
					data-testid="remove-replace-{f.key}"
				/>
				<Swatch hex={f.hex} tpu={f.tpu} size="mini" />
				<span class="rc-text">
					<b>{roleLabel(f.key, f, view.filaments)}</b>
					{#if roleLabel(f.key, f, view.filaments) !== filamentLabel(f, f.key)}<span class="rc-sub"
							>{filamentLabel(f, f.key)}</span
						>{/if}
					{#if o.reason}<span class="rc-why">{o.reason}</span>{/if}
				</span>
			</label>
		{/each}
	</fieldset>

	{#if stock && slot}
		<p class="rc-note">
			Its {slot.spools > 0
				? `${fmtSpools(slot.spools)} spools on hand`
				: 'stock'}{slot.spoolmanSpoolId !== null ? ' and Spoolman link' : ''} are dropped with it.
		</p>
	{/if}

	<div class="rc-acts">
		<button
			type="button"
			class="btn"
			data-cancel
			data-testid="remove-color-cancel"
			onclick={oncancel}>Cancel</button
		>
		<button
			type="button"
			class="btn danger"
			data-testid="remove-color-confirm"
			disabled={busy || !chosen}
			onclick={() => onconfirm(chosen)}>Remove and reassign</button
		>
	</div>
</Dialog>

<style>
	.rc-lead {
		margin: 0;
	}
	.rc-parts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-3);
		max-height: 7.5rem;
		overflow-y: auto;
	}
	.rc-parts li {
		display: inline-flex;
		gap: var(--sp-2);
		align-items: center;
		min-width: 0;
		padding: var(--sp-1) var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--card);
		font-size: var(--fs-sm);
	}
	.rc-name {
		overflow-wrap: anywhere;
	}
	.rc-tag {
		font: 500 var(--fs-xs) / 1 var(--f-mono);
		color: var(--muted);
		white-space: nowrap;
	}
	.rc-pick {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-3);
		max-height: 40vh;
		overflow-y: auto;
	}
	legend {
		padding: 0 0 var(--sp-3);
		font-weight: 600;
		font-size: var(--fs-sm);
	}
	.rc-opt {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		min-height: 44px;
		padding: var(--sp-3) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--paper);
		cursor: pointer;
		min-width: 0;
	}
	.rc-opt:hover:not(.rc-off) {
		border-color: var(--accent);
	}
	.rc-opt.rc-on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.rc-opt:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.rc-opt.rc-off {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.rc-opt input {
		flex: none;
		width: 20px;
		height: 20px;
		margin: 0;
	}
	.rc-text {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--sp-4);
		align-items: baseline;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.rc-sub {
		color: var(--muted);
		font-size: var(--fs-sm);
	}
	.rc-why {
		flex-basis: 100%;
		color: var(--warn);
		font-size: var(--fs-xs);
	}
	.rc-note {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.rc-acts {
		display: flex;
		gap: var(--sp-4);
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	@media (pointer: coarse) {
		.rc-acts .btn {
			min-height: 44px;
		}
	}
</style>
