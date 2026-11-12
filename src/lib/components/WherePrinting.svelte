<script lang="ts">
	import Dialog from './design/share/Dialog.svelte';

	/**
	 * "Where is it printing?": the small dialog behind choosing Printing when the workspace has
	 * enabled printers. A radio per printer (the first preselected) and "Not on a connected printer".
	 * `parts` (more than one) adds a "Which part?" choice, for plates that print one part per run.
	 * Nothing is sent to the printer: the line below the list says so.
	 */
	let {
		printers,
		parts = [],
		onconfirm,
		onclose
	}: {
		printers: { id: string; name: string }[];
		parts?: { slug: string; name: string }[];
		onconfirm: (printerId: string | null, slug: string | null) => void;
		onclose: () => void;
	} = $props();
	const uid = $props.id();
	// svelte-ignore state_referenced_locally
	let where = $state<string>(printers[0]?.id ?? '');
	// svelte-ignore state_referenced_locally
	let part = $state<string>(parts[0]?.slug ?? '');
</script>

<Dialog title="Where is it printing?" {onclose} testid="where-printing">
	{#if parts.length > 1}
		<fieldset class="wp-set">
			<legend>Which part?</legend>
			{#each parts as p (p.slug)}
				<label class="wp-opt">
					<input
						type="radio"
						name="{uid}-part"
						value={p.slug}
						bind:group={part}
						data-testid="where-part-{p.slug}"
					/>
					<span>{p.name}</span>
				</label>
			{/each}
		</fieldset>
	{/if}
	<fieldset class="wp-set">
		<legend class="wp-sr">Printer</legend>
		{#each printers as p (p.id)}
			<label class="wp-opt">
				<input
					type="radio"
					name="{uid}-where"
					value={p.id}
					bind:group={where}
					data-testid="where-printer-{p.id}"
				/>
				<span>{p.name}</span>
			</label>
		{/each}
		<label class="wp-opt">
			<input type="radio" name="{uid}-where" value="" bind:group={where} data-testid="where-none" />
			<span>Not on a connected printer</span>
		</label>
	</fieldset>
	<p class="muted wp-note">
		Start the print at the printer. The Build Tracker never sends a print to it.
	</p>
	<div class="wp-foot">
		<button class="btn" type="button" data-cancel onclick={onclose}>Cancel</button>
		<button
			class="btn primary"
			type="button"
			data-testid="where-confirm"
			onclick={() => onconfirm(where || null, parts.length > 1 ? part : null)}
			>Mark as printing</button
		>
	</div>
</Dialog>

<style>
	.wp-set {
		border: 0;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-2);
	}
	.wp-set legend {
		font-weight: 600;
		padding: 0 0 var(--sp-3);
	}
	.wp-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.wp-opt {
		display: flex;
		align-items: center;
		gap: var(--sp-5);
		min-height: 44px;
		padding: 0 var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.wp-opt:has(input:checked) {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.wp-opt input {
		margin: 0;
		flex: none;
	}
	.wp-note {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.wp-foot {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--sp-4);
	}
</style>
