<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { applyDesign, setSetupStep, setVariant } from '#lib/client/api.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import DesignWorkspace from '#lib/components/build/DesignWorkspace.svelte';
	import PlatesPanel from '#lib/components/build/PlatesPanel.svelte';
	import TemplateStep from '#lib/components/build/TemplateStep.svelte';
	import ExportCard from '#lib/components/ExportCard.svelte';
	import Swatch from '#lib/components/Swatch.svelte';
	import VariantChooser from '#lib/components/VariantChooser.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ctx = getBuildCtx();

	const STEPS = [
		{ n: 1, label: 'Template' },
		{ n: 2, label: 'Options' },
		{ n: 3, label: 'Colors' },
		{ n: 4, label: 'Files' },
		{ n: 5, label: 'Export' }
	];
	/** Furthest step reached; a finished setup has reached them all. */
	const reached = $derived(ctx.view.build.setupStep ?? 5);
	const param = $derived(page.url.searchParams.get('step'));
	const isDone = $derived(param === 'done');
	/** Named `?step=` values: the step labels, plus "print", the old name of step 4. */
	const STEP_NAMES: Record<string, number> = {
		template: 1,
		options: 2,
		colors: 3,
		print: 4,
		files: 4,
		export: 5
	};
	/** Export needs a printer (its bed size and filament slots), so Files is where the wizard stops without one. */
	const needsPrinter = $derived(!ctx.view.printer);
	const MAX_WITHOUT_PRINTER = 4;
	const step = $derived.by(() => {
		const n = param && param in STEP_NAMES ? STEP_NAMES[param] : Number(param);
		const asked =
			Number.isInteger(n) && n >= 1 && n <= 5
				? Math.min(n, reached)
				: Math.min(ctx.view.build.setupStep ?? 1, 5);
		return needsPrinter ? Math.min(asked, MAX_WITHOUT_PRINTER) : asked;
	});
	/** Why Continue is blocked on this step, or '' (it is not). */
	const blocker = $derived(
		step === 4 && needsPrinter
			? "Choose your printer above to continue: the export uses its bed size and filament slots. Add one on the Printers page if it isn't listed."
			: ''
	);

	let busy = $state(false);
	let error = $state('');

	async function go(to: number | 'done') {
		error = '';
		if (
			to === 'done'
				? needsPrinter
				: typeof to === 'number' && to > MAX_WITHOUT_PRINTER && needsPrinter
		) {
			error = 'Choose your printer first: the export uses its bed size and filament slots.';
			return;
		}
		if (typeof to === 'number' && to > (ctx.view.build.setupStep ?? 5)) {
			try {
				await setSetupStep(ctx.id, to);
				await ctx.refresh();
			} catch (e) {
				error = e instanceof Error ? e.message : 'Could not save your place';
				return;
			}
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(`?step=${to}`);
		window.scrollTo({ top: 0 });
	}

	async function finish(to: 'overview' | 'stay' = 'overview') {
		busy = true;
		try {
			await setSetupStep(ctx.id, null);
			await ctx.refresh();
			if (to === 'overview') await goto(resolve('/(app)/builds/[id]', { id: ctx.id }));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not finish setup';
		} finally {
			busy = false;
		}
	}

	let designId = $state('');
	async function useDesign() {
		if (!designId) return;
		if (await ctx.act(() => applyDesign(designId, ctx.id))) designId = '';
	}
	const partNames = $derived(Object.fromEntries(ctx.view.allParts.map((p) => [p.slug, p.name])));
</script>

<svelte:head><title>Set up · {ctx.view.build.name} · TMT Build Tracker</title></svelte:head>

<section class="wizard stack" data-testid="setup-wizard">
	<header class="wh">
		<div>
			<div class="kicker">{isDone ? 'Setup' : `Setup · step ${step} of 5`}</div>
			<h1>{ctx.view.build.name}</h1>
		</div>
		<button
			type="button"
			class="btn sm"
			data-testid="skip-setup"
			disabled={busy}
			onclick={() => finish()}>Skip setup</button
		>
	</header>

	<ol class="steps" aria-label="Setup steps">
		{#each STEPS as s (s.n)}
			{@const state = !isDone && s.n === step ? 'now' : s.n < reached || isDone ? 'done' : 'todo'}
			<li>
				<button
					type="button"
					class="st {state}"
					disabled={s.n > reached || (s.n > MAX_WITHOUT_PRINTER && needsPrinter)}
					aria-current={!isDone && s.n === step ? 'step' : undefined}
					data-testid="setup-step-{s.n}"
					onclick={() => go(s.n)}
				>
					<span class="no" aria-hidden="true">{state === 'done' ? '✓' : s.n}</span>
					<span class="lb">{s.label}</span>
				</button>
			</li>
		{/each}
	</ol>

	{#if error}<div class="banner bad" role="alert">{error}</div>{/if}

	{#if isDone}
		<div class="card done" data-testid="setup-done">
			<h2>All set</h2>
			<p>
				{ctx.view.build.name} is ready. Next you print the plates, then assemble and hand it over.
			</p>
			<div>
				<button
					type="button"
					class="btn primary"
					disabled={busy}
					data-testid="setup-finish"
					onclick={() => finish()}>Open the build</button
				>
			</div>
		</div>
	{:else if step === 1}
		{#key data.baseTemplateId}
			<TemplateStep
				baseTemplateId={data.baseTemplateId}
				onSlicedFile={ctx.canEdit
					? (file) => {
							ctx.slicedFile = file;
							void go(4);
						}
					: undefined}
			/>
		{/key}
	{:else if step === 2}
		<section class="card" aria-labelledby="opt-h">
			<h2 id="opt-h">Options</h2>
			{#if ctx.view.variantGroups.length}
				<p class="muted">
					Pick the parts this build uses. You can change them later in the Design tab.
				</p>
				<VariantChooser
					groups={ctx.view.variantGroups}
					choices={ctx.view.variantChoices}
					{partNames}
					onselect={(group, option) => ctx.act(() => setVariant(ctx.id, group, option))}
				/>
			{:else}
				<p class="muted">This kit has no options. Carry on.</p>
			{/if}
		</section>
	{:else if step === 3}
		<div class="colorbar">
			<h2 id="col-h">Colors</h2>
			{#if data.designs.length}
				<div class="designs" data-testid="design-start">
					<select
						bind:value={designId}
						aria-label="Start from a saved or shared design"
						data-testid="design-start-select"
					>
						<option value="">Start from a saved or shared design…</option>
						{#each data.designs as d (d.id)}
							<option value={d.id}>{d.name}{d.mine ? ' (mine)' : ''}</option>
						{/each}
					</select>
					{#if designId}
						{@const d = data.designs.find((x) => x.id === designId)}
						<span class="strip" aria-hidden="true">
							{#each d?.roles ?? [] as r (r.key)}<Swatch hex={r.hex} size="mini" />{/each}
						</span>
					{/if}
					<button type="button" class="btn sm" disabled={!designId} onclick={useDesign}
						>Use design</button
					>
				</div>
			{/if}
		</div>
		<DesignWorkspace embedded />
	{:else if step === 4}
		<section class="card intro">
			<h2>Files</h2>
			<p class="muted">
				Choose your printer's bed so the parts fit, then how the plates are laid out: arranged for
				your bed, one of MakeGood's tuned Bambu profiles, or your own sliced file.
			</p>
		</section>
		<PlatesPanel wizard />
	{:else}
		<section class="card intro">
			<h2>Export</h2>
			<p class="muted">
				Download plates for your slicer with the supports and colors in place. You can do this again
				any time from the Files tab.
			</p>
		</section>
		<ExportCard />
	{/if}

	{#if !isDone}
		{#if blocker}
			<p class="banner blocker" id="wizard-blocker" role="status" data-testid="wizard-blocker">
				{blocker}
			</p>
		{/if}
		<div class="nav">
			{#if step > 1}
				<button type="button" class="btn" data-testid="wizard-back" onclick={() => go(step - 1)}
					>Back</button
				>
			{/if}
			<span class="sp"></span>
			{#if step < 5}
				<button
					type="button"
					class="btn primary"
					data-testid="wizard-next"
					disabled={!!blocker}
					aria-describedby={blocker ? 'wizard-blocker' : undefined}
					onclick={() => go(step + 1)}>Continue</button
				>
			{:else}
				<button
					type="button"
					class="btn primary"
					data-testid="wizard-done"
					onclick={() => go('done')}>Finish setup</button
				>
			{/if}
		</div>
	{/if}
</section>

<style>
	.wizard {
		display: grid;
		gap: 16px;
		min-width: 0;
	}
	.wh {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 6px;
	}
	.st {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 8px 4px;
		min-height: 56px;
		border: 0;
		border-top: 4px solid var(--line);
		border-radius: 0 0 var(--r-lg) var(--r-lg);
		background: var(--card);
		color: var(--muted);
		font: 600 var(--fs-md)/1.1 var(--f-body);
	}
	.st:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.st.done {
		border-top-color: var(--ok);
		color: var(--ink);
	}
	.st.now {
		border-top-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}
	.no {
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--line);
		color: var(--ink);
		font-size: var(--fs-sm);
	}
	.st.done .no {
		background: var(--ok-soft);
		color: var(--ok);
	}
	.st.now .no {
		background: var(--accent);
		color: var(--card);
	}
	.colorbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
		flex-wrap: wrap;
	}
	.colorbar h2 {
		font-size: var(--fs-xl);
	}
	.designs {
		display: flex;
		gap: 8px;
		align-items: center;
		flex: 1 1 280px;
		justify-content: flex-end;
		min-width: 0;
	}
	.designs select {
		flex: 1 1 200px;
		min-width: 0;
		max-width: 360px;
		min-height: 40px;
	}
	.designs .btn {
		min-height: 40px;
	}
	.strip {
		display: inline-flex;
		gap: 4px;
	}
	.intro h2,
	.intro p {
		margin: 0;
	}
	.nav {
		display: flex;
		gap: 10px;
		position: sticky;
		bottom: 0;
		z-index: 30;
		margin: 0 -16px;
		padding: 10px 16px;
		background: var(--paper);
		border-top: 1px solid var(--line);
	}
	.sp {
		flex: 1;
	}
	.blocker {
		margin: 0;
	}
	.nav .btn {
		min-width: 120px;
		min-height: 44px;
	}
	.done {
		justify-items: start;
	}
	.done p {
		margin: 0;
	}
	/* The swatch picker (z-index 1500) sits above the bar; on phones it is a bottom sheet, so the
	   bar steps aside while it is open. Toasts rise above the bar. */
	@media (max-width: 899px) {
		.wizard:has(:global([data-testid='swatch-picker'])) .nav {
			display: none;
		}
	}
	:global(body:has([data-testid='setup-wizard']) .toasts) {
		bottom: 84px;
	}
	@media (max-width: 520px) {
		.lb {
			display: none;
		}
		.st.now .lb {
			display: inline;
		}
		.steps {
			grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
		}
		.st.now {
			grid-column: auto;
		}
	}
</style>
