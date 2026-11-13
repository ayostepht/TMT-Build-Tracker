<script lang="ts">
	import { untrack } from 'svelte';
	import type { BuildPrinter } from '#lib/domain/types.ts';
	import {
		arrangePlates,
		buildPlateLayouts,
		setPlateLayout,
		setPrinter,
		templatePlateLayouts,
		type PlateLayoutInfo
	} from '#lib/client/api.ts';
	import { DEFAULT_BED_PRESET, printerFromBed, printerSummary } from '#lib/printers/printer.ts';
	import BedPicker from './BedPicker.svelte';
	import AskDialog from './AskDialog.svelte';
	import { createAsk } from '#lib/client/ask.svelte.ts';
	import { focusIn } from '#lib/client/focus.ts';

	const asking = createAsk();

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
	 * Existing build: pass `buildId`. Choosing a tuned profile switches the plates right away (after asking, when it would replace arranged or uploaded plates)
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
		onupload,
		plateCount = 0,
		preload
	}: {
		templateId?: string;
		buildId?: string;
		name?: string;
		printerName?: string;
		/** Chapter or My builds whose printers are offered first in the bed picker. */
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
		/** Plates the build has now (for the replace prompt). */
		plateCount?: number;
		/**
		 * Build mode: the parent fetched the layouts already. `null` = still loading (the select waits),
		 * an object = use it (re-applied when it changes); leave out to fetch here.
		 */
		preload?: { layouts: PlateLayoutInfo[]; current: string | null } | null;
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
	let editBed = $state(false); // build mode: the bed picker is open although the build has a printer
	let pending = $state<{ key: string; name: string; plates: number } | null>(null);
	let error = $state<string | null>(null);
	let layoutSelect = $state<HTMLSelectElement>();
	const uid = $props.id();
	/** Close the replace confirmation; focus goes back to the layout select (the confirm panel disappears). */
	function dismissPending() {
		pending = null;
		layoutSelect?.focus();
	}

	const defaultKey = $derived(layouts.find((l) => l.isDefault)?.key ?? layouts[0]?.key ?? '');
	const effective = $derived(current ?? defaultKey);

	const loading = $derived(!!buildId && preload === null);
	function apply(r: { layouts: PlateLayoutInfo[]; current: string | null }) {
		layouts = r.layouts;
		current = r.current;
		value =
			r.current === ARRANGED
				? ARRANGE
				: (r.current ?? r.layouts.find((l) => l.isDefault)?.key ?? ARRANGE);
	}

	async function load() {
		try {
			if (buildId) {
				apply(await buildPlateLayouts(buildId));
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
		if (buildId && preload !== undefined) return; // the parent supplies it (below)
		load();
	});
	$effect(() => {
		const p = preload;
		// Only a new answer (a new object) may re-apply. `buildId` is read untracked: the parent passes
		// `ctx.id`, a getter that reads the whole build view, so tracking it re-ran this effect on every
		// view refresh and put an old answer ("default layout") back over what the picker had just
		// set ("arranged"). A pick of the default layout was then taken as "nothing to do".
		if (p && untrack(() => buildId)) untrack(() => apply(p));
	});

	// Bed draft: the New build form starts on 256 × 256; an existing build starts on its printer.
	const printerKey = $derived(JSON.stringify(printer));
	$effect(() => {
		void printerKey;
		if (buildId)
			bed = untrack(() => printer); // only when its content changes, not on a new object
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
				if (
					!(await asking.ask(`${e.message}\n\nSwitch layout and convert them?`, {
						title: 'Switch layout',
						confirmLabel: 'Switch and convert'
					}))
				)
					return false;
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
		// Replacing plates the user made (arranged for their bed, or from their own file) asks first.
		if (current === ARRANGED || current === 'upload') {
			const l = layouts.find((x) => x.key === value);
			pending = { key: value, name: l?.name ?? value, plates: l?.plateCount ?? 0 };
			value = asValue(current) || defaultKey;
			return;
		}
		await applyLayout(value);
	}

	async function applyLayout(key: string) {
		pending = null;
		error = null;
		value = key;
		busy = true;
		try {
			const ok = await runApply((c) => setPlateLayout(buildId, key, c));
			if (!ok) {
				value = asValue(current) || defaultKey;
				return;
			}
			current = key;
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
			editBed = false;
			value = ARRANGE;
			onchanged?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not arrange the plates.';
		} finally {
			busy = false;
		}
	}
</script>

<AskDialog ask={asking} />
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
			bind:this={layoutSelect}
			bind:value
			disabled={disabled || busy || loading}
			onchange={buildId ? (e) => change(e.currentTarget.value) : undefined}
			data-testid="plate-layout"
		>
			{#if loading}<option value={ARRANGE}>Loading…</option>{:else}<option value={ARRANGE}
					>Arrange for my bed</option
				>{/if}
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
		{#if buildId && printer && !editBed}
			<div class="bed summary" data-testid="bed-compact">
				<span class="sum-text" data-testid="printer-summary-text">{printerSummary(printer)}</span>
				<div class="sum-actions">
					<button
						class="btn sm"
						type="button"
						disabled={disabled || busy}
						data-testid="change-bed"
						aria-expanded="false"
						onclick={() => (editBed = true)}>Change bed or printer</button
					>
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
			</div>
		{:else}
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
					<div class="sum-actions">
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
						{#if printer}
							<button
								class="btn sm"
								type="button"
								data-testid="hide-bed"
								aria-expanded="true"
								onclick={() => ((editBed = false), (bed = printer))}>Hide</button
							>
						{/if}
					</div>
				{:else}
					<span class="hint">The plates are arranged for this bed when the build is created.</span>
				{/if}
			</div>
		{/if}
	{/if}
	{#if pending}
		<div
			class="confirm"
			role="alertdialog"
			aria-labelledby="{uid}-confirm-title"
			aria-describedby="{uid}-confirm-text"
			tabindex="-1"
			data-testid="layout-confirm"
			use:focusIn={'[data-testid="layout-confirm-cancel"]'}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.stopPropagation();
					dismissPending();
				}
			}}
		>
			<b id="{uid}-confirm-title" class="sr-only">Replace plates</b>
			<span id="{uid}-confirm-text"
				>Replace your {plateCount}
				{current === 'upload' ? 'uploaded' : 'arranged'} plates with MakeGood's
				{pending.name} layout ({pending.plates} plates)? Print logs are kept.</span
			>
			<div class="sum-actions">
				<button
					class="btn primary sm"
					type="button"
					data-testid="layout-confirm-yes"
					onclick={() => applyLayout(pending!.key)}>Replace plates</button
				>
				<button
					class="btn sm"
					type="button"
					data-testid="layout-confirm-cancel"
					onclick={dismissPending}>Cancel</button
				>
			</div>
		</div>
	{/if}
	{#if error}<span class="err" role="alert">{error}</span>{/if}
</div>

<style>
	.plate-layout-picker {
		grid-template-columns: minmax(0, 1fr);
		display: grid;
		gap: var(--sp-5);
		min-width: 0;
	}
	.bed {
		grid-template-columns: minmax(0, 1fr);
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--card);
	}
	.summary {
		gap: var(--sp-4);
	}
	.confirm {
		display: grid;
		gap: var(--sp-4);
		padding: var(--sp-5);
		border: 1px solid var(--warn);
		border-radius: var(--r-lg);
		background: var(--warn-soft);
		font-size: var(--fs-sm);
	}
	.sum-text {
		font-size: var(--fs-md);
		overflow-wrap: anywhere;
	}
	.sum-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
	}
	.sub {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.err {
		font-size: var(--fs-xs);
		color: var(--bad);
	}
</style>
