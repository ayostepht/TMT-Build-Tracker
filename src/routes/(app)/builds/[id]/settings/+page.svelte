<script lang="ts">
	import { focusIn } from '#lib/client/focus-trap.ts';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { BUILD_PHASES, type BuildPhase, type FilamentRole } from '#lib/domain/types.ts';
	import { filamentLabel } from '#lib/domain/labels.ts';
	import { updateBuild, updateFilament, deleteBuild } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import Swatch from '#lib/components/Swatch.svelte';
	import MoveToChapter from '#lib/components/MoveToChapter.svelte';
	import SpoolLink from '#lib/components/SpoolLink.svelte';
	import DraftSettings from '#lib/components/build/DraftSettings.svelte';

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

<svelte:head><title>Settings · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

{#if b.kind === 'draft'}
	<DraftSettings />
{:else}
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
			<label class="field">Recipient <input bind:value={recipient} disabled={!ctx.canEdit} /></label
			>
			<label class="field">Hospital <input bind:value={hospital} disabled={!ctx.canEdit} /></label>
			<label class="field"
				>Delivery date <input
					type="date"
					bind:value={deliveryDate}
					disabled={!ctx.canEdit}
				/></label
			>
		</div>
		{#if ctx.canEdit}
			<div>
				<button class="btn primary" type="submit">Save details</button>
				<span class="muted" role="status">{saved}</span>
			</div>
		{/if}
	</form>

	<section class="card" data-testid="settings-filament">
		<h2>Filament</h2>
		<p class="muted">
			The colors this build uses, and how many spools you have of each. Colors are chosen in the
			Design tab.
		</p>
		{#each ctx.view.filaments as f (f.key)}
			<div class="fil-role" data-role={f.key}>
				<div class="fil-sum">
					<Swatch hex={f.hex} tpu={f.tpu} />
					<span class="fil-name">{filamentLabel(f, f.key)}</span>
				</div>
				<label class="field"
					>Spools (kg)
					<input
						type="number"
						min="0"
						step="0.25"
						inputmode="decimal"
						value={f.spools}
						disabled={!ctx.canEdit}
						onchange={(e) =>
							saveFil(f, {
								spools: Math.min(
									99,
									Math.max(0, Math.round((Number(e.currentTarget.value) || 0) * 100) / 100)
								)
							})}
					/></label
				>
			</div>
		{/each}
		<div>
			<a
				class="btn go"
				href={resolve('/(app)/builds/[id]/design', { id: ctx.id })}
				data-testid="change-colors"
				>Change colors in Design <span class="btn-arrow" aria-hidden="true">→</span></a
			>
		</div>
		<SpoolLink />
	</section>

	<section class="card">
		<h2>Setup</h2>
		<p class="muted">Choose the kit files, options, colors and printer again, step by step.</p>
		<div>
			<a
				class="btn"
				href={resolve('/(app)/builds/[id]/setup', { id: ctx.id })}
				data-testid="rerun-setup">Open the setup steps</a
			>
		</div>
	</section>

	<MoveToChapter />

	{#if ctx.view.role === 'owner'}
		<section class="card danger-zone">
			<h2>Delete build</h2>
			<p class="muted">
				Deletes this build with all its progress and print logs for everyone who can see it. This
				cannot be undone.
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
					tabindex="-1"
					use:focusIn={'input'}
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
{/if}

<style>
	.fil-role {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(110px, 160px);
		gap: 10px;
		align-items: end;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.fil-role .field,
	.fil-role .field input {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}
	.fil-sum {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.fil-name {
		min-width: 0;
		overflow-wrap: anywhere;
		font-weight: 600;
	}
	@media (max-width: 640px) {
		.fil-role {
			grid-template-columns: 1fr;
		}
	}
</style>
