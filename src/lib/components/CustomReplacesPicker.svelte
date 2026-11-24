<script module lang="ts">
	import type { BuildView } from '#lib/domain/types.ts';

	/** The kit parts a custom part can replace, as the picker lists them. */
	export interface ReplaceGroup {
		key: string;
		title: string;
		parts: { slug: string; name: string }[];
	}

	/**
	 * A build's active kit parts grouped by the plate they print on (custom plates left out); parts on no
	 * plate come last under "Not on a plate". Parts already marked Not printing are not in `view.parts`.
	 */
	export function kitGroupsOf(view: BuildView): ReplaceGroup[] {
		const kit = new Map(view.parts.filter((p) => !p.custom).map((p) => [p.slug, p]));
		const seen: Record<string, boolean> = {};
		const out: ReplaceGroup[] = [];
		for (const pl of view.plates) {
			if (pl.source.startsWith('custom:')) continue;
			const parts = pl.parts
				.filter((s) => kit.has(s) && !seen[s])
				.map((s) => ({ slug: s, name: kit.get(s)!.name }));
			parts.forEach((p) => (seen[p.slug] = true));
			if (parts.length)
				out.push({ key: `p${pl.number}`, title: `Plate ${pl.number} · ${pl.name}`, parts });
		}
		const rest = [...kit.values()].filter((p) => !seen[p.slug]);
		if (rest.length)
			out.push({
				key: 'rest',
				title: 'Not on a plate',
				parts: rest.map((p) => ({ slug: p.slug, name: p.name }))
			});
		return out;
	}
</script>

<script lang="ts">
	/**
	 * "Replaces kit parts": a collapsible list of kit parts (grouped by plate) to mark Not printing. Used by the
	 * add sheet and the confirm step for a saved part; `groups` comes from `kitGroupsOf(view)` or any list of
	 * the same shape. `selected` is the list of checked slugs (bindable).
	 */
	let {
		groups,
		selected = $bindable([]),
		open = false,
		hint = 'These parts are marked Not printing; you can bring them back. Nothing is deleted.',
		optional = true,
		testid = 'custom-replaces'
	}: {
		groups: ReplaceGroup[];
		selected: string[];
		/** Start expanded. */
		open?: boolean;
		hint?: string;
		/** Show the "optional" tag in the summary. */
		optional?: boolean;
		testid?: string;
	} = $props();

	function toggle(slug: string, on: boolean) {
		selected = on ? [...selected, slug] : selected.filter((s) => s !== slug);
	}
</script>

{#if groups.length}
	<details class="crp" data-testid={testid} {open}>
		<summary>
			Replaces kit parts{selected.length ? ` (${selected.length})` : ''}
			{#if optional}<span class="meta">optional</span>{/if}
		</summary>
		<p class="meta">{hint}</p>
		{#each groups as g (g.key)}
			<fieldset class="crp-group">
				<legend>{g.title}</legend>
				{#each g.parts as p (p.slug)}
					<label class="crp-chk">
						<input
							type="checkbox"
							checked={selected.includes(p.slug)}
							data-testid="custom-replace-part"
							data-slug={p.slug}
							onchange={(e) => toggle(p.slug, e.currentTarget.checked)}
						/>
						{p.name}
					</label>
				{/each}
			</fieldset>
		{/each}
	</details>
{/if}

<style>
	.crp {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--sp-4) var(--sp-5);
	}
	.crp summary {
		cursor: pointer;
		font-weight: 600;
	}
	.crp p {
		margin: var(--sp-3) 0;
	}
	.crp-group {
		border: 0;
		padding: 0;
		margin: var(--sp-4) 0 0;
		display: grid;
		gap: var(--sp-2);
	}
	.crp-group legend {
		padding: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
		font-weight: 600;
	}
	.crp-chk {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		min-height: 32px;
	}
</style>
