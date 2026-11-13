<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { jobAction } from '#lib/client/api.ts';
	import { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import PrinterCard from '#lib/components/PrinterCard.svelte';
	import UnloggedNotice from '#lib/components/UnloggedNotice.svelte';
	import PrinterJobLink from '#lib/components/PrinterJobLink.svelte';
	import { splitTeamJobs, type PrinterJobView } from '#lib/printers/status.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const store = new PrinterStore(untrack(() => data.team.id));
	$effect(() => store.acquire());

	const integrationsHref = $derived(
		resolve('/(app)/teams/[slug]/integrations', { slug: data.team.slug })
	);
	async function unlink(id: string) {
		await jobAction(id, { action: 'unlink' }).catch(() => {});
		await store.load();
	}
	const split = $derived(splitTeamJobs(store.jobs));
	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
</script>

<svelte:head><title>Printers · {data.team.name}</title></svelte:head>

<section class="pr-page">
	<div class="pr-head">
		<h2>Printers</h2>
		{#if data.canEdit && store.printers.length}
			<a class="btn" href={integrationsHref} data-testid="printers-manage">Add or manage printers</a
			>
		{/if}
	</div>
	<p class="muted">
		Live progress of the printers your chapter prints on, and the prints they ran. Status is
		read-only: this app never starts, stops or moves a printer. Printers are set up on the
		Integrations page.
	</p>
	{#if store.error}<div class="error" role="alert">{store.error}</div>{/if}

	{#if store.loaded && !store.printers.length}
		<div class="card pr-empty" data-testid="printers-empty">
			<p>
				<b>No printers yet.</b> Add one on the Integrations page to see its status here, or add a printer
				that is not connected to note which printer a print used.
			</p>
			{#if data.canEdit}
				<a class="btn primary" href={integrationsHref} data-testid="printers-manage"
					>Add or manage printers</a
				>
			{:else}
				<p class="muted">Ask a chapter owner or editor to add printers.</p>
			{/if}
		</div>
	{/if}

	<div class="grid" data-testid="printer-list">
		{#each store.printers as p (p.id)}
			<PrinterCard printer={p} manageHref={data.canEdit ? integrationsHref : undefined} />
		{/each}
	</div>

	{#snippet jobRow(j: PrinterJobView, older: boolean)}
		<li class="ds-card ds-card--compact jobrow">
			<div>
				<b>{j.fileName || 'Unnamed print'}</b>
				<div class="muted small">
					{j.printerName} · {j.status}{j.progress != null ? ` · ${Math.round(j.progress)}%` : ''} · {when(
						j.startedAt
					)}
				</div>
				<div class="small">
					{#if j.buildId && j.plateNumber != null}
						<a class="pill-link" href={resolve('/(app)/builds/[id]', { id: j.buildId })}
							>Plate {j.plateNumber}</a
						>
						{#if j.runId && j.runId !== 'dismissed'}<span class="muted">
								· logged</span
							>{:else if j.pendingConfirm}<span class="muted">
								· waiting for your print log</span
							>{/if}
						{#if data.canEdit && (j.status === 'printing' || j.status === 'paused')}
							<UnloggedNotice
								jobs={store.jobs}
								buildId={j.buildId}
								plateNumber={j.plateNumber}
								partSlugs={j.partSlugs}
								exceptJobId={j.id}
								testid="linked-unlogged"
								linked
							/>
							<button class="btn ghost sm" type="button" onclick={() => unlink(j.id)}>Unlink</button
							>
						{/if}
					{:else}
						<span class="muted">Not linked to a plate</span>
						{#if data.canEdit && (older || j.status === 'printing' || j.status === 'paused')}
							<PrinterJobLink
								job={j}
								builds={store.builds}
								exp={store.expected.find((e) => e.jobId === j.id)}
								jobs={store.jobs}
								onlinked={() => store.load()}
							/>
						{/if}
					{/if}
				</div>
			</div>
		</li>
	{/snippet}

	{#if split.shown.length || split.other.length}
		<h2>Recent prints</h2>
		{#if split.shown.length}
			<ul class="tpl-list" data-testid="job-list">
				{#each split.shown as j (j.id)}
					{@render jobRow(j, false)}
				{/each}
			</ul>
		{:else}
			<p class="muted">No prints linked to a plate yet.</p>
		{/if}
		{#if split.other.length}
			<details class="pr-other" data-testid="other-jobs">
				<summary>Other prints on this printer ({split.other.length})</summary>
				<ul class="tpl-list" data-testid="other-job-list">
					{#each split.other as j (j.id)}
						{@render jobRow(j, true)}
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</section>

<style>
	/* The page's vertical rhythm: sections and the printer list never touch. */
	.pr-page {
		display: grid;
		gap: var(--sp-8);
		align-content: start;
	}
	.pr-page > h2:not(:first-child) {
		margin-top: var(--sp-6);
	}
	.pr-page > p {
		margin: 0;
	}
	.pr-other summary {
		cursor: pointer;
		color: var(--muted);
		font-size: var(--fs-sm);
		padding: var(--sp-3) 0;
	}
	.pr-other ul {
		margin-top: var(--sp-4);
	}
	.pr-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
	}
	.pr-head h2 {
		margin: 0;
	}
	.pr-empty {
		display: grid;
		gap: var(--sp-4);
		justify-items: start;
	}
	.pr-empty p {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
		gap: var(--sp-6);
	}
	.small {
		font-size: var(--fs-sm);
	}
	.error {
		white-space: normal;
	}
</style>
