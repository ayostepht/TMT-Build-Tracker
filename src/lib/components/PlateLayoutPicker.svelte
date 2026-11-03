<script lang="ts">
	import {
		buildPlateLayouts,
		setPlateLayout,
		templatePlateLayouts,
		type PlateLayoutInfo
	} from '#lib/client/api.ts';

	/**
	 * Picks the plate layout (per printer family) of a template or a build.
	 *
	 * - New build form: pass `templateId`; renders `<select name="plateLayout">` so a plain
	 *   form post carries the choice ('' = the template's default plates).
	 * - Existing build: pass `buildId`; changing the select switches the build's plates
	 *   right away (asks before converting print logs that hang on plates) and calls
	 *   `onchanged`. With `allowUpload`, an extra entry calls `onupload`.
	 */
	let {
		templateId = '',
		buildId = '',
		name = 'plateLayout',
		disabled = false,
		allowUpload = false,
		label = 'Plate layout',
		onchanged,
		onupload
	}: {
		templateId?: string;
		buildId?: string;
		name?: string;
		disabled?: boolean;
		allowUpload?: boolean;
		label?: string;
		onchanged?: () => void;
		onupload?: () => void;
	} = $props();

	let layouts = $state<PlateLayoutInfo[]>([]);
	let current = $state<string | null>(null); // build mode: layout key, 'upload' or null
	let value = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function load() {
		try {
			if (buildId) {
				const r = await buildPlateLayouts(buildId);
				layouts = r.layouts;
				current = r.current;
				value = r.current ?? '';
			} else if (templateId) {
				layouts = await templatePlateLayouts(templateId);
				value = '';
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

	const note = $derived(
		layouts.find((l) => l.key === (value || layouts.find((x) => x.isDefault)?.key))?.printerNote
	);

	async function change(picked: string) {
		error = null;
		value = picked;
		if (!buildId) return;
		if (value === '__upload__') {
			value = current ?? '';
			onupload?.();
			return;
		}
		const key = value || layouts.find((l) => l.isDefault)?.key || '';
		if (!key || key === current) return;
		busy = true;
		try {
			try {
				await setPlateLayout(buildId, key);
			} catch (e) {
				if (e instanceof Error && /print log/.test(e.message)) {
					if (!confirm(`${e.message}\n\nSwitch layout and convert them?`)) {
						value = current ?? '';
						return;
					}
					await setPlateLayout(buildId, key, true);
				} else throw e;
			}
			current = key;
			onchanged?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not switch the layout.';
			value = current ?? '';
		} finally {
			busy = false;
		}
	}
</script>

{#if layouts.length > 1 || (buildId && (allowUpload || current === 'upload'))}
	<label class="field plate-layout">
		{label}
		<select
			{name}
			bind:value
			disabled={disabled || busy}
			onchange={buildId ? (e) => change(e.currentTarget.value) : undefined}
			data-testid="plate-layout"
		>
			{#if !buildId}
				<option value="">
					{layouts.find((l) => l.isDefault)?.name ?? 'Default'} (default)
				</option>
				{#each layouts.filter((l) => !l.isDefault) as l (l.key)}
					<option value={l.key}>{l.name}</option>
				{/each}
			{:else}
				{#each layouts as l (l.key)}
					<option value={l.key}>{l.name} ({l.plateCount} plates)</option>
				{/each}
				{#if current === 'upload'}<option value="upload" disabled>Your uploaded 3MF</option>{/if}
				{#if allowUpload}<option value="__upload__">Upload my sliced 3MF…</option>{/if}
			{/if}
		</select>
		{#if note && !buildId}<span class="hint">{note}</span>{/if}
		{#if error}<span class="err" role="alert">{error}</span>{/if}
	</label>
{/if}

<style>
	.hint {
		font-size: 12px;
		color: var(--muted);
	}
	.err {
		font-size: 12px;
		color: var(--bad, #b3261e);
	}
</style>
