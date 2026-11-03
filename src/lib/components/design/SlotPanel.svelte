<script lang="ts">
	import { filamentLabel } from '#lib/domain/labels.ts';
	import { fmt, fmtSpools, type FilamentStat } from '#lib/domain/index.ts';
	import type { BuildView, FilamentRole } from '#lib/domain/types.ts';
	import { setBuildDesign, updateFilament } from '#lib/client/api.ts';
	import FilamentPicker, { type FilamentValue } from '#lib/components/FilamentPicker.svelte';
	import Swatch from '#lib/components/Swatch.svelte';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';

	let {
		view,
		stats,
		activeRole = null,
		onfilter
	}: {
		view: BuildView;
		stats: FilamentStat[];
		/** Slot whose parts are being looked at in the part list. */
		activeRole?: string | null;
		onfilter?: (role: string | null) => void;
	} = $props();

	const ctx = getBuildCtx();
	const canEdit = $derived(view.canEdit);

	let editing = $state<string | null>(null);
	let adding = $state(false);
	let draft = $state<FilamentValue>({ name: '', material: 'PETG', hex: '#808080' });

	const statOf = (f: FilamentRole) => stats.find((s) => s.role === f.key);
	const partCount = (f: FilamentRole) => view.parts.filter((p) => p.role === f.key).length;
	const totalG = $derived(stats.reduce((a, s) => a + s.total, 0));
	const shortCount = $derived(stats.filter((s) => s.short && s.total > 0).length);

	function save(f: FilamentRole, v: FilamentValue) {
		if (!v.name.trim()) return;
		void ctx.act(() =>
			updateFilament(ctx.id, f.key, { name: v.name, material: v.material, hex: v.hex })
		);
	}

	async function addColor() {
		if (!draft.name.trim()) {
			ctx.error = 'Give the new color a name.';
			return;
		}
		const ok = await ctx.act(() => setBuildDesign(ctx.id, { addRole: { ...draft } }));
		if (ok) {
			adding = false;
			draft = { name: '', material: 'PETG', hex: '#808080' };
		}
	}

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
			<li class="slot" class:on={activeRole === f.key} data-role={f.key}>
				<button
					type="button"
					class="pick"
					aria-pressed={activeRole === f.key}
					onclick={() => onfilter?.(activeRole === f.key ? null : f.key)}
					title="Show only the parts in this slot"
				>
					<Swatch hex={f.hex} tpu={f.tpu} />
					<span class="txt">
						<b>{filamentLabel(f, f.key)}</b>
						<span class="muted">{f.material} · {partCount(f)} parts · {fmt(grams)} g</span>
					</span>
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
							aria-expanded={editing === f.key}
							onclick={() => (editing = editing === f.key ? null : f.key)}
						>
							{editing === f.key ? 'Done' : 'Change filament'}
						</button>
						{#if partCount(f) === 0}
							<button type="button" class="btn sm danger" onclick={() => remove(f)}>Remove</button>
						{/if}
					</div>
				{/if}
				{#if editing === f.key && canEdit}
					<div class="editor">
						<FilamentPicker
							value={{ name: f.name, material: f.material, hex: f.hex }}
							preferMaterial={f.material}
							onchange={(v) => save(f, v)}
						/>
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	{#if canEdit}
		{#if adding}
			<div class="add card">
				<h3>Add a color</h3>
				<p class="muted">
					A new slot you can move parts to. PETG slots take rigid parts, TPU slots take flexible
					ones.
				</p>
				<FilamentPicker value={draft} preferMaterial="PETG" onchange={(v) => (draft = v)} />
				<div class="acts">
					<button type="button" class="btn primary sm" onclick={addColor}>Add color</button>
					<button type="button" class="btn sm" onclick={() => (adding = false)}>Cancel</button>
				</div>
			</div>
		{:else}
			<button type="button" class="btn" onclick={() => (adding = true)}>Add a color</button>
		{/if}
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
	h2,
	h3 {
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
		display: grid;
		gap: 6px;
	}
	.slot.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.pick {
		all: unset;
		cursor: pointer;
		display: flex;
		gap: 10px;
		align-items: center;
		min-width: 0;
	}
	.pick:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 6px;
	}
	.txt {
		display: grid;
		min-width: 0;
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
	.editor,
	.add {
		margin-top: 4px;
	}
</style>
