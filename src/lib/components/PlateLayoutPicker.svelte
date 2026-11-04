<script lang="ts">
	import type { BuildPrinter } from '#lib/domain/types.ts';
	import {
		arrangePlates,
		buildPlateLayouts,
		setPlateLayout,
		setPrinter,
		templatePlateLayouts,
		type PlateLayoutInfo
	} from '#lib/client/api.ts';
	import { DEFAULT_BED_PRESET, printerFromBed } from '#lib/printers/printer.ts';
	import BedPicker from './BedPicker.svelte';

	/**
	 * Picks how the plates of a template or a build are laid out.
	 *
	 * - "Arrange for my bed" (primary): the app packs the parts onto the bed you choose (standard
	 *   size, custom size or a printer from the catalog). The bed is stored as the build's printer.
	 * - "MakeGood's tuned profiles (Bambu)": the kit author's hand-tuned layouts.
	 * - "Use my own sliced file" (existing builds with `allowUpload`).
	 *
	 * New build form: pass `templateId`. Renders hidden inputs `plateLayout` ('' = arrange for the
	 * bed) and `printer` (the bed as JSON, only while arranging) so a plain form post carries it.
	 * The default is "Arrange for my bed" on the most common 256 × 256 bed.
	 *
	 * Existing build: pass `buildId`. Choosing a tuned profile switches the plates right away
	 * (asks before converting print logs that hang on plates). Choosing "Arrange for my bed" shows
	 * the bed picker (`bedPanel`) with an "Arrange plates" button that saves the bed and arranges;
	 * without the panel (Settings, which has its own printer card) it arranges for the saved
	 * printer at once.
	 */
	let {
		templateId = '',
		buildId = '',
		name = 'plateLayout',
		printerName = 'printer',
		orgId = '',
		disabled = false,
		allowUpload = false,
		bedPanel = true,
		printer = null,
		label = 'Plate layout',
		onchanged,
		onupload
	}: {
		templateId?: string;
		buildId?: string;
		name?: string;
		printerName?: string;
		/** Workspace whose printers are offered first in the bed picker. */
		orgId?: string;
		disabled?: boolean;
		allowUpload?: boolean;
		/** Show the bed picker under "Arrange for my bed". */
		bedPanel?: boolean;
		/** The build's saved printer / bed. */
		printer?: BuildPrinter | null;
		label?: string;
		onchanged?: () => void;
		onupload?: () => void;
	} = $props();

	const ARRANGE = '__arrange__';
	const ARRANGED = 'arranged';
	const UPLOAD = '__upload__';
	const asValue = (c: string | null) => (c === ARRANGED ? ARRANGE : (c ?? ''));

	let layouts = $state<PlateLayoutInfo[]>([]);
	let current = $state<string | null>(null); // build mode: layout key, 'arranged', 'upload' or null (default)
	let value = $state(ARRANGE);
	let bed = $state<BuildPrinter | null>(null);
	let seeded = false;
	let busy = $state(false);
	let error = $state<string | null>(null);

	const defaultKey = $derived(layouts.find((l) => l.isDefault)?.key ?? layouts[0]?.key ?? '');
	const effective = $derived(current ?? defaultKey);

	async function load() {
		try {
			if (buildId) {
				const r = await buildPlateLayouts(buildId);
				layouts = r.layouts;
				current = r.current;
				value =
					r.current === ARRANGED
						? ARRANGE
						: (r.current ?? r.layouts.find((l) => l.isDefault)?.key ?? ARRANGE);
			} else if (templateId) {
				layouts = await templatePlateLayouts(templateId);
			} else layouts = [];
		} catch {
			layouts = [];
		}
	}
	$effect(() => {
		void templateId;
		void buildId;
		load();
	});

	// Bed draft: the New build form starts on 256 × 256; an existing build starts on its printer.
	const printerKey = $derived(JSON.stringify(printer));
	$effect(() => {
		void printerKey;
		if (buildId) bed = printer;
		else if (!seeded) {
			seeded = true;
			bed = printerFromBed(DEFAULT_BED_PRESET.x, DEFAULT_BED_PRESET.y, DEFAULT_BED_PRESET.z);
		}
	});

	const tuned = $derived(layouts);
	const tunedHint = $derived(
		tuned.length
			? `Hand-tuned by MakeGood for ${tuned.map((l) => `${l.name} (${l.plateCount} plates)`).join(' and ')}.`
			: ''
	);
	const note = $derived(layouts.find((l) => l.key === value)?.printerNote);
	const bedChanged = $derived(JSON.stringify(bed) !== printerKey);

	async function runApply(apply: (convert: boolean) => Promise<unknown>): Promise<boolean> {
		try {
			await apply(false);
		} catch (e) {
			if (e instanceof Error && /print log/.test(e.message)) {
				if (!confirm(`${e.message}\n\nSwitch layout and convert them?`)) return false;
				await apply(true);
			} else throw e;
		}
		return true;
	}

	async function change(picked: string) {
		error = null;
		value = picked;
		if (!buildId) return;
		if (value === UPLOAD) {
			value = current === ARRANGED ? ARRANGE : (current ?? defaultKey);
			onupload?.();
			return;
		}
		if (value === ARRANGE) {
			if (bedPanel) return; // the bed panel's button does the work
			if (!printer) {
				error = 'Set your bed or printer in the Printer section first.';
				value = asValue(current) || defaultKey;
				return;
			}
			await arrange();
			return;
		}
		if (value === effective) return;
		busy = true;
		try {
			const ok = await runApply((c) => setPlateLayout(buildId, value, c));
			if (!ok) {
				value = asValue(current) || defaultKey;
				return;
			}
			current = value;
			onchanged?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not switch the layout.';
			value = asValue(current) || defaultKey;
		} finally {
			busy = false;
		}
	}

	/** Saves the chosen bed as the build's printer (when it changed) and arranges the plates for it. */
	async function arrange() {
		error = null;
		busy = true;
		try {
			if (bedPanel && bed && bedChanged) await setPrinter(buildId, bed);
			const ok = await runApply((c) => arrangePlates(buildId, c));
			if (!ok) return;
			current = ARRANGED;
			value = ARRANGE;
			onchanged?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not arrange the plates.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="plate-layout-picker">
	{#if !buildId}
		<input type="hidden" {name} value={value === ARRANGE ? '' : value} />
		{#if value === ARRANGE}
			<input type="hidden" name={printerName} value={bed ? JSON.stringify(bed) : ''} />
		{/if}
	{/if}
	<label class="field plate-layout">
		{label}
		<select
			bind:value
			disabled={disabled || busy}
			onchange={buildId ? (e) => change(e.currentTarget.value) : undefined}
			data-testid="plate-layout"
		>
			<option value={ARRANGE}>Arrange for my bed</option>
			{#if layouts.length}
				<optgroup label="MakeGood's tuned profiles (Bambu)">
					{#each layouts as l (l.key)}
						<option value={l.key}>{l.name}{buildId ? ` (${l.plateCount} plates)` : ''}</option>
					{/each}
				</optgroup>
			{/if}
			{#if buildId && current === 'upload'}<option value="upload" disabled>Your uploaded 3MF</option
				>{/if}
			{#if buildId && allowUpload}<option value={UPLOAD}>Use my own sliced file…</option>{/if}
		</select>
		{#if tunedHint}<span class="hint">{tunedHint}</span>{/if}
		{#if note && !buildId && value !== ARRANGE}<span class="hint">{note}</span>{/if}
	</label>

	{#if value === ARRANGE && (bedPanel || !buildId)}
		<div class="bed" data-testid="arrange-bed-panel">
			<span class="sub">Your bed</span>
			<BedPicker
				value={bed}
				{disabled}
				{orgId}
				preselectSingle={!buildId || !printer}
				onchange={(p) => (bed = p)}
			/>
			{#if buildId}
				<div>
					<button
						class="btn primary sm"
						type="button"
						disabled={disabled || busy || !bed}
						data-testid="arrange-bed"
						onclick={arrange}
						>{current === ARRANGED && !bedChanged
							? 'Re-arrange plates'
							: 'Arrange plates for this bed'}</button
					>
				</div>
			{:else}
				<span class="hint">The plates are arranged for this bed when the build is created.</span>
			{/if}
		</div>
	{/if}
	{#if error}<span class="err" role="alert">{error}</span>{/if}
</div>

<style>
	.plate-layout-picker {
		grid-template-columns: minmax(0, 1fr);
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	.bed {
		grid-template-columns: minmax(0, 1fr);
		display: grid;
		gap: 8px;
		padding: 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--card);
	}
	.sub {
		font-size: 13px;
		color: var(--muted);
	}
	.hint {
		font-size: 12px;
		color: var(--muted);
	}
	.err {
		font-size: 12px;
		color: var(--bad, #b3261e);
	}
</style>
