<script lang="ts">
	import {
		createSpoolmanFilament,
		linkSpoolmanFilament,
		spoolmanCreateForm,
		prelinkDeduct,
		setSpoolmanSpool,
		spoolmanSuggestions,
		type SpoolmanCreateFormDto,
		type SpoolmanLinkResultDto,
		type SpoolmanSuggestionDto
	} from '#lib/client/api.ts';
	import { fmt } from '#lib/domain/index.ts';
	import Swatch from './Swatch.svelte';

	/**
	 * Link a filament slot to a Spoolman filament (issue #59), or choose its current spool.
	 * Self-contained: it loads the ranked suggestions, calls the server and tells the parent through
	 * `onchange` so the parent refreshes its build view. Place it inside the slot's panel; it needs no
	 * build context.
	 *
	 * mode 'filament': suggestions first (best match, with why), a search over all of Spoolman's
	 *   filaments. After linking, when prints were logged before the link, it asks whether to also
	 *   subtract them from Spoolman (only offered when `keptBy` is 'app').
	 *   "Create in Spoolman" (last option; editors only, the parent places the picker for editors):
	 *   a form prefilled from the catalog (vendor, name, material, colour, density, weights) creates
	 *   the vendor if missing and the filament, then links the slot like a normal link.
	 * mode 'spool': the linked filament's spools, pick the one deductions start on.
	 */
	let {
		buildId,
		role,
		keptBy = 'app',
		mode = 'filament',
		currentFilamentId = null,
		currentSpoolId = null,
		onchange,
		onclose
	}: {
		buildId: string;
		role: string;
		/** Workspace "kept up to date by": decides whether the pre-link subtraction is offered. */
		keptBy?: 'app' | 'other';
		mode?: 'filament' | 'spool';
		currentFilamentId?: number | null;
		currentSpoolId?: number | null;
		/** Something changed on the server: reload the build. */
		onchange?: () => void | Promise<void>;
		onclose?: () => void;
	} = $props();

	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let offline = $state(false);
	let all = $state<SpoolmanSuggestionDto[]>([]);
	let q = $state('');
	let showAll = $state(false);
	// After linking: ask about prints logged before the link.
	let done = $state<SpoolmanLinkResultDto | null>(null);
	let choice = $state<'current' | 'subtract'>('current');
	// The apply took only part of the grams (Spoolman had less): keep the prompt open and say so.
	let warning = $state('');
	// The create form matched a filament Spoolman already had: say so instead of closing silently.
	let reusedInfo = $state('');
	// "Create in Spoolman" form.
	let creating = $state(false);
	let cform = $state<SpoolmanCreateFormDto | null>(null);
	let cvendors = $state<string[]>([]);
	let fVendor = $state('');
	let fName = $state('');
	let fMaterial = $state('');
	let fHex = $state('#808080');
	let fDensity = $state('');
	let fDiameter = $state('');
	let fWeight = $state('');
	let fSpool = $state('');
	let fExternal = $state<string | null>(null);
	let vendorWarn = $state('');

	$effect(() => {
		void load();
	});
	async function load() {
		loading = true;
		error = '';
		try {
			const r = await spoolmanSuggestions(buildId, role);
			offline = r.offline;
			all = r.suggestions;
			if (!r.configured) error = 'Spoolman is not set up for this chapter.';
			else if (r.error) error = r.error;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load Spoolman';
		}
		loading = false;
	}

	const norm = (s: string) => s.toLowerCase();
	const matches = $derived.by(() => {
		const t = norm(q.trim());
		if (!t) return null;
		return all.filter((s) =>
			norm(
				`${s.filament.vendor ?? ''} ${s.filament.name} ${s.filament.material ?? ''} #${s.filament.id}`
			).includes(t)
		);
	});
	const best = $derived(all.filter((s) => s.level !== 'other').slice(0, 5));
	const rest = $derived(all.filter((s) => !best.includes(s)));
	const linkedFilament = $derived(all.find((s) => s.filament.id === currentFilamentId)?.filament);

	function stockOf(s: SpoolmanSuggestionDto): string {
		const open = s.filament.spools.filter((x) => !x.archived);
		const g = open.reduce((a, x) => a + (x.remainingG ?? 0), 0);
		if (!open.length) return 'no open spools';
		return `${open.length} spool${open.length === 1 ? '' : 's'} · ${fmt(g)} g left`;
	}

	async function choose(s: SpoolmanSuggestionDto) {
		busy = true;
		error = '';
		try {
			const r = await linkSpoolmanFilament(buildId, role, s.filament.id);
			await onchange?.();
			if (r.preLinkLoggedG > 0) {
				done = r;
				choice = 'current';
			} else onclose?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not link';
		}
		busy = false;
	}
	async function openCreate() {
		error = '';
		busy = true;
		try {
			const r = await spoolmanCreateForm(buildId, role);
			cform = r;
			cvendors = r.vendors.map((v) => v.name);
			fVendor = r.defaults.vendorName;
			fName = r.defaults.name;
			fMaterial = r.defaults.material;
			fHex = r.defaults.colorHex;
			fDensity = String(r.defaults.density);
			fDiameter = String(r.defaults.diameter);
			fWeight = String(r.defaults.weightG);
			fSpool = String(r.defaults.spoolWeightG);
			fExternal = r.defaults.externalId;
			vendorWarn = r.error ? `Spoolman's vendors could not be loaded: ${r.error}` : '';
			// Only now: the fields must be filled before the maker can type in them.
			creating = true;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load the form';
		}
		busy = false;
	}
	const vendorIsNew = $derived(
		!!fVendor.trim() && !cvendors.some((v) => v.toLowerCase() === fVendor.trim().toLowerCase())
	);
	async function submitCreate(ev: SubmitEvent) {
		ev.preventDefault();
		busy = true;
		error = '';
		try {
			const r = await createSpoolmanFilament(buildId, role, {
				vendorName: fVendor.trim(),
				name: fName.trim(),
				material: fMaterial.trim(),
				colorHex: fHex,
				density: Number(fDensity),
				diameter: Number(fDiameter),
				weightG: Number(fWeight),
				spoolWeightG: fSpool.trim() === '' ? null : Number(fSpool),
				externalId: fExternal
			});
			creating = false;
			await onchange?.();
			if (r.reused)
				reusedInfo = `Linked to existing Spoolman filament ${r.filament.vendor ? `${r.filament.vendor} ` : ''}${r.filament.name}${r.filament.material ? ` (${r.filament.material}` : ''}${r.filament.density != null ? `, ${r.filament.density} g/cm³` : ''}${r.filament.diameter != null ? `, ${r.filament.diameter} mm` : ''}${r.filament.material ? ')' : ''}. Nothing new was created.`;
			if (r.preLinkLoggedG > 0) {
				done = r;
				choice = 'current';
			} else if (!r.reused) onclose?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not create the filament';
		}
		busy = false;
	}
	async function confirmPrelink() {
		busy = true;
		error = '';
		try {
			warning = '';
			const r =
				choice === 'subtract' && keptBy === 'app' ? await prelinkDeduct(buildId, role) : null;
			await onchange?.();
			if (r?.warning) warning = r.warning;
			else onclose?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not subtract';
		}
		busy = false;
	}
	async function chooseSpool(id: number | null) {
		busy = true;
		error = '';
		try {
			await setSpoolmanSpool(buildId, role, id);
			await onchange?.();
			onclose?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not change the spool';
		}
		busy = false;
	}
</script>

<div class="smp" data-testid="spoolman-picker">
	{#if reusedInfo}
		<p class="hint" role="status" data-testid="spoolman-create-reused">{reusedInfo}</p>
	{/if}
	{#if done}
		<div class="pre" data-testid="spoolman-prelink">
			<p>
				<b class="num">{fmt(done.preLinkLoggedG)} g</b> already logged on this build before linking.
			</p>
			<label class="opt">
				<input type="radio" name="pre-{role}" value="current" bind:group={choice} />
				<span>Spoolman's weight is current <span class="muted">(default)</span></span>
			</label>
			{#if keptBy === 'app'}
				<label class="opt">
					<input
						type="radio"
						name="pre-{role}"
						value="subtract"
						bind:group={choice}
						data-testid="prelink-subtract"
					/>
					<span>Also subtract those {fmt(done.preLinkLoggedG)} g from Spoolman now</span>
				</label>
			{/if}
			{#if warning}
				<div class="warn" role="status" data-testid="prelink-warning">{warning}</div>
			{/if}
			<div class="smp-row">
				<button
					class="btn primary"
					type="button"
					disabled={busy}
					data-testid="prelink-done"
					onclick={confirmPrelink}>{warning ? 'Try again' : 'Done'}</button
				>
				{#if warning}
					<button class="btn ghost" type="button" disabled={busy} onclick={() => onclose?.()}
						>Close</button
					>
				{/if}
			</div>
		</div>
	{:else if reusedInfo}
		<div class="smp-row">
			<button
				class="btn primary"
				type="button"
				data-testid="create-reused-done"
				onclick={() => onclose?.()}>Done</button
			>
		</div>
	{:else if creating}
		<form class="cf" onsubmit={submitCreate} data-testid="spoolman-create-form">
			<p class="hint">
				Creates the filament in Spoolman{vendorIsNew ? ' (and the new vendor)' : ''}, then links
				this color to it. Values come from the filament catalog; check them against the spool.
			</p>
			{#if cform?.error}<p class="warn" role="status">{vendorWarn}</p>{/if}
			<label class="f"
				><span>Vendor</span>
				<input
					list="smp-vendors-{role}"
					bind:value={fVendor}
					required
					maxlength="200"
					autocomplete="off"
					data-testid="create-vendor"
				/>
				<datalist id="smp-vendors-{role}">
					{#each cvendors as v (v)}<option value={v}></option>{/each}
				</datalist>
				{#if vendorIsNew}<span class="note" data-testid="create-vendor-new"
						>Not in Spoolman yet: it will be created.</span
					>{/if}
			</label>
			<label class="f"
				><span>Name</span>
				<input bind:value={fName} required maxlength="200" data-testid="create-name" /></label
			>
			<div class="two">
				<label class="f"
					><span>Material</span>
					<input
						bind:value={fMaterial}
						required
						maxlength="60"
						data-testid="create-material"
					/></label
				>
				<label class="f"
					><span>Color</span>
					<span class="hexrow"
						><input type="color" bind:value={fHex} aria-label="Color" data-testid="create-hex" />
						<code>{fHex}</code></span
					></label
				>
			</div>
			<div class="two">
				<label class="f"
					><span>Density (g/cm³)</span>
					<input
						type="number"
						step="0.01"
						min="0.1"
						max="10"
						inputmode="decimal"
						bind:value={fDensity}
						required
						data-testid="create-density"
					/></label
				>
				<label class="f"
					><span>Diameter (mm)</span>
					<input
						type="number"
						step="0.01"
						min="0.5"
						max="5"
						inputmode="decimal"
						bind:value={fDiameter}
						required
						data-testid="create-diameter"
					/></label
				>
			</div>
			<div class="two">
				<label class="f"
					><span>Net weight (g)</span>
					<input
						type="number"
						step="1"
						min="1"
						max="20000"
						inputmode="numeric"
						bind:value={fWeight}
						required
						data-testid="create-weight"
					/></label
				>
				<label class="f"
					><span>Empty spool (g)</span>
					<input
						type="number"
						step="1"
						min="0"
						max="5000"
						inputmode="numeric"
						bind:value={fSpool}
						data-testid="create-spool-weight"
					/></label
				>
			</div>
			<div class="smp-row">
				<button class="btn primary" type="submit" disabled={busy} data-testid="create-submit"
					>Create and link</button
				>
				<button
					class="btn ghost"
					type="button"
					disabled={busy}
					onclick={() => {
						creating = false;
						error = '';
					}}>Back</button
				>
			</div>
		</form>
	{:else if mode === 'spool'}
		<p class="hint">Deductions start on this spool. When it runs out, the next open one is used.</p>
		<ul class="list">
			{#each linkedFilament?.spools.filter((x) => !x.archived) ?? [] as sp (sp.id)}
				<li>
					<button
						type="button"
						class="item"
						class:on={sp.id === currentSpoolId}
						disabled={busy}
						data-testid="spoolman-spool-option"
						onclick={() => chooseSpool(sp.id)}
					>
						<span class="nm">Spool #{sp.id}{sp.location ? ` · ${sp.location}` : ''}</span>
						<span class="muted num"
							>{sp.remainingG != null ? `${fmt(sp.remainingG)} g left` : ''}</span
						>
					</button>
				</li>
			{:else}
				<li class="muted pad">{loading ? 'Loading…' : 'No open spools.'}</li>
			{/each}
		</ul>
		{#if currentSpoolId != null}
			<button class="btn ghost sm" type="button" disabled={busy} onclick={() => chooseSpool(null)}
				>Let the app choose</button
			>
		{/if}
	{:else}
		<input
			type="search"
			class="search"
			placeholder="Search Spoolman by name, brand, material"
			aria-label="Search Spoolman filaments"
			bind:value={q}
			data-testid="spoolman-search"
		/>
		{#if offline}
			<p class="warn" role="status">Spoolman is not reachable; showing what was seen last.</p>
		{/if}
		{#snippet row(s: SpoolmanSuggestionDto)}
			<li>
				<button
					type="button"
					class="item"
					class:on={s.filament.id === currentFilamentId}
					disabled={busy}
					data-testid="spoolman-filament-option"
					data-level={s.level}
					onclick={() => choose(s)}
				>
					<Swatch hex={s.filament.colorHex ?? 'var(--line)'} />
					<span class="nm">
						{s.filament.vendor ? `${s.filament.vendor} ` : ''}{s.filament.name}
						{#if s.filament.material}<span class="muted"> · {s.filament.material}</span>{/if}
						{#if s.reasons.length && !matches}
							<span class="why">{s.reasons.slice(0, 3).join(' · ')}</span>
						{/if}
					</span>
					<span class="muted num">{stockOf(s)}</span>
				</button>
			</li>
		{/snippet}
		{#if matches}
			<ul class="list">
				{#each matches.slice(0, 60) as s (s.filament.id)}{@render row(s)}{:else}
					<li class="muted pad">No filament matches.</li>
				{/each}
			</ul>
		{:else}
			{#if best.length}
				<h4>Best matches</h4>
				<ul class="list">
					{#each best as s (s.filament.id)}{@render row(s)}{/each}
				</ul>
			{:else if !loading && !error}
				<p class="muted">Nothing in Spoolman looks like this filament. Search below.</p>
			{/if}
			{#if rest.length}
				<button class="btn ghost sm" type="button" onclick={() => (showAll = !showAll)}
					>{showAll ? 'Hide' : 'Show'} all {all.length} filaments</button
				>
				{#if showAll}
					<ul class="list">
						{#each rest.slice(0, 100) as s (s.filament.id)}{@render row(s)}{/each}
					</ul>
				{/if}
			{/if}
		{/if}
		{#if loading}<p class="muted">Loading…</p>{/if}
		{#if !loading && !offline}
			<div class="smp-row">
				<button
					class="btn ghost sm"
					type="button"
					disabled={busy}
					data-testid="spoolman-create-open"
					onclick={openCreate}>Create in Spoolman…</button
				>
			</div>
		{/if}
	{/if}
	{#if error}<div class="error" role="alert" style="white-space:normal">{error}</div>{/if}
	{#if onclose && !done && !creating && !reusedInfo}
		<div class="smp-row">
			<button class="btn ghost sm" type="button" onclick={() => onclose?.()}>Cancel</button>
		</div>
	{/if}
</div>

<style>
	.smp {
		display: grid;
		gap: var(--sp-3);
		min-width: 0;
	}
	h4 {
		margin: var(--sp-2) 0 0;
		font-size: var(--fs-sm);
		color: var(--muted);
		font-weight: 600;
	}
	.hint,
	.warn,
	.pre p {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.hint {
		color: var(--muted);
	}
	.warn {
		color: var(--warn);
	}
	.search {
		padding: 9px var(--sp-5);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		font-size: var(--fs-base);
		min-width: 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 300px;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		width: 100%;
		text-align: left;
		background: var(--card);
		color: var(--ink);
		border: 0;
		border-bottom: 1px solid var(--line);
		padding: 9px var(--sp-5);
		font-size: var(--fs-md);
	}
	.item:hover:not(:disabled),
	.item.on {
		background: var(--accent-soft);
	}
	.nm {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		display: grid;
	}
	.why {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.num {
		font-size: var(--fs-sm);
		text-align: right;
	}
	.cf {
		display: grid;
		gap: var(--sp-4);
	}
	.f {
		display: grid;
		gap: 4px;
		font-size: var(--fs-sm);
		min-width: 0;
	}
	.f > span:first-child {
		color: var(--muted);
	}
	.f input:not([type='color']) {
		padding: 9px var(--sp-5);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		color: var(--ink);
		font-size: var(--fs-base);
		min-width: 0;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-4);
	}
	.hexrow {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		min-height: 40px;
	}
	.note {
		font-size: var(--fs-xs);
		color: var(--muted);
	}
	.pad {
		padding: var(--sp-5);
	}
	.pre {
		display: grid;
		gap: var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--sp-5);
		background: var(--card);
	}
	.opt {
		display: flex;
		gap: var(--sp-4);
		align-items: flex-start;
		font-size: var(--fs-md);
	}
	.smp-row {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	@media (max-width: 520px) {
		.item {
			flex-wrap: wrap;
		}
		.num {
			margin-left: auto;
		}
	}
</style>
