<script lang="ts">
	import { getView } from '#lib/client/api.ts';
	import type { PrinterExpectedView, PrinterJobView } from '#lib/printers/status.ts';
	import { BuildCtx } from './build-context.svelte.ts';
	import JobLinkControl from './JobLinkControl.svelte';

	/**
	 * "Link to a plate" for a running job on the Printers page. A plate the user sent to this
	 * printer ("Start on <printer>") is offered for confirmation; otherwise the user picks a build
	 * (only builds of this printer's chapter, editors only), then the plate, then the run.
	 */
	let {
		job,
		builds,
		exp,
		onlinked
	}: {
		job: PrinterJobView;
		builds: { id: string; name: string }[];
		exp?: PrinterExpectedView;
		onlinked: () => void | Promise<void>;
	} = $props();

	let buildId = $state('');
	let ctx = $state<BuildCtx | null>(null);
	let loading = $state(false);
	let err = $state('');

	async function open(id: string) {
		buildId = id;
		ctx = null;
		err = '';
		if (!id) return;
		loading = true;
		try {
			const v = await getView(id);
			if (buildId === id) ctx = new BuildCtx(v);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not load that build.';
		}
		loading = false;
	}

	// A pending suggestion names its build; one editable build needs no picker.
	$effect(() => {
		const id = exp?.buildId ?? (builds.length === 1 ? builds[0].id : '');
		if (id && id !== buildId) void open(id);
	});
</script>

<div class="pjl" data-testid="job-link">
	{#if !exp && builds.length > 1}
		<label class="sel"
			><span class="sr-only">Build</span>
			<select
				data-testid="link-build"
				value={buildId}
				disabled={loading}
				onchange={(e) => open(e.currentTarget.value)}
			>
				<option value="">Link to build…</option>
				{#each builds as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
			</select>
		</label>
	{:else if !exp && builds.length === 0}
		<span class="muted">No build to link to in this chapter.</span>
	{/if}
	{#if loading}<span class="muted">Loading…</span>{/if}
	{#if ctx}
		<JobLinkControl {job} {ctx} {exp} {onlinked} />
	{/if}
	{#if err}<div class="error" role="alert" style="white-space:normal">{err}</div>{/if}
</div>

<style>
	.pjl {
		display: grid;
		gap: var(--sp-4);
		margin-top: var(--sp-3);
		justify-items: start;
	}
	.sel select {
		padding: var(--sp-4);
		border: 1px solid var(--field-line);
		border-radius: var(--r-md);
		background: var(--paper);
		max-width: 100%;
	}
</style>
