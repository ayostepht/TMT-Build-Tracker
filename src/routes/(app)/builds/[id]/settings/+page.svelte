<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { BUILD_PHASES, type BuildPhase, type FilamentRole } from '#lib/domain/types.ts';
	import { updateBuild, updateFilament, deleteBuild } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import FilamentPicker from '#lib/components/FilamentPicker.svelte';
	import MoveToChapter from '#lib/components/MoveToChapter.svelte';

	const ctx = getBuildCtx();
	const b = $derived(ctx.view.build);

	// Drafts start from the saved values; they only reset when the saved value changes.
	let name = $derived(b.name);
	let recipient = $derived(b.recipient ?? '');
	let hospital = $derived(b.hospital ?? '');
	let deliveryDate = $derived(b.deliveryDate ?? '');
	let phase = $derived<BuildPhase>(b.phase);
	let saved = $state('');

	async function saveBuild(e: SubmitEvent) {
		e.preventDefault();
		const ok = await ctx.act(() =>
			updateBuild(ctx.id, {
				name: name.trim() || b.name,
				recipient: recipient.trim() || null,
				hospital: hospital.trim() || null,
				deliveryDate: deliveryDate || null,
				phase
			})
		);
		saved = ok ? 'Saved' : '';
		setTimeout(() => (saved = ''), 2000);
	}

	function saveFil(
		f: FilamentRole,
		patch: Partial<Pick<FilamentRole, 'name' | 'hex' | 'material' | 'spools'>>
	) {
		ctx.act(() => updateFilament(ctx.id, f.key, patch));
	}

	let confirming = $state(false);
	let confirmText = $state('');
	async function remove() {
		if (confirmText !== b.name) return;
		if (await ctx.act(() => deleteBuild(ctx.id))) await goto(resolve('/(app)'));
	}
</script>

<form class="card" onsubmit={saveBuild}>
	<h2>Build details</h2>
	<div class="form-grid">
		<label class="field">Name <input bind:value={name} disabled={!ctx.canEdit} required /></label>
		<label class="field"
			>Phase
			<select bind:value={phase} disabled={!ctx.canEdit}>
				{#each BUILD_PHASES as p (p)}<option value={p}>{p}</option>{/each}
			</select>
		</label>
		<label class="field">Recipient <input bind:value={recipient} disabled={!ctx.canEdit} /></label>
		<label class="field">Hospital <input bind:value={hospital} disabled={!ctx.canEdit} /></label>
		<label class="field"
			>Delivery date <input type="date" bind:value={deliveryDate} disabled={!ctx.canEdit} /></label
		>
	</div>
	{#if ctx.canEdit}
		<div>
			<button class="btn primary" type="submit">Save details</button>
			<span class="muted" role="status">{saved}</span>
		</div>
	{/if}
</form>

<section class="card">
	<h2>Filament</h2>
	<p class="muted">
		Names, colors and spools for this build. The template's roles stay the same; only this build
		changes.
	</p>
	{#each ctx.view.filaments as f (f.key)}
		<div class="fil-role" data-role={f.key}>
			<FilamentPicker
				value={{ name: f.name, material: f.material, hex: f.hex }}
				preferMaterial={f.tpu ? 'TPU 95A' : 'PETG'}
				disabled={!ctx.canEdit}
				onchange={(v) => saveFil(f, v)}
			/>
			<label class="field"
				>Spools (kg)
				<input
					type="number"
					min="0"
					step="0.01"
					value={f.spools}
					disabled={!ctx.canEdit}
					onchange={(e) => saveFil(f, { spools: Math.max(0, Number(e.currentTarget.value) || 0) })}
				/></label
			>
		</div>
	{/each}
</section>

<MoveToChapter />

{#if ctx.view.role === 'owner'}
	<section class="card danger-zone">
		<h2>Delete build</h2>
		<p class="muted">
			Deletes this build with all its progress and print logs for everyone on the team. This cannot
			be undone.
		</p>
		{#if !confirming}
			<div>
				<button class="btn danger" type="button" onclick={() => (confirming = true)}
					>Delete this build…</button
				>
			</div>
		{:else}
			<div
				role="alertdialog"
				aria-labelledby="delTitle"
				class="stack"
				style="display:grid;gap:10px"
			>
				<strong id="delTitle">Type the build name to confirm: {b.name}</strong>
				<input
					aria-label="Build name"
					bind:value={confirmText}
					autocomplete="off"
					style="padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:var(--paper)"
				/>
				<div>
					<button
						class="btn danger solid"
						type="button"
						disabled={confirmText !== b.name}
						onclick={remove}>Delete forever</button
					>
					<button
						class="btn"
						type="button"
						onclick={() => ((confirming = false), (confirmText = ''))}>Cancel</button
					>
				</div>
			</div>
		{/if}
	</section>
{/if}

<style>
	.fil-role {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 140px;
		gap: 10px;
		align-items: end;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	@media (max-width: 640px) {
		.fil-role {
			grid-template-columns: 1fr;
		}
	}
</style>
