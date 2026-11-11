<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		COMMON_MATERIALS,
		CUSTOM_LIMITS,
		FINISHES,
		type CustomFilament
	} from '#lib/domain/custom-filaments.ts';
	import { materialFamily } from '#lib/filament-catalog.ts';
	import { isHex, normHex } from '#lib/domain/color.ts';
	import {
		DuplicateError,
		createCustomFilament,
		updateCustomFilament
	} from '#lib/client/custom-filaments.ts';

	let {
		organizationId,
		family,
		slotMaterial = '',
		initial = null,
		brands,
		seed = null,
		onsaved,
		onduplicate,
		oncancel
	}: {
		organizationId: string;
		family: 'petg' | 'tpu';
		slotMaterial?: string;
		/** Editing this filament; null adds a new one. */
		initial?: CustomFilament | null;
		/** Brand suggestions: the workspace's own first, then the catalog's. */
		brands: string[];
		/** The catalog swatch the user was looking at, offered as an eyedropper source. */
		seed?: { name: string; hex: string } | null;
		onsaved: (f: CustomFilament, isNew: boolean) => void;
		/** A filament with the same brand, type and color name exists already. */
		onduplicate: (existingId: string) => void;
		oncancel: () => void;
	} = $props();

	// Initial values only: the form edits its own copy.
	const init = untrack(() => initial);
	const seed0 = untrack(() => seed);
	const slot0 = untrack(() => slotMaterial);
	const OTHER = '__other';
	const options = COMMON_MATERIALS[untrack(() => family)];
	function startMaterial() {
		const m = init?.material ?? '';
		if (m) return options.includes(m) ? m : OTHER;
		return options.find((o) => o.toLowerCase() === slot0.toLowerCase()) ?? options[0];
	}

	let brand = $state(init?.brand ?? '');
	let matChoice = $state(startMaterial());
	let matOther = $state(init && !options.includes(init.material) ? init.material : '');
	let colorName = $state(init?.colorName ?? '');
	let hex = $state(init?.hex ?? seed0?.hex ?? '#2f80ed');
	let hexText = $state(init?.hex ?? seed0?.hex ?? '#2f80ed');
	let finish = $state(init?.finish ?? '');
	let hardness = $state(init?.hardness ?? '');
	let url = $state(init?.url ?? '');
	let notes = $state(init?.notes ?? '');
	let error = $state('');
	let busy = $state(false);
	let brandEl = $state<HTMLInputElement>();
	let canDrop = $state(false);

	onMount(() => {
		canDrop = 'EyeDropper' in window;
		brandEl?.focus();
	});

	const material = $derived(matChoice === OTHER ? matOther.trim() : matChoice);
	const isTpu = $derived(materialFamily(material) === 'tpu');
	const validHex = $derived(isHex(hexText));

	function setHex(v: string) {
		const h = normHex(v);
		hex = h;
		hexText = h;
	}
	function typeHex(v: string) {
		hexText = v;
		if (isHex(v)) hex = normHex(v);
	}
	async function drop() {
		try {
			// @ts-expect-error EyeDropper is not in the DOM typings yet
			const r = await new window.EyeDropper().open();
			setHex(r.sRGBHex);
		} catch {
			/* cancelled */
		}
	}

	const listId = `cf-brands-${Math.random().toString(36).slice(2, 7)}`;

	async function save(e: Event) {
		e.preventDefault();
		error = '';
		if (!brand.trim()) return (error = 'Brand is required');
		if (!material) return (error = 'Type is required');
		if (!colorName.trim()) return (error = 'Color name is required');
		if (!validHex) return (error = 'Color must be a #rrggbb hex');
		const input = {
			brand,
			material,
			colorName,
			hex: normHex(hexText),
			finish: finish || null,
			hardness: isTpu ? hardness || null : null,
			url: url.trim() || null,
			notes
		};
		busy = true;
		try {
			const f = initial
				? await updateCustomFilament(initial.id, input)
				: await createCustomFilament(organizationId, input);
			onsaved(f, !initial);
		} catch (err) {
			if (err instanceof DuplicateError && !initial) onduplicate(err.existingId);
			else error = err instanceof Error ? err.message : 'Could not save';
		} finally {
			busy = false;
		}
	}
</script>

<form
	class="cf"
	onsubmit={save}
	data-testid="custom-filament-form"
	aria-label={initial ? 'Edit filament' : 'Add a filament'}
>
	<div class="row2">
		<label class="field"
			>Brand
			<input
				bind:this={brandEl}
				bind:value={brand}
				list={listId}
				maxlength={CUSTOM_LIMITS.brand}
				autocomplete="off"
				placeholder="Pick or type a new one"
				required
			/>
			<datalist id={listId}>
				{#each brands as b (b)}<option value={b}></option>{/each}
			</datalist>
		</label>
		<label class="field"
			>Type
			<select bind:value={matChoice} aria-label="Type">
				{#each options as m (m)}<option value={m}>{m}</option>{/each}
				<option value={OTHER}>Other…</option>
			</select>
		</label>
	</div>
	{#if matChoice === OTHER}
		<label class="field"
			>Other type
			<input
				bind:value={matOther}
				maxlength={CUSTOM_LIMITS.material}
				placeholder="e.g. PETG HF"
				required
			/>
		</label>
	{/if}

	<label class="field"
		>Color name
		<input
			bind:value={colorName}
			maxlength={CUSTOM_LIMITS.colorName}
			placeholder="e.g. Team Red"
			required
		/>
	</label>

	<div class="field">
		<span>Color</span>
		<div class="colorrow">
			<input
				type="color"
				aria-label="Pick a color"
				value={hex}
				oninput={(e) => setHex(e.currentTarget.value)}
			/>
			<input
				type="text"
				aria-label="Color hex"
				class="hexin"
				value={hexText}
				oninput={(e) => typeHex(e.currentTarget.value)}
				maxlength="7"
				spellcheck="false"
				autocomplete="off"
				aria-invalid={!validHex}
			/>
			{#if seed}
				<button type="button" class="btn sm" onclick={() => setHex(seed.hex)}>
					Use {seed.name}
				</button>
			{/if}
			{#if canDrop}
				<button type="button" class="btn sm" onclick={drop}>Pick from screen</button>
			{/if}
		</div>
	</div>

	<div class="row2">
		<label class="field"
			><span>Finish <span class="muted">(optional)</span></span>
			<select bind:value={finish} aria-label="Finish">
				<option value="">None</option>
				{#each FINISHES as f (f)}<option value={f}>{f}</option>{/each}
			</select>
		</label>
		{#if isTpu}
			<label class="field"
				><span>Hardness <span class="muted">(optional)</span></span>
				<input
					bind:value={hardness}
					maxlength={CUSTOM_LIMITS.hardness}
					placeholder="95A"
					autocomplete="off"
				/>
			</label>
		{/if}
	</div>

	<label class="field"
		><span>Product link <span class="muted">(optional)</span></span>
		<input type="url" bind:value={url} maxlength={CUSTOM_LIMITS.url} placeholder="https://" />
	</label>
	<label class="field"
		><span>Notes <span class="muted">(optional)</span></span>
		<textarea rows="2" bind:value={notes} maxlength={CUSTOM_LIMITS.notes}></textarea>
	</label>

	{#if error}<p class="err" role="alert">{error}</p>{/if}
	<div class="actions">
		<button type="button" class="btn" onclick={oncancel}>Back</button>
		<button type="submit" class="btn primary" disabled={busy}>
			{initial ? 'Save changes' : 'Save and use'}
		</button>
	</div>
</form>

<style>
	.cf {
		display: grid;
		gap: var(--sp-5);
	}
	.row2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--sp-5);
	}
	.field {
		display: grid;
		gap: var(--sp-2);
		font-size: var(--fs-sm);
		font-weight: 600;
		min-width: 0;
	}
	input:not([type='color']),
	select,
	textarea {
		font-weight: 400;
		font-size: var(--fs-base);
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		padding: var(--sp-5) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font-family: inherit;
	}
	input[type='color'] {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--paper);
	}
	.colorrow {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		flex-wrap: wrap;
	}
	.colorrow input[type='color'] {
		width: 48px;
		padding: var(--sp-1);
		height: 38px;
		padding: 0;
		flex: none;
	}
	.hexin {
		width: 100px !important;
		font-family: var(--f-mono);
	}
	.err {
		margin: 0;
		color: var(--bad);
		font-size: var(--fs-sm);
	}
	.actions {
		display: flex;
		gap: var(--sp-4);
		justify-content: flex-end;
		position: sticky;
		bottom: 0;
		padding: var(--sp-4) 0 var(--sp-6);
		background: var(--card);
	}
</style>
