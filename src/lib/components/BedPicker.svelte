<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { listMyPrinters, type PrinterWorkspace } from '#lib/client/api.ts';
	import { catalogPrinter } from '#lib/printers/catalog.ts';
	import type { PrinterPublic } from '#lib/printers/status.ts';
	import type { BuildPrinter } from '#lib/domain/types.ts';
	import {
		BED_PRESETS,
		bedExamples,
		bedLabel,
		parsePrinter,
		printerFromBed,
		printerFromCatalog
	} from '#lib/printers/printer.ts';
	import PrinterPicker from './PrinterPicker.svelte';
	import PrinterForm from './PrinterForm.svelte';

	/**
	 * Pick the bed a build is planned for: a standard size in one tap, a custom size, or a
	 * specific printer from the catalog (which fills the bed and multi-material system).
	 * Bed height and the number of filaments per plate are compact fields. The result is a
	 * `BuildPrinter`: presets and custom beds have `catalogId: null` and a name like
	 * "256 × 256 bed"; a picked printer keeps its catalog id.
	 *
	 * - `value`: the saved printer (or null). The picker keeps its own draft.
	 * - `onchange`: called with a valid `BuildPrinter` whenever the draft changes, null when
	 *   there is none yet. Invalid drafts show a message and are not emitted.
	 * - `name`: renders a hidden input with the printer as JSON for plain form posts.
	 */
	let {
		value = null,
		onchange,
		name,
		disabled = false,
		orgId = '',
		preselectSingle = false
	}: {
		value?: BuildPrinter | null;
		onchange?: (p: BuildPrinter | null) => void;
		name?: string;
		disabled?: boolean;
		/** Chapter or My builds whose printers (Printers page) are offered first. */
		orgId?: string;
		/** With exactly one printer for this chapter or My builds and no choice yet, select it. */
		preselectSingle?: boolean;
	} = $props();

	type Mode = 'preset' | 'custom' | 'printer' | null;
	const presetOf = (x: number, y: number) => BED_PRESETS.findIndex((p) => p.x === x && p.y === y);
	const examples = BED_PRESETS.map((p) => bedExamples(p.x, p.y));

	let mode = $state<Mode>(null);
	let bedX = $state(256);
	let bedY = $state(256);
	let bedZ = $state(256);
	let slots = $state(1);
	let customName = $state('');
	let picked = $state<BuildPrinter | null>(null); // printer from the catalog picker
	let keep = $state<Pick<BuildPrinter, 'nozzle' | 'margin' | 'spacing' | 'keepOut'>>({
		nozzle: 0.4,
		margin: 1,
		spacing: 8,
		keepOut: []
	});
	let error = $state('');
	let lastKey = '';
	let current = $state<BuildPrinter | null>(null);

	function load(v: BuildPrinter | null) {
		lastKey = JSON.stringify(v);
		current = v;
		error = '';
		picked = null;
		if (!v) {
			mode = null;
			return;
		}
		keep = {
			nozzle: v.nozzle,
			margin: v.margin,
			spacing: v.spacing,
			keepOut: (v.keepOut ?? []).map((k) => ({ ...k }))
		};
		bedX = v.bedX;
		bedY = v.bedY;
		bedZ = v.bedZ;
		slots = v.mmSlots;
		if (v.catalogId) {
			mode = 'printer';
			picked = v;
		} else if (presetOf(v.bedX, v.bedY) >= 0 && v.name === `${bedLabel(v.bedX, v.bedY)} bed`) {
			mode = 'preset';
		} else {
			mode = 'custom';
			customName = v.name;
		}
	}
	// Adopt a saved value that differs from what this picker last emitted (live updates, other tabs).
	$effect(() => {
		const key = JSON.stringify(value);
		if (key !== lastKey) untrack(() => load(value));
	});

	function emit(p: BuildPrinter | null) {
		current = p;
		lastKey = JSON.stringify(p);
		onchange?.(p);
	}
	function emitBed() {
		const autoName = `${bedLabel(bedX, bedY)} bed`;
		const d = {
			...printerFromBed(bedX, bedY, bedZ, slots, keep),
			name: mode === 'custom' && customName.trim() ? customName.trim() : autoName
		};
		try {
			const p = parsePrinter(d);
			error = '';
			emit(p);
		} catch (e) {
			error = (e as Error).message;
		}
	}
	function addKeepOut() {
		keep.keepOut = [
			...(keep.keepOut ?? []),
			{ x: Math.max(0, bedX - 20), y: 0, w: 20, d: 20, label: 'Keep-out' }
		];
		emitBed();
	}
	function removeKeepOut(i: number) {
		keep.keepOut = (keep.keepOut ?? []).filter((_, k) => k !== i);
		emitBed();
	}
	function pickPreset(i: number) {
		if (mode === 'printer') keep.keepOut = []; // a printer's keep-outs belong to that printer
		mode = 'preset';
		bedX = BED_PRESETS[i].x;
		bedY = BED_PRESETS[i].y;
		bedZ = BED_PRESETS[i].z;
		emitBed();
	}
	function pickCustom() {
		if (mode === 'printer') keep.keepOut = [];
		if (mode === 'custom') return;
		mode = 'custom';
		customName = '';
		emitBed();
	}
	function pickPrinter() {
		if (mode === 'printer') return;
		mode = 'printer';
		error = '';
		emit(picked);
	}
	const presetIdx = $derived(mode === 'preset' ? presetOf(bedX, bedY) : -1);

	// Printers of every workspace the user belongs to ("Your printers"), the build's own first.
	const NEW_PRINTER = '__new__';
	let groups = $state<PrinterWorkspace[]>([]);
	let adding = $state(false);
	let touched = false;
	const team = $derived(groups.flatMap((g) => g.printers));
	const canAddPrinter = $derived(groups.find((g) => g.id === orgId)?.canEdit ?? false);
	const usable = $derived(team.filter((t) => catalogPrinter(t.catalogId)));
	const teamSel = $derived(
		mode === 'printer' && picked
			? (team.find((t) => t.name === picked!.name && t.catalogId === picked!.catalogId)?.id ?? '')
			: ''
	);
	const teamLabel = (t: PrinterPublic) => {
		const c = catalogPrinter(t.catalogId);
		const state = t.status?.state ? ` · ${t.status.state}` : '';
		return c
			? `${t.name} · ${c.brand} ${c.model} · ${bedLabel(c.bedX, c.bedY)}${state}`
			: `${t.name} (set its model on the Printers page to use its bed)`;
	};
	async function loadTeam(): Promise<PrinterPublic[]> {
		if (!orgId) return [];
		try {
			groups = (await listMyPrinters(orgId)).workspaces;
		} catch {
			groups = [];
		}
		return team;
	}
	function pickTeam(id: string) {
		const t = team.find((x) => x.id === id);
		const c = t ? catalogPrinter(t.catalogId) : null;
		if (!t || !c) return;
		touched = true;
		const p = { ...printerFromCatalog(c), name: t.name };
		mode = 'printer';
		picked = p;
		error = '';
		emit(p);
	}
	function onTeamSelect(v: string) {
		if (v === NEW_PRINTER) adding = true;
		else if (v) pickTeam(v);
	}
	async function added() {
		const before = new Set(team.map((t) => t.id));
		adding = false;
		const now = await loadTeam();
		const fresh = now.find((t) => !before.has(t.id));
		if (!fresh) return;
		if (catalogPrinter(fresh.catalogId)) pickTeam(fresh.id);
		else error = `${fresh.name} was added. Choose its model on the Printers page to use its bed.`;
	}
	onMount(async () => {
		const list = await loadTeam();
		const ok = list.filter((t) => t.organizationId === orgId && catalogPrinter(t.catalogId));
		if (preselectSingle && !touched && ok.length === 1 && !current?.catalogId) pickTeam(ok[0].id);
	});
	/**
	 * Moves the dialog to <body> (the picker may sit inside a form, and PrinterForm is a form too)
	 * and opens it as a modal: the browser gives focus trapping, an inert page, Escape and focus
	 * restore.
	 */
	function modal(node: HTMLDialogElement) {
		document.body.appendChild(node);
		node.showModal();
		return {
			destroy() {
				if (node.open) node.close();
				node.remove();
			}
		};
	}
</script>

<div class="bed-picker" data-testid="bed-picker">
	{#if name}<input type="hidden" {name} value={current ? JSON.stringify(current) : ''} />{/if}
	{#if orgId}
		<label class="field team-printers">
			Your printers
			<select
				value={teamSel}
				{disabled}
				onchange={(e) => onTeamSelect(e.currentTarget.value)}
				data-testid="team-printer"
			>
				<option value=""
					>{usable.length ? 'Choose one of your printers…' : 'No printers added yet'}</option
				>
				{#each groups.filter((g) => g.printers.length) as g (g.id)}
					<optgroup label={g.name} data-testid="team-printer-group">
						{#each g.printers as t (t.id)}
							<option value={t.id} disabled={!catalogPrinter(t.catalogId)}>{teamLabel(t)}</option>
						{/each}
					</optgroup>
				{/each}
				{#if canAddPrinter}<option value={NEW_PRINTER}>New printer…</option>{/if}
			</select>
			<span class="hint"
				>Printers from the Printers page of all your chapters and My builds. Or pick a standard bed
				size below.</span
			>
		</label>
	{/if}
	<div class="presets" role="group" aria-label="Bed size">
		{#each BED_PRESETS as p, i (p.x + 'x' + p.y)}
			<button
				type="button"
				class="preset"
				aria-pressed={presetIdx === i}
				{disabled}
				data-testid="bed-preset-{p.x}x{p.y}"
				onclick={() => pickPreset(i)}
			>
				<b class="num">{bedLabel(p.x, p.y)}</b>
				{#if examples[i]}<span>{examples[i]}</span>{/if}
			</button>
		{/each}
		<button
			type="button"
			class="preset"
			aria-pressed={mode === 'custom'}
			{disabled}
			data-testid="bed-custom"
			onclick={pickCustom}
		>
			<b>Custom size</b><span>X, Y and Z in mm</span>
		</button>
		<button
			type="button"
			class="preset"
			aria-pressed={mode === 'printer'}
			{disabled}
			data-testid="bed-pick-printer"
			onclick={pickPrinter}
		>
			<b>Pick my printer…</b><span>Fills the bed from the catalog</span>
		</button>
	</div>

	{#if mode === 'custom'}
		<div class="bp-row">
			<label class="field num-field">
				Bed X (mm)
				<input
					type="number"
					min="50"
					max="1000"
					step="1"
					bind:value={bedX}
					{disabled}
					onchange={emitBed}
					data-testid="bed-x"
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
					onchange={emitBed}
					data-testid="bed-y"
				/>
			</label>
			<label class="field grow">
				Name (optional)
				<input
					bind:value={customName}
					{disabled}
					maxlength="80"
					placeholder="{bedLabel(bedX, bedY)} bed"
					onchange={emitBed}
				/>
			</label>
		</div>
		<details class="adv" open={!!keep.keepOut?.length}>
			<summary>Advanced: keep-out areas</summary>
			<p class="hint">
				Parts stay out of these rectangles (a filament cutter, a purge area). Millimetres from the
				front-left corner; y grows toward the back.
			</p>
			{#each keep.keepOut ?? [] as z, i (i)}
				<div class="ko-row" data-testid="keepout-row">
					<input
						aria-label="Keep-out {i + 1} label"
						maxlength="40"
						bind:value={z.label}
						{disabled}
						onchange={emitBed}
					/>
					{#each [['x', 'x'], ['y', 'y'], ['w', 'width'], ['d', 'depth']] as [k, lbl] (k)}
						<label class="ko-num"
							>{lbl}
							<input
								type="number"
								min="0"
								step="1"
								bind:value={z[k as 'x' | 'y' | 'w' | 'd']}
								{disabled}
								onchange={emitBed}
								aria-label="Keep-out {i + 1} {lbl} (mm)"
							/></label
						>
					{/each}
					<button
						type="button"
						class="btn sm"
						{disabled}
						onclick={() => removeKeepOut(i)}
						aria-label="Remove keep-out {i + 1}">Remove</button
					>
				</div>
			{/each}
			{#if (keep.keepOut?.length ?? 0) < 8}
				<button
					type="button"
					class="btn sm"
					{disabled}
					onclick={addKeepOut}
					data-testid="keepout-add">Add keep-out area</button
				>
			{/if}
		</details>
	{/if}

	{#if mode === 'preset' || mode === 'custom'}
		<div class="bp-row">
			<label class="field num-field">
				Bed height Z (mm)
				<input
					type="number"
					min="50"
					max="2000"
					step="1"
					bind:value={bedZ}
					{disabled}
					onchange={emitBed}
					data-testid="bed-z"
				/>
			</label>
			<label class="field slots">
				Filaments per plate
				<select
					value={slots}
					{disabled}
					onchange={(e) => {
						slots = Number(e.currentTarget.value);
						emitBed();
					}}
					data-testid="bed-slots"
				>
					<option value={1}>One (no multi-material)</option>
					{#each Array.from({ length: 15 }, (_, i) => i + 2) as n (n)}
						<option value={n}>{n} filaments</option>
					{/each}
				</select>
			</label>
		</div>
		<p class="hint">
			Height limits how tall a part can be. Multi-material systems (CANVAS, AMS, MMU, CFS) let one
			plate mix colors; pick how many filaments it can use.
		</p>
	{:else if mode === 'printer'}
		<PrinterPicker value={picked} {disabled} onchange={(p) => ((picked = p), emit(p))} />
	{/if}
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	{#if current && mode !== 'printer'}
		<p class="hint" data-testid="bed-summary">
			Bed {current.bedX} × {current.bedY} × {current.bedZ} mm,
			{current.mmSlots > 1 ? `${current.mmSlots} filaments per plate` : 'one filament per plate'}.
		</p>
	{/if}
</div>

{#if adding}
	<dialog
		use:modal
		class="ds-modal np-dialog"
		aria-label="New printer"
		data-testid="new-printer-dialog"
		onclose={() => (adding = false)}
	>
		<PrinterForm org={orgId} ondone={added} oncancel={() => (adding = false)} />
	</dialog>
{/if}

<style>
	.adv {
		margin-top: var(--sp-4);
	}
	.adv summary {
		cursor: pointer;
		font-size: var(--fs-sm);
		color: var(--muted, inherit);
	}
	.ko-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
		align-items: end;
		margin: var(--sp-3) 0;
	}
	.ko-row > input {
		flex: 1 1 8rem;
		min-width: 0;
	}
	.ko-num {
		display: flex;
		flex-direction: column;
		font-size: var(--fs-xs);
		width: 4.2rem;
	}
	.bed-picker {
		grid-template-columns: minmax(0, 1fr);
		display: grid;
		gap: var(--sp-5);
		min-width: 0;
	}
	.presets {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--sp-4);
	}
	.preset {
		display: grid;
		gap: var(--sp-1);
		align-content: start;
		text-align: left;
		padding: var(--sp-4) var(--sp-5);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--card);
		color: var(--ink);
		font-size: var(--fs-sm);
		min-width: 0;
		min-height: 44px;
	}
	.preset b {
		font-size: var(--fs-md);
	}
	.preset span {
		font-size: var(--fs-xs);
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.preset[aria-pressed='true'] {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}
	.preset[aria-pressed='true'] span {
		color: inherit;
		opacity: 0.8;
	}
	.preset:disabled {
		opacity: 0.6;
	}
	.bp-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-5);
		align-items: end;
	}
	.bp-row > .field {
		flex: 1 1 130px;
		min-width: 0;
	}
	.bp-row > .grow {
		flex: 2 1 200px;
	}
	.num-field input {
		max-width: 140px;
	}
	.np-dialog {
		width: min(640px, calc(100vw - 32px));
	}
	/* The form is a card: inside the dialog the dialog is the surface */
	.np-dialog :global(.pf) {
		border: 0;
		border-radius: 0;
		background: transparent;
	}
	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.err {
		margin: 0;
		font-size: var(--fs-sm);
		color: var(--bad);
	}
</style>
