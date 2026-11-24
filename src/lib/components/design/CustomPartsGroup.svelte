<script lang="ts">
	import { filamentLabel, roleLabel } from '#lib/domain/labels.ts';
	import type { BuildView, CustomPiece } from '#lib/domain/types.ts';
	import { recolorCustomPiece } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import { resolve } from '$app/paths';
	import Swatch from '#lib/components/Swatch.svelte';

	/**
	 * "Custom parts" under the kit's parts: the maker's own accessories, set in the build's colors
	 * from here. They are not part of the color design and not drawn on the chair, so this never
	 * goes through the design mutation (and never writes part roles): it is `recolorCustomPiece`.
	 */
	let {
		view,
		pieces,
		canAdd = false,
		announce
	}: {
		view: BuildView;
		/** The pieces to list (the part list filters them by its search and slot filter). */
		pieces: CustomPiece[];
		/** Offer "Add a custom part" (to the Files tab): off in the wizard and while a search or filter is on. */
		canAdd?: boolean;
		announce?: (msg: string) => void;
	} = $props();

	const ctx = getBuildCtx();
	const canEdit = $derived(view.canEdit);
	let busyId = $state<string | null>(null);

	const fil = (role: string) => view.filaments.find((f) => f.key === role);
	const label = (role: string) => filamentLabel(fil(role), role);

	async function recolor(
		c: CustomPiece,
		slug: string,
		from: string,
		to: string,
		el: HTMLSelectElement
	) {
		if (busyId || from === to) return;
		busyId = c.id;
		const ok = await ctx.act(() => recolorCustomPiece(ctx.id, c.id, { [slug]: { [from]: to } }));
		// A refused change (printing, gone) leaves the select on the saved color.
		if (!ok) el.value = from;
		else announce?.(`${c.name} is now ${roleLabel(to, fil(to), view.filaments)}`);
		busyId = null;
	}
</script>

{#if pieces.length || (canEdit && canAdd)}
	<div class="pgroup cpg" data-testid="design-custom-parts">
		<h3>Custom parts</h3>
		{#if pieces.length}
			<p class="muted cp-note">Not shown on the chair. Their colors count toward the filament.</p>
			<ul>
				{#each pieces as c (c.id)}
					<li class="cp-row" data-testid="design-custom-part" data-piece={c.id}>
						<span class="cp-name" title={c.name}>{c.name}</span>
						<div class="cp-colors">
							{#each c.colors as pc (pc.slug)}
								{#each pc.roles as r (r.role)}
									{@const f = fil(r.role)}
									{@const caption = `${c.colors.length > 1 ? pc.name : 'Color'}${
										pc.roles.length > 1 ? ` · ${label(r.role)}` : ''
									}${r.grams ? ` (${r.grams} g)` : ''}`}
									<div class="cp-color">
										<span class="cp-cap muted">{caption}</span>
										{#if canEdit}
											<span class="cp-pick">
												{#if f}<Swatch hex={f.hex} tpu={f.tpu} size="mini" />{/if}
												<select
													value={r.role}
													data-testid="design-custom-color"
													aria-label="Color of {c.name}{c.colors.length > 1
														? `, ${pc.name}`
														: ''}{pc.roles.length > 1 ? `, now ${label(r.role)}` : ''}"
													disabled={busyId === c.id}
													onchange={(e) =>
														void recolor(
															c,
															pc.slug,
															r.role,
															e.currentTarget.value,
															e.currentTarget
														)}
												>
													{#each view.filaments as o (o.key)}
														<option value={o.key}>{o.name} ({o.material})</option>
													{/each}
												</select>
											</span>
										{:else}
											<span class="cp-pick cp-ro" data-testid="design-custom-color">
												{#if f}<Swatch hex={f.hex} tpu={f.tpu} size="mini" />{/if}
												<span class="cp-roname">{f ? `${f.name} (${f.material})` : r.role}</span>
											</span>
										{/if}
									</div>
								{/each}
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
		{#if canEdit && canAdd}
			<p class="cp-add">
				<a
					class="btn sm"
					href={resolve('/(app)/builds/[id]/files', { id: ctx.id })}
					data-testid="design-custom-add">Add a custom part</a
				>
			</p>
		{/if}
	</div>
{/if}

<style>
	/* .pgroup / h3 / ul are scoped to this component too: they restate the part list's group look. */
	.cpg {
		display: grid;
		gap: var(--sp-2);
	}
	h3 {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
		padding: var(--sp-2) var(--sp-1);
		background: var(--paper);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-1);
	}
	.cp-note {
		margin: 0;
		padding: 0 var(--sp-1);
		font-size: var(--fs-xs);
	}
	.cp-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-2);
		padding: var(--sp-3) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--card);
		min-width: 0;
	}
	.cp-name {
		font-weight: 500;
		font-size: var(--fs-md);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cp-colors {
		display: grid;
		gap: var(--sp-2);
		grid-template-columns: minmax(0, 1fr);
	}
	.cp-color {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--sp-1);
		min-width: 0;
	}
	.cp-cap {
		font-size: var(--fs-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cp-pick {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
		min-width: 0;
	}
	.cp-pick select {
		flex: 1 1 auto;
		min-width: 0;
		max-width: 100%;
		padding: var(--sp-2) var(--sp-3);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font-size: var(--fs-base);
	}
	.cp-roname {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-base);
	}
	.cp-add {
		margin: var(--sp-2) 0 0;
	}
	@media (pointer: coarse) {
		.cp-pick select {
			min-height: 44px;
		}
		.cp-add .btn {
			min-height: 44px;
		}
	}
	@media (min-width: 560px) {
		.cp-color {
			grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
			align-items: center;
		}
	}
</style>
