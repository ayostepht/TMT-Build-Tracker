<script lang="ts">
	import {
		createLibraryPiece,
		inspectCustomPartFile,
		type InspectedFile,
		type LibraryPiece,
		type NewLibraryPiece
	} from '#lib/client/api.ts';
	import { CUSTOM_NAME_MAX, MAX_CUSTOM_PLATES } from '#lib/domain/custom.ts';
	import { MAX_PRINT_SECONDS, parseGrams } from '#lib/domain/index.ts';
	import SlicerTimeInput from './SlicerTimeInput.svelte';

	type Template = {
		roles: { key: string; name: string; material: string; hex: string }[];
		parts: { slug: string; name: string; section: string }[];
	};

	/**
	 * Add a saved custom part to a workspace without a build: pick a .3mf (optional) or fill it in by hand.
	 * The file is only read for its numbers; it is never kept.
	 */
	let {
		organizationId,
		template,
		oncreated,
		onclose
	}: {
		organizationId: string;
		template: Template;
		oncreated: (piece: LibraryPiece) => void;
		onclose: () => void;
	} = $props();

	type PlateDraft = {
		key: number;
		name: string;
		seconds: number | null;
		gramsText: string;
		runs: number;
		role: string;
		/** The file plate this came from, with its values as read. */
		from?: { index: number; seconds: number | null; grams: number | null };
	};

	const MAX_GRAMS = 20000;
	let nextKey = 1;
	const firstRole = () => template.roles[0]?.key ?? '';
	const blank = (): PlateDraft => ({
		key: nextKey++,
		name: '',
		seconds: null,
		gramsText: '',
		runs: 1,
		role: firstRole()
	});

	let phase = $state<'form' | 'reading' | 'saving'>('form');
	let progress = $state(0);
	let error = $state<string | null>(null);
	let file = $state<InspectedFile | null>(null);
	let name = $state('');
	let plates = $state<PlateDraft[]>([blank()]);
	let removedFromFile = $state(false);
	let slotRole = $state<Record<string, string>>({});
	let replaces = $state<string[]>([]);
	let isDefault = $state(false);
	let drag = $state(false);

	const baseName = (f: string) =>
		f
			.replace(/\.gcode\.3mf$/i, '')
			.replace(/\.3mf$/i, '')
			.replace(/[_]+/g, ' ')
			.trim()
			.slice(0, CUSTOM_NAME_MAX);

	/** The role whose color is nearest to a filament color, to prefill the slot mapping. */
	function nearestRole(color: string | null): string {
		const rgb = (h: string | null) => {
			const m = /^#?([0-9a-f]{6})/i.exec(h ?? '');
			if (!m) return null;
			const n = parseInt(m[1], 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
		};
		const c = rgb(color);
		if (!c) return firstRole();
		let best = firstRole();
		let bestD = Infinity;
		for (const r of template.roles) {
			const x = rgb(r.hex);
			if (!x) continue;
			const d = (x[0] - c[0]) ** 2 + (x[1] - c[1]) ** 2 + (x[2] - c[2]) ** 2;
			if (d < bestD) {
				bestD = d;
				best = r.key;
			}
		}
		return best;
	}

	async function pick(f: File | null | undefined) {
		if (!f) return;
		if (!/\.3mf$/i.test(f.name)) {
			error = 'Choose a .3mf file (a .gcode.3mf from your slicer works too).';
			return;
		}
		error = null;
		progress = 0;
		phase = 'reading';
		try {
			const r = await inspectCustomPartFile(organizationId, f, (x) => (progress = x));
			file = r;
			name = baseName(r.fileName || f.name);
			removedFromFile = false;
			slotRole = Object.fromEntries(r.filaments.map((s) => [s.slot, nearestRole(s.color)]));
			plates = r.plates.slice(0, MAX_CUSTOM_PLATES).map((p) => ({
				key: nextKey++,
				name: p.name || '',
				seconds: r.sliced ? p.estSeconds : null,
				gramsText:
					r.sliced && p.grams && p.grams > 0 ? String(Math.round(p.grams * 100) / 100) : '',
				runs: Math.min(20, Math.max(1, p.runsHint || 1)),
				role: p.filaments.length ? nearestRole(p.filaments[0].color) : firstRole(),
				from: { index: p.index, seconds: r.sliced ? p.estSeconds : null, grams: p.grams }
			}));
			if (!plates.length) plates = [blank()];
		} catch (e) {
			error = e instanceof Error ? e.message : 'The file could not be read.';
		}
		phase = 'form';
	}

	function clearFile() {
		file = null;
		plates = [blank()];
		removedFromFile = false;
	}

	const gramsOf = (p: PlateDraft) => parseGrams(p.gramsText);
	const gramsBad = (p: PlateDraft) => {
		const g = gramsOf(p);
		return g !== null && (Number.isNaN(g) || g <= 0 || g > MAX_GRAMS);
	};
	const timeBad = (p: PlateDraft) => (p.seconds ?? 0) > MAX_PRINT_SECONDS;

	/** Filament slots of a sliced file that carry weight: more than one needs a role each. */
	const usedSlots = $derived.by(() => {
		if (!file?.sliced) return [] as string[];
		const keep = plates.flatMap((p) => (p.from ? [p.from.index] : []));
		const slots = file.plates
			.filter((fp) => keep.includes(fp.index))
			.flatMap((fp) =>
				Object.entries(fp.filamentGrams ?? {})
					.filter(([, g]) => g > 0)
					.map(([slot]) => slot)
			);
		return slots.filter((s, i) => slots.indexOf(s) === i);
	});
	const multi = $derived(usedSlots.length > 1);
	const slotLabel = (slot: string) => {
		const f = file?.filaments.find((x) => x.slot === slot);
		return f ? `#${slot} ${f.material}${f.name ? ` · ${f.name}` : ''}` : `#${slot}`;
	};

	const unchanged = $derived(
		!!file?.sliced &&
			!removedFromFile &&
			plates.length === file.plates.length &&
			plates.every((p) => {
				if (!p.from) return false;
				const g = gramsOf(p);
				const fileG = p.from.grams && p.from.grams > 0 ? p.from.grams : null;
				return (
					p.seconds === p.from.seconds &&
					(g === null ? fileG === null : !Number.isNaN(g) && Math.abs(g - (fileG ?? -1)) < 0.006)
				);
			})
	);

	const problem = $derived(
		!name.trim()
			? 'Give the part a name.'
			: !plates.length
				? 'Add at least one plate.'
				: plates.some(timeBad)
					? 'Print time can be at most 30 days.'
					: plates.some(gramsBad)
						? 'Grams must be more than 0 and at most 20000.'
						: plates.some((p) => !(multi && p.from) && !p.role)
							? 'Choose a color for every plate.'
							: multi && usedSlots.some((s) => !slotRole[s])
								? 'Choose a color for every filament.'
								: null
	);

	function build(): NewLibraryPiece {
		const sliced = unchanged;
		return {
			name: name.trim(),
			fileName: file?.fileName ?? null,
			sliced,
			isDefault,
			replaces,
			plates: plates.map((p) => {
				const g = gramsOf(p);
				const grams = g && !Number.isNaN(g) ? g : null;
				const fp = file && p.from ? file.plates.find((x) => x.index === p.from!.index) : null;
				let filamentGrams: Record<string, number> | undefined;
				if (multi && fp) {
					filamentGrams = {};
					for (const [slot, gr] of Object.entries(fp.filamentGrams ?? {})) {
						const key = slotRole[slot];
						if (gr > 0 && key) filamentGrams[key] = (filamentGrams[key] ?? 0) + gr;
					}
					if (!Object.keys(filamentGrams).length) filamentGrams = undefined;
				}
				const role = filamentGrams ? Object.keys(filamentGrams)[0] : p.role;
				return {
					name: p.name.trim() || undefined,
					estSeconds: p.seconds,
					grams,
					role,
					runs: p.runs,
					...(filamentGrams ? { filamentGrams } : {})
				};
			})
		};
	}

	async function save() {
		if (problem || phase !== 'form') return;
		phase = 'saving';
		error = null;
		try {
			const { piece } = await createLibraryPiece(organizationId, build());
			oncreated(piece);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not add the part.';
			phase = 'form';
		}
	}

	const sections = $derived.by(() => {
		const out: [string, { slug: string; name: string }[]][] = [];
		for (const p of template.parts) {
			const k = p.section || 'Other';
			const hit = out.find((o) => o[0] === k);
			if (hit) hit[1].push(p);
			else out.push([k, [p]]);
		}
		return out;
	});
	const toggleReplace = (slug: string, on: boolean) =>
		(replaces = on ? [...replaces, slug] : replaces.filter((s) => s !== slug));
	const removePlate = (key: number) => {
		const p = plates.find((x) => x.key === key);
		if (p?.from) removedFromFile = true;
		plates = plates.filter((x) => x.key !== key);
	};
</script>

<form
	class="lpf"
	aria-label="Add a custom part"
	data-testid="library-add-form"
	onsubmit={(e) => {
		e.preventDefault();
		void save();
	}}
>
	<div class="lpf-head">
		<h3>Add a custom part</h3>
		<button type="button" class="btn sm ghost" onclick={onclose} disabled={phase === 'saving'}
			>Cancel</button
		>
	</div>
	{#if error}<div class="error" role="alert">{error}</div>{/if}

	{#if phase === 'reading'}
		<div class="lpf-progress" role="status">
			<div class="lpf-bar"><span style="width:{Math.round(progress * 100)}%"></span></div>
			<span class="meta"
				>{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Reading the file…'}</span
			>
		</div>
	{:else}
		{#if file}
			<p class="meta lpf-file">
				<b>{file.fileName}</b> · {file.sliced ? 'sliced' : 'not sliced'}{#if file.printer}
					· {file.printer}{/if}
				<button
					type="button"
					class="btn sm ghost"
					onclick={clearFile}
					data-testid="library-clear-file">Fill in by hand instead</button
				>
			</p>
			{#each file.warnings as w (w)}<p class="lpf-note">{w}</p>{/each}
			{#if !file.sliced}
				<p class="lpf-note" data-testid="custom-unsliced-note">
					This file has no print time or weight in it. A project saved from the slicer does not keep
					them: export the sliced file instead (in Bambu Studio, Orca or Elegoo Slicer: slice, then
					Export, Export plate sliced file, a .gcode.3mf), or type the time and grams below.
				</p>
			{/if}
		{:else}
			<label
				class="lpf-drop"
				class:drag
				ondragover={(e) => {
					e.preventDefault();
					drag = true;
				}}
				ondragleave={() => (drag = false)}
				ondrop={(e) => {
					e.preventDefault();
					drag = false;
					void pick(e.dataTransfer?.files?.[0]);
				}}
			>
				<input
					type="file"
					accept=".3mf,model/3mf"
					data-testid="library-3mf-file"
					onchange={(e) => void pick(e.currentTarget.files?.[0])}
				/>
				<span>Choose a .3mf to fill this in, or drop it here. Or type it below.</span>
			</label>
		{/if}

		<label class="lpf-field">
			<span class="lpf-label">Name</span>
			<input
				type="text"
				bind:value={name}
				maxlength={CUSTOM_NAME_MAX}
				autocomplete="off"
				data-testid="library-name"
			/>
		</label>

		<ul class="lpf-plates">
			{#each plates as p, i (p.key)}
				<li class="card card--compact lpf-plate" data-testid="library-plate">
					<div class="lpf-plate-head">
						<b>Plate {i + 1}</b>
						{#if plates.length > 1}
							<button
								type="button"
								class="btn sm ghost"
								onclick={() => removePlate(p.key)}
								data-testid="library-plate-remove">Remove plate</button
							>
						{/if}
					</div>
					<label class="lpf-field">
						<span class="lpf-label">Plate name</span>
						<input
							type="text"
							bind:value={p.name}
							maxlength={CUSTOM_NAME_MAX}
							autocomplete="off"
							data-testid="library-plate-name"
						/>
					</label>
					<div class="lpf-nums">
						<SlicerTimeInput
							label="Print time"
							value={p.seconds}
							placeholder="e.g. 2h 30m"
							title="Time of one print of this plate."
							onsave={(sec) => (p.seconds = sec)}
						/>
						<label class="slicer-in lpf-num">
							Grams (per print)
							<input
								type="text"
								inputmode="decimal"
								autocomplete="off"
								placeholder="g"
								bind:value={p.gramsText}
								aria-invalid={gramsBad(p)}
								data-testid="library-plate-grams"
							/>
						</label>
						<label class="slicer-in lpf-num lpf-runs">
							Prints
							<input
								type="number"
								min="1"
								max="20"
								step="1"
								inputmode="numeric"
								bind:value={p.runs}
								data-testid="library-plate-runs"
							/>
						</label>
					</div>
					{#if !(multi && p.from)}
						<label class="lpf-field">
							<span class="lpf-label">Printed in</span>
							<select bind:value={p.role} data-testid="library-plate-role">
								{#each template.roles as r (r.key)}
									<option value={r.key}>{r.name} ({r.material})</option>
								{/each}
							</select>
						</label>
					{/if}
				</li>
			{/each}
		</ul>
		{#if !file}
			<div>
				<button
					type="button"
					class="btn sm"
					disabled={plates.length >= MAX_CUSTOM_PLATES}
					onclick={() => (plates = [...plates, blank()])}
					data-testid="library-plate-add">Add another plate</button
				>
			</div>
		{/if}

		{#if multi}
			<fieldset class="lpf-slots" data-testid="library-slots">
				<legend>Colors of the file's filaments</legend>
				{#each usedSlots as s (s)}
					{@const f = file?.filaments.find((x) => x.slot === s)}
					<label class="lpf-slot">
						<span class="lpf-swatch" style="background:{f?.color ?? 'transparent'}"></span>
						<span class="lpf-fl">{slotLabel(s)}</span>
						<select bind:value={slotRole[s]} aria-label="Color for filament {slotLabel(s)}">
							{#each template.roles as r (r.key)}
								<option value={r.key}>{r.name} ({r.material})</option>
							{/each}
						</select>
					</label>
				{/each}
			</fieldset>
		{/if}

		{#if sections.length}
			<details class="lpf-replaces" data-testid="library-replaces">
				<summary
					>Replaces kit parts{replaces.length ? ` (${replaces.length})` : ''}
					<span class="meta">optional</span></summary
				>
				<p class="meta">
					When you add this part to a build, these kit parts are marked Not printing. Nothing is
					deleted.
				</p>
				{#each sections as [title, parts] (title)}
					<fieldset class="lpf-group">
						<legend>{title}</legend>
						{#each parts as p (p.slug)}
							<label class="lpf-chk">
								<input
									type="checkbox"
									checked={replaces.includes(p.slug)}
									onchange={(e) => toggleReplace(p.slug, e.currentTarget.checked)}
								/>
								{p.name}
							</label>
						{/each}
					</fieldset>
				{/each}
			</details>
		{/if}

		<label class="lpf-chk lpf-default">
			<input type="checkbox" bind:checked={isDefault} data-testid="library-include-default" />
			Include in new builds
		</label>

		{#if file && file.sliced && !unchanged}
			<p class="meta">You changed the numbers from the file: they are kept as typed values.</p>
		{/if}
		{#if problem}<p class="meta lpf-problem" role="status">{problem}</p>{/if}
		<div class="lpf-actions">
			<button type="button" class="btn" onclick={onclose} disabled={phase === 'saving'}
				>Cancel</button
			>
			<button
				type="submit"
				class="btn primary"
				disabled={!!problem || phase === 'saving'}
				data-testid="library-create">{phase === 'saving' ? 'Adding…' : 'Add custom part'}</button
			>
		</div>
	{/if}
</form>

<style>
	.lpf {
		display: grid;
		gap: var(--sp-5);
	}
	.lpf h3 {
		margin: 0;
	}
	.lpf-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--sp-4);
	}
	.lpf-file {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-3);
		overflow-wrap: anywhere;
		margin: 0;
	}
	.lpf-note {
		margin: 0;
		padding: var(--sp-4) var(--sp-5);
		border-radius: var(--r-md);
		background: var(--warn-soft);
		color: var(--ink);
		font-size: var(--fs-sm);
	}
	.lpf-drop {
		display: grid;
		place-items: center;
		padding: 22px var(--sp-6);
		border: 2px dashed var(--line);
		border-radius: var(--r-lg);
		color: var(--muted);
		cursor: pointer;
		text-align: center;
	}
	.lpf-drop.drag {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.lpf-progress {
		display: grid;
		gap: var(--sp-3);
	}
	.lpf-bar {
		display: flex;
		height: 8px;
		background: var(--line);
		border-radius: var(--r-sm);
		overflow: hidden;
	}
	.lpf-bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.15s;
	}
	.lpf-field {
		display: grid;
		gap: var(--sp-2);
	}
	.lpf-label {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.lpf input[type='text'],
	.lpf input[type='number'],
	.lpf select {
		width: 100%;
		min-width: 0;
		padding: 7px var(--sp-4);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--card);
		color: var(--ink);
		font-size: var(--fs-md);
	}
	.lpf-plates {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-4);
	}
	.lpf-plate {
		display: grid;
		gap: var(--sp-4);
		background: var(--paper);
	}
	.lpf-plate-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--sp-4);
	}
	.lpf-nums {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4) var(--sp-5);
	}
	.lpf-nums :global(.slicer-in) {
		display: grid;
		gap: var(--sp-1);
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.lpf .lpf-nums :global(input[type='text']) {
		width: 9em;
	}
	.lpf .lpf-runs input {
		width: 5.5em;
	}
	.lpf-slots {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--sp-4) var(--sp-5);
		display: grid;
		gap: var(--sp-4);
		margin: 0;
	}
	.lpf-slots legend {
		font-size: var(--fs-sm);
		font-weight: 600;
		padding: 0 var(--sp-2);
	}
	.lpf-slot {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--sp-2) var(--sp-4);
		align-items: center;
	}
	.lpf-slot select {
		grid-column: 1 / -1;
	}
	.lpf-swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1px solid var(--line);
	}
	.lpf-replaces {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--sp-4) var(--sp-5);
	}
	.lpf-replaces summary {
		cursor: pointer;
		font-weight: 600;
		min-height: 32px;
	}
	.lpf-replaces p {
		margin: var(--sp-3) 0;
	}
	.lpf-group {
		border: 0;
		padding: 0;
		margin: var(--sp-4) 0 0;
		display: grid;
		gap: var(--sp-2);
	}
	.lpf-group legend {
		padding: 0;
		font-size: var(--fs-sm);
		color: var(--muted);
		font-weight: 600;
	}
	.lpf-chk {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		min-height: 32px;
	}
	.lpf-default {
		min-height: 44px;
	}
	.lpf-problem {
		margin: 0;
		color: var(--warn);
		font-weight: 600;
	}
	.lpf-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-4);
	}
	@media (pointer: coarse) {
		.lpf input[type='text'],
		.lpf input[type='number'],
		.lpf select,
		.lpf .lpf-nums :global(input[type='text']) {
			font-size: var(--fs-field);
			min-height: 40px;
		}
	}
	@media (min-width: 761px) {
		.lpf-slot {
			grid-template-columns: auto 1fr minmax(180px, 1fr);
		}
		.lpf-slot select {
			grid-column: auto;
		}
	}
</style>
