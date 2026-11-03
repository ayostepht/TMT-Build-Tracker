<script lang="ts">
	import { untrack } from 'svelte';
	import type { BuildPrinter } from '#lib/domain/types.ts';
	import {
		catalogPrinter,
		printerBrands,
		PRINTER_CATALOG,
		searchPrinters,
		type CatalogPrinter
	} from '#lib/printers/catalog.ts';
	import {
		DEFAULT_MARGIN,
		DEFAULT_SPACING,
		parsePrinter,
		printerFromCatalog
	} from '#lib/printers/printer.ts';

	/**
	 * Pick the printer a build is planned for: brand, then model (searchable) fills the bed
	 * size and multi-material system from the catalog; "Custom printer" takes X/Y/Z and the
	 * number of filament slots by hand. Every field stays editable.
	 *
	 * - `value`: the saved printer (or null). The picker keeps its own draft.
	 * - `onchange`: called with a valid `BuildPrinter` whenever the draft changes, or null
	 *   when cleared. Invalid drafts show a message and are not emitted.
	 * - `name`: renders a hidden input with the printer as JSON for plain form posts
	 *   (the New build form); empty when none or invalid.
	 */
	let {
		value = null,
		onchange,
		name,
		disabled = false,
		allowClear = true
	}: {
		value?: BuildPrinter | null;
		onchange?: (p: BuildPrinter | null) => void;
		name?: string;
		disabled?: boolean;
		allowClear?: boolean;
	} = $props();

	const CUSTOM = '__custom__';
	const brands = printerBrands();

	// Draft state (initialised from `value`, resynced when a different saved value arrives).
	let brand = $state('');
	let query = $state('');
	let sel = $state(''); // catalog id, CUSTOM or ''
	let mmIdx = $state(-1); // index into the catalog printer's mm list, -1 = none
	let pName = $state('');
	let bedX = $state(256);
	let bedY = $state(256);
	let bedZ = $state(256);
	let slots = $state(1);
	let nozzle = $state(0.4);
	let margin = $state(DEFAULT_MARGIN);
	let spacing = $state(DEFAULT_SPACING);
	let error = $state('');
	let lastKey = '';

	function load(v: BuildPrinter | null) {
		lastKey = JSON.stringify(v);
		error = '';
		if (!v) {
			sel = '';
			brand = '';
			return;
		}
		const c = catalogPrinter(v.catalogId);
		sel = c ? c.id : CUSTOM;
		brand = c ? c.brand : '';
		pName = v.name;
		bedX = v.bedX;
		bedY = v.bedY;
		bedZ = v.bedZ;
		slots = v.mmSlots;
		nozzle = v.nozzle;
		margin = v.margin;
		spacing = v.spacing;
		mmIdx = c ? c.mm.findIndex((m) => m.slots === v.mmSlots) : -1;
	}
	// Adopt a saved value that differs from what this picker last emitted (live updates, other tabs).
	$effect(() => {
		const key = JSON.stringify(value);
		if (key !== lastKey) untrack(() => load(value));
	});

	const cat = $derived<CatalogPrinter | null>(sel && sel !== CUSTOM ? catalogPrinter(sel) : null);
	const models = $derived(searchPrinters(query).filter((p) => !brand || p.brand === brand));

	function draft(): BuildPrinter | null {
		if (!sel) return null;
		return {
			catalogId: cat?.id ?? null,
			name: cat ? `${cat.brand} ${cat.model}` : pName,
			bedX,
			bedY,
			bedZ,
			mmSlots: slots,
			nozzle,
			margin,
			spacing
		};
	}
	const parsed = $derived.by(() => {
		const d = draft();
		if (!d) return { printer: null as BuildPrinter | null, error: '' };
		try {
			return { printer: parsePrinter(d), error: '' };
		} catch (e) {
			return { printer: null, error: (e as Error).message };
		}
	});

	function emit() {
		error = parsed.error;
		if (!sel) {
			lastKey = JSON.stringify(null);
			onchange?.(null);
		} else if (parsed.printer) {
			lastKey = JSON.stringify(parsed.printer);
			onchange?.(parsed.printer);
		}
	}

	function pickModel(id: string) {
		sel = id;
		if (!id) return emit();
		if (id === CUSTOM) {
			pName = pName || 'My printer';
			mmIdx = -1;
			return emit();
		}
		const c = catalogPrinter(id)!;
		const p = printerFromCatalog(c);
		brand = c.brand;
		bedX = p.bedX;
		bedY = p.bedY;
		bedZ = p.bedZ;
		nozzle = p.nozzle;
		slots = p.mmSlots;
		mmIdx = c.mmBuiltIn ? 0 : -1;
		emit();
	}
	function pickMm(i: number) {
		mmIdx = i;
		if (cat) slots = i >= 0 ? cat.mm[i].slots : 1;
		emit();
	}
	function pickBrand(b: string) {
		if (sel === CUSTOM && b !== CUSTOM) {
			sel = '';
			brand = b;
			return emit();
		}
		brand = b;
		if (b === CUSTOM) pickModel(CUSTOM);
		else if (sel && sel !== CUSTOM && catalogPrinter(sel)?.brand !== b) {
			sel = '';
			emit();
		}
	}
</script>

<div class="printer-picker" data-testid="printer-picker">
	{#if name}<input
			type="hidden"
			{name}
			value={parsed.printer ? JSON.stringify(parsed.printer) : ''}
		/>{/if}
	<div class="row">
		<label class="field">
			Brand
			<select
				value={sel === CUSTOM ? CUSTOM : brand}
				{disabled}
				onchange={(e) => pickBrand(e.currentTarget.value)}
				data-testid="printer-brand"
			>
				<option value="">All brands</option>
				{#each brands as b (b.brand)}<option value={b.brand}>{b.brand}</option>{/each}
				<option value={CUSTOM}>Custom printer</option>
			</select>
		</label>
		{#if sel !== CUSTOM}
			<label class="field">
				Search
				<input
					type="search"
					bind:value={query}
					{disabled}
					placeholder="Model, e.g. Centauri or P1S"
					data-testid="printer-search"
				/>
			</label>
			<label class="field grow">
				Model
				<select
					value={sel}
					{disabled}
					onchange={(e) => pickModel(e.currentTarget.value)}
					data-testid="printer-model"
				>
					<option value="">{allowClear ? 'No printer chosen' : 'Choose a printer'}</option>
					{#if cat && !models.some((m) => m.id === cat.id)}
						<option value={cat.id}>{cat.brand} {cat.model}</option>
					{/if}
					{#each models as m (m.id)}
						<option value={m.id}>{brand ? m.model : `${m.brand} ${m.model}`}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	{#if sel}
		{#if sel === CUSTOM}
			<label class="field">
				Printer name
				<input bind:value={pName} {disabled} maxlength="80" onchange={emit} />
			</label>
		{/if}
		<div class="row">
			<label class="field num-field">
				Bed X (mm)
				<input
					type="number"
					min="50"
					max="1000"
					step="1"
					bind:value={bedX}
					{disabled}
					onchange={emit}
					data-testid="printer-bedx"
				/>
			</label>
			<label class="field num-field">
				Bed Y (mm)
				<input
					type="number"
					min="50"
					max="1000"
					step="1"
					bind:value={bedY}
					{disabled}
					onchange={emit}
					data-testid="printer-bedy"
				/>
			</label>
			<label class="field num-field">
				Height Z (mm)
				<input
					type="number"
					min="50"
					max="2000"
					step="1"
					bind:value={bedZ}
					{disabled}
					onchange={emit}
				/>
			</label>
		</div>
		{#if cat && cat.mm.length}
			<label class="field">
				Multi-material system
				<select
					value={mmIdx}
					{disabled}
					onchange={(e) => pickMm(Number(e.currentTarget.value))}
					data-testid="printer-mm"
				>
					<option value={-1}>None (one filament per plate)</option>
					{#each cat.mm as m, i (m.name)}
						<option value={i}>{m.name}: {m.slots} filaments{m.note ? ` (${m.note})` : ''}</option>
					{/each}
				</select>
			</label>
		{:else}
			<label class="field num-field">
				Filament slots (1 = single filament)
				<input
					type="number"
					min="1"
					max="16"
					step="1"
					bind:value={slots}
					{disabled}
					onchange={emit}
					data-testid="printer-slots"
				/>
			</label>
		{/if}
		<details class="adv">
			<summary>Spacing and nozzle</summary>
			<div class="row">
				<label class="field num-field">
					Edge margin (mm)
					<input
						type="number"
						min="0"
						max="50"
						step="1"
						bind:value={margin}
						{disabled}
						onchange={emit}
					/>
				</label>
				<label class="field num-field">
					Gap between parts (mm)
					<input
						type="number"
						min="0"
						max="50"
						step="1"
						bind:value={spacing}
						{disabled}
						onchange={emit}
					/>
				</label>
				<label class="field num-field">
					Nozzle (mm)
					<input
						type="number"
						min="0.1"
						max="2"
						step="0.1"
						bind:value={nozzle}
						{disabled}
						onchange={emit}
					/>
				</label>
			</div>
		</details>
		<p class="meta" data-testid="printer-summary">
			{parsed.printer?.name ?? 'Printer'}: bed {bedX} × {bedY} × {bedZ} mm,
			{slots > 1 ? `${slots} filaments per plate` : 'one filament per plate'}.
			{#if cat?.check}<span class="warn"> Please verify: {cat.check}</span>{/if}
			{#if cat?.notes}<span> {cat.notes}</span>{/if}
		</p>
	{/if}
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	<p class="meta">
		{PRINTER_CATALOG.length} printers in the catalog. Not listed? Choose "Custom printer".
	</p>
</div>

<style>
	.printer-picker {
		display: grid;
		gap: 10px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: end;
	}
	.row > .field {
		flex: 1 1 140px;
		min-width: 0;
	}
	.row > .grow {
		flex: 2 1 220px;
	}
	.num-field input {
		max-width: 140px;
	}
	.adv summary {
		cursor: pointer;
		color: var(--muted);
		font-size: 13px;
	}
	.warn {
		color: var(--warn);
	}
	.err {
		margin: 0;
		font-size: 13px;
		color: var(--bad);
	}
	.meta {
		margin: 0;
	}
</style>
