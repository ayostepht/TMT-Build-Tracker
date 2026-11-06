<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { chooseTemplate, getKitStatus } from '#lib/client/api.ts';
	import { kitReadiness, type KitStatusDto } from '#lib/domain/kit-import.ts';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import KitCredit from '#lib/components/kit/KitCredit.svelte';
	import KitFilesImport from '#lib/components/kit/KitFilesImport.svelte';

	/**
	 * Setup step 1, "Choose build template": the built-in MakeGood kit, or the user's own files
	 * (a workspace-owned copy of the kit that the drop zone imports into).
	 */
	let {
		baseTemplateId,
		onSlicedFile
	}: {
		baseTemplateId: string;
		/** Takes a sliced project the drop zone found (the wizard moves on to the Files step with it). */
		onSlicedFile?: (file: File) => void;
	} = $props();
	const ctx = getBuildCtx();

	const owned = $derived(ctx.view.build.templateOwned);
	const ownId = $derived(owned ? ctx.view.build.templateId : '');

	let base = $state<{ status: KitStatusDto; canImport: boolean } | null>(null);
	let own = $state<{ status: KitStatusDto; canImport: boolean } | null>(null);
	let error = $state('');
	let busy = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function loadBase() {
		try {
			base = await getKitStatus(baseTemplateId);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load the kit status';
		}
		clearTimeout(timer);
		// The bundled files install in the background after start-up: follow along until done.
		if (base?.status.installing) timer = setTimeout(loadBase, 3000);
	}
	async function loadOwn() {
		if (!ownId) {
			own = null;
			return;
		}
		try {
			own = await getKitStatus(ownId);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load the status of your files';
		}
	}
	onMount(loadBase);
	onDestroy(() => clearTimeout(timer));
	$effect(() => {
		void ownId;
		void loadOwn();
	});

	const baseReady = $derived(base ? kitReadiness(base.status) : null);
	const baseState = $derived(baseReady?.state ?? null);
	const label = $derived({
		ready: 'Ready',
		installing: base?.status.installMessage || 'Installing MakeGood files…',
		partial: 'Partly installed',
		missing: 'Not installed'
	});

	async function pick(wantOwn: boolean) {
		if (wantOwn === owned || busy || !ctx.canEdit) return;
		busy = true;
		error = '';
		try {
			await chooseTemplate(ctx.id, wantOwn);
			await ctx.refresh();
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not switch the template';
		} finally {
			busy = false;
		}
	}
</script>

<section class="card tpl" aria-labelledby="tpl-h" data-testid="template-step">
	<h2 id="tpl-h">Choose build template</h2>
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="opt" class:sel={!owned}>
		<label class="head">
			<input
				type="radio"
				name="template"
				value="makegood"
				checked={!owned}
				disabled={busy || !ctx.canEdit}
				data-testid="tpl-makegood"
				onchange={() => pick(false)}
			/>
			<span class="t">
				<strong>MakeGood 3D TMT</strong>
				<span class="sub">The standard kit, built in</span>
			</span>
			{#if baseState}
				<span class="chip {baseState}" data-testid="makegood-status" data-state={baseState}
					>{label[baseState]}</span
				>
			{/if}
		</label>
		{#if !owned}
			<div class="body">
				{#if baseState === 'ready'}
					<p class="muted">The 3D chair, plate layouts and print settings are installed.</p>
				{:else if baseState === 'installing'}
					<p class="muted" role="status">
						The files install in the background. You can carry on; they show up when ready.
					</p>
				{:else if base}
					<p class="muted" data-testid="makegood-missing">
						{baseState === 'partial'
							? `Some of the MakeGood files are missing. ${baseReady?.note ?? ''}`
							: 'The MakeGood files are not installed yet.'}
						You can carry on: plates use rough part sizes and there is no 3D preview until they are added.
					</p>
					{#key base.canImport}
						<KitFilesImport
							templateId={baseTemplateId}
							canImport={base.canImport}
							compact
							{onSlicedFile}
							onchange={loadBase}
						/>
					{/key}
				{/if}
				<KitCredit />
			</div>
		{/if}
	</div>

	<div class="opt" class:sel={owned}>
		<label class="head">
			<input
				type="radio"
				name="template"
				value="own"
				checked={owned}
				disabled={busy || !ctx.canEdit}
				data-testid="tpl-own"
				onchange={() => pick(true)}
			/>
			<span class="t">
				<strong>Upload your own files</strong>
				<span class="sub">For a remixed chair</span>
			</span>
		</label>
		<ul class="files" aria-label="What each file is for">
			<li><b>3MF:</b> plates, painted supports and slicer export (required)</li>
			<li><b>STEP:</b> 3D preview in the designer (optional)</li>
			<li><b>PDF:</b> assembly guide pictures (optional)</li>
		</ul>
		{#if owned && own}
			<div class="body" data-testid="own-files">
				<p class="muted">
					{own.status.print.withGeometry > 0
						? `${own.status.print.withGeometry} of ${own.status.print.total} parts have your print files.`
						: 'No files yet. Without a 3MF, plates use rough part sizes.'}
					{own.status.model ? ' 3D preview added.' : ''}
				</p>
				<KitFilesImport
					templateId={ownId}
					canImport={own.canImport}
					compact
					{onSlicedFile}
					onchange={() => {
						void loadOwn();
						void ctx.refresh();
					}}
				/>
			</div>
		{/if}
	</div>
</section>

<style>
	.opt {
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 12px;
		display: grid;
		gap: 10px;
		background: var(--paper);
	}
	.opt.sel {
		border-color: var(--accent);
		background: var(--card);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		min-height: 44px;
	}
	.head input {
		width: 20px;
		height: 20px;
		flex: none;
	}
	.t {
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.sub {
		font-size: 13px;
		color: var(--muted);
	}
	.chip {
		margin-left: auto;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--line);
		color: var(--muted);
		white-space: nowrap;
	}
	.chip.ready {
		background: var(--ok-soft);
		color: var(--ok);
	}
	.chip.installing,
	.chip.partial {
		background: var(--warn-soft);
		color: var(--warn);
	}
	.chip.missing {
		background: var(--bad-soft);
		color: var(--bad);
	}
	.body {
		display: grid;
		gap: 10px;
		padding-left: 30px;
	}
	.body p {
		margin: 0;
	}
	.files {
		margin: 0;
		padding-left: 50px;
		display: grid;
		gap: 4px;
		font-size: 14px;
	}
	@media (max-width: 520px) {
		.body {
			padding-left: 0;
		}
		.files {
			padding-left: 30px;
		}
		.head {
			flex-wrap: wrap;
		}
		.chip {
			margin-left: 30px;
		}
	}
</style>
