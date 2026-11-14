<script lang="ts">
	import { filamentLabel, roleLabel, sortRoles } from '#lib/domain/labels.ts';
	import { fmt, fmtSpools, type FilamentStat } from '#lib/domain/index.ts';
	import type { BuildView, FilamentRole } from '#lib/domain/types.ts';
	import { setBuildDesign } from '#lib/client/api.ts';
	import { removeImpact } from '#lib/domain/design.ts';
	import RemoveColorDialog from './RemoveColorDialog.svelte';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	let {
		view,
		stats,
		activeRole = null,
		editingRole = null,
		onfilter,
		onedit,
		onadd,
		announce
	}: {
		view: BuildView;
		stats: FilamentStat[];
		/** Slot whose parts are being looked at in the part list. */
		activeRole?: string | null;
		/** Slot whose swatch picker is open. */
		editingRole?: string | null;
		onfilter?: (role: string | null) => void;
		onedit?: (role: string) => void;
		onadd?: () => void;
		/** Spoken confirmation for screen readers. */
		announce?: (msg: string) => void;
	} = $props();

	const ctx = getBuildCtx();
	const canEdit = $derived(view.canEdit);
	/** Studio drafts have no spools on hand: show what the design needs, not stock. */
	const draft = $derived(view.build.kind === 'draft');

	const statOf = (f: FilamentRole) => stats.find((s) => s.role === f.key);
	const partCount = (f: FilamentRole) => view.parts.filter((p) => p.role === f.key).length;
	const totalG = $derived(stats.reduce((a, s) => a + s.total, 0));
	const shortCount = $derived(draft ? 0 : stats.filter((s) => s.short && s.total > 0).length);

	/** Slot being removed while parts still use it: its dialog is open. */
	let removing = $state<string | null>(null);
	let removeBusy = $state(false);
	const removingSlot = $derived(view.filaments.find((f) => f.key === removing));
	// Close the dialog if its slot disappears (someone else removed it) or editing is no longer allowed.
	$effect(() => {
		if (removing && (!removingSlot || !canEdit)) removing = null;
	});

	/** Every part counts, also those of unchosen variant options: the server moves them too. */
	function remove(f: FilamentRole) {
		if (removeImpact(view, f.key).length) removing = f.key;
		else void ctx.act(() => setBuildDesign(ctx.id, { removeRole: f.key }));
	}

	async function confirmRemove(replaceWith: string) {
		const f = removingSlot;
		if (!f) return;
		const to = view.filaments.find((x) => x.key === replaceWith);
		const n = removeImpact(view, f.key).length;
		removeBusy = true;
		const ok = await ctx.act(() => setBuildDesign(ctx.id, { removeRole: f.key, replaceWith }));
		removeBusy = false;
		removing = null;
		if (ok)
			announce?.(
				`Removed ${roleLabel(f.key, f, view.filaments)}. ${n} ${n === 1 ? 'part' : 'parts'} moved to ${roleLabel(replaceWith, to, view.filaments)}`
			);
	}
</script>

<section class="slots" aria-label="Filament slots">
	<div class="slot-head">
		<h2>Colors</h2>
		<span class="muted" data-testid="design-total">
			{fmt(totalG)} g in {view.filaments.length} slots{shortCount ? `, ${shortCount} short` : ''}
		</span>
	</div>
	<ul>
		{#each sortRoles(view.filaments, (x) => x.key) as f (f.key)}
			{@const s = statOf(f)}
			{@const grams = s?.total ?? 0}
			{@const spare = s ? s.haveGrams - s.used - s.need : 0}
			<li
				class="slot"
				class:on={activeRole === f.key}
				class:editing={editingRole === f.key}
				data-role={f.key}
			>
				{#if canEdit}
					<button
						type="button"
						class="big"
						class:tpu={f.tpu}
						style="background-color:{f.hex}"
						aria-label="Change filament for {roleLabel(f.key, f, view.filaments)}"
						title="Pick a different filament"
						onclick={() => onedit?.(f.key)}
					></button>
				{:else}
					<span class="big" class:tpu={f.tpu} style="background-color:{f.hex}" aria-hidden="true"
					></span>
				{/if}
				<div class="main">
					<button
						type="button"
						class="pick"
						aria-pressed={activeRole === f.key}
						onclick={() => onfilter?.(activeRole === f.key ? null : f.key)}
						title="Show only the parts in this slot"
					>
						<b>{roleLabel(f.key, f, view.filaments)}</b>
						{#if roleLabel(f.key, f, view.filaments) !== filamentLabel(f, f.key)}<span class="fname"
								>{filamentLabel(f, f.key)}</span
							>{/if}
						<span class="muted">{f.material} · {partCount(f)} parts · {fmt(grams)} g</span>
					</button>
					<div class="need" class:short={!draft && s?.short && grams > 0}>
						Needs {fmtSpools(grams / 1000)} kg{#if !draft}, have {fmtSpools(f.spools)}{/if}
						{#if grams > 0 && !draft}
							{#if spare < 0}<span class="flag">short</span>{:else}<span class="ok">ok</span>{/if}
						{/if}
					</div>
					{#if canEdit}
						<div class="acts">
							<button
								type="button"
								class="btn sm"
								aria-expanded={editingRole === f.key}
								onclick={() => onedit?.(f.key)}
							>
								Change filament
							</button>
							{#if !f.kit}
								<button
									type="button"
									class="btn sm danger"
									data-testid="remove-color"
									aria-label="Remove {roleLabel(f.key, f, view.filaments)}"
									onclick={() => remove(f)}>Remove</button
								>
							{/if}
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#if canEdit}
		<button type="button" class="btn" onclick={() => onadd?.()}>Add a color</button>
	{/if}
</section>

{#if removing && removingSlot}
	<RemoveColorDialog
		{view}
		roleKey={removing}
		busy={removeBusy}
		onconfirm={confirmRemove}
		oncancel={() => (removing = null)}
	/>
{/if}

<style>
	.slots {
		display: grid;
		gap: var(--sp-5);
	}
	.slot-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	h2 {
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-4);
	}
	.slot {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-5) var(--sp-6);
		display: flex;
		gap: var(--sp-6);
		align-items: flex-start;
	}
	.slot.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.slot.editing {
		border-color: var(--accent);
	}
	.big {
		flex: none;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		border: 2px solid var(--line);
		box-shadow: var(--ring-swatch);
		padding: 0;
		display: block;
	}
	button.big {
		cursor: pointer;
	}
	button.big:hover,
	button.big:focus-visible {
		border-color: var(--accent);
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.big.tpu {
		background-image: repeating-linear-gradient(
			45deg,
			var(--tpu-stripe) 0 3px,
			transparent 3px 7px
		) !important;
	}
	.main {
		display: grid;
		gap: var(--sp-3);
		min-width: 0;
		flex: 1;
	}
	.pick {
		all: unset;
		cursor: pointer;
		display: grid;
		min-width: 0;
	}
	.pick:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: var(--r-md);
	}
	.fname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.need {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.need.short {
		color: var(--warn);
	}
	.flag {
		font-weight: 600;
		color: var(--warn);
	}
	.ok {
		color: var(--ok);
	}
	.acts {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
</style>
