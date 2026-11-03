<script lang="ts">
	import { filamentLabel } from '#lib/domain/labels.ts';
	import { fmt, fmtSpools, type FilamentStat } from '#lib/domain/index.ts';
	import type { BuildView, FilamentRole } from '#lib/domain/types.ts';
	import { setBuildDesign } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	let {
		view,
		stats,
		activeRole = null,
		editingRole = null,
		onfilter,
		onedit,
		onadd
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
	} = $props();

	const ctx = getBuildCtx();
	const canEdit = $derived(view.canEdit);

	const statOf = (f: FilamentRole) => stats.find((s) => s.role === f.key);
	const partCount = (f: FilamentRole) => view.parts.filter((p) => p.role === f.key).length;
	const totalG = $derived(stats.reduce((a, s) => a + s.total, 0));
	const shortCount = $derived(stats.filter((s) => s.short && s.total > 0).length);

	function remove(f: FilamentRole) {
		void ctx.act(() => setBuildDesign(ctx.id, { removeRole: f.key }));
	}
</script>

<section class="slots" aria-label="Filament slots">
	<div class="head">
		<h2>Colors</h2>
		<span class="muted" data-testid="design-total">
			{fmt(totalG)} g in {view.filaments.length} slots{shortCount ? `, ${shortCount} short` : ''}
		</span>
	</div>
	<ul>
		{#each view.filaments as f (f.key)}
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
						aria-label="Change filament for {filamentLabel(f, f.key)}"
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
						<b>{filamentLabel(f, f.key)}</b>
						<span class="muted">{f.material} · {partCount(f)} parts · {fmt(grams)} g</span>
					</button>
					<div class="need" class:short={s?.short && grams > 0}>
						Needs {fmtSpools(grams / 1000)} kg, have {fmtSpools(f.spools)}
						{#if grams > 0}
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
							{#if partCount(f) === 0}
								<button type="button" class="btn sm danger" onclick={() => remove(f)}>Remove</button
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

<style>
	.slots {
		display: grid;
		gap: 10px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
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
		gap: 8px;
	}
	.slot {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 10px 12px;
		display: flex;
		gap: 12px;
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
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
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
			rgba(255, 255, 255, 0.28) 0 3px,
			transparent 3px 7px
		) !important;
	}
	.main {
		display: grid;
		gap: 6px;
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
		border-radius: 6px;
	}
	.need {
		font-size: 13px;
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
		gap: 8px;
		flex-wrap: wrap;
	}
</style>
