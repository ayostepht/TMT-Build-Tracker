<script lang="ts">
	import { parseGrams, plateGramsBadge } from '#lib/domain/index.ts';
	import type { Plate } from '#lib/domain/types.ts';
	import { updatePart } from '#lib/client/api.ts';
	import { getBuildCtx } from './build-context.svelte.ts';

	/**
	 * A plate's grams next to its time: "~417 g", "417 g · your entry", "≥ 417 g · 1 part without
	 * weight". The flag opens a small form to add the missing weights (whole part, all copies).
	 */
	let { plate }: { plate: Plate } = $props();
	const ctx = getBuildCtx();
	const badge = $derived(plateGramsBadge(ctx.view, plate));

	let open = $state(false);
	let draft = $state<Record<string, string>>({});
	let busy = $state(false);
	const nameOf = (slug: string) => ctx.view.allParts.find((p) => p.slug === slug)?.name ?? slug;
	const bad = (slug: string) => {
		const v = parseGrams(draft[slug] ?? '');
		return v !== null && (Number.isNaN(v) || v > 20000);
	};

	async function save(e: Event) {
		e.preventDefault();
		if (busy || !badge) return;
		const todo = badge.unknown.filter((s) => {
			const v = parseGrams(draft[s] ?? '');
			return v !== null && !Number.isNaN(v) && v > 0;
		});
		if (!todo.length || badge.unknown.some(bad)) return;
		busy = true;
		let ok = true;
		for (const s of todo)
			ok =
				(await ctx.act(() => updatePart(ctx.id, s, { manualGrams: parseGrams(draft[s]) }))) && ok;
		busy = false;
		if (ok) {
			open = false;
			draft = {};
		}
	}
</script>

{#if badge}
	<span class="pgrams meta num" data-testid="plate-grams" data-source={badge.source}>
		{#if badge.main}
			<span title={badge.title} data-testid="plate-grams-main">{badge.main}</span>
			{#if badge.note}<span class="base">{' · ' + badge.note}</span>{/if}
			{#if badge.total}<span class="base">{' · ' + badge.total}</span>{/if}
		{/if}
		{#if badge.flag}
			{#if badge.main}<span class="base">&#32;·&#32;</span>{/if}
			{#if ctx.canEdit && badge.unknown.length}
				<button
					class="pill-link gflag"
					type="button"
					aria-expanded={open}
					data-testid="plate-grams-flag"
					title="Add the missing weights"
					onclick={() => (open = !open)}>{badge.flag}</button
				>
			{:else}<span class="base" data-testid="plate-grams-flag">{badge.flag}</span>{/if}
		{/if}
	</span>
	{#if open && ctx.canEdit}
		<form class="gform" onsubmit={save} data-testid="plate-grams-form">
			{#each badge.unknown as s (s)}
				<label class="grow"
					><span>{nameOf(s)}, all copies (g)</span>
					<input
						type="text"
						inputmode="decimal"
						autocomplete="off"
						placeholder="g"
						aria-label="Weight of {nameOf(s)} in grams"
						aria-invalid={bad(s)}
						bind:value={draft[s]}
					/></label
				>
			{/each}
			<button class="btn sm primary" type="submit" disabled={busy}>Save weight</button>
			<button class="btn sm ghost" type="button" onclick={() => (open = false)}>Cancel</button>
		</form>
	{/if}
{/if}

<style>
	.base {
		color: var(--muted);
		font-weight: 400;
	}
	.gflag {
		font-size: inherit;
	}
	.gform {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
	.grow {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
		color: var(--muted);
	}
	.grow input {
		width: 8rem;
		font-size: 14px;
	}
	@media (pointer: coarse) {
		.grow input {
			font-size: 16px;
		}
	}
</style>
