<script lang="ts">
	import type { VariantGroup } from '#lib/domain/types.ts';

	/**
	 * One radio list per variant group. Presentational: the parent owns `choices`
	 * and reacts to `onselect` (build Settings calls the API; the New build form
	 * just stores it). With `fieldPrefix` the radios carry `name="<prefix><group>"`
	 * so a plain form post includes the choices.
	 */
	let {
		groups,
		choices,
		partNames = {},
		disabled = false,
		fieldPrefix = '',
		onselect
	}: {
		groups: VariantGroup[];
		choices: Record<string, string>;
		partNames?: Record<string, string>;
		disabled?: boolean;
		fieldPrefix?: string;
		onselect?: (group: string, option: string) => void;
	} = $props();

	const chosen = (g: VariantGroup) => choices[g.key] ?? g.defaultOption;
</script>

{#if groups.length}
	<div class="variants">
		{#each groups as g (g.key)}
			<fieldset class="vc-group" {disabled}>
				<legend>{g.name}</legend>
				{#each g.options as o (o.key)}
					<label class="opt" class:on={chosen(g) === o.key}>
						<input
							type="radio"
							name={`${fieldPrefix}${g.key}`}
							value={o.key}
							checked={chosen(g) === o.key}
							onchange={() => onselect?.(g.key, o.key)}
						/>
						<span class="text">
							<b>{o.name}</b>
							{#if o.description}<span class="muted">{o.description}</span>{/if}
							<span class="parts muted">
								{#if o.parts.length}
									Prints: {o.parts.map((s) => partNames[s] ?? s).join(', ')}
								{:else}
									Prints nothing
								{/if}
							</span>
						</span>
					</label>
				{/each}
			</fieldset>
		{/each}
	</div>
{/if}

<style>
	.variants {
		display: grid;
		gap: 0.75rem;
	}
	.vc-group {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	legend {
		padding: 0;
		margin-bottom: 0.25rem;
		font-weight: 600;
	}
	.opt {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--line);
		background: var(--card);
		border-radius: 8px;
		cursor: pointer;
	}
	.opt.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.opt input {
		margin-top: 0.25rem;
	}
	.text {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}
	.parts {
		font-size: 0.85em;
	}
	fieldset:disabled .opt {
		cursor: default;
	}
</style>
