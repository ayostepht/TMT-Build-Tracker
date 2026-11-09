<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { jobAction, removePrinter, updatePrinter } from '#lib/client/api.ts';
	import { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import PrinterCard from '#lib/components/PrinterCard.svelte';
	import PrinterForm from '#lib/components/PrinterForm.svelte';
	import type { PrinterPublic } from '#lib/printers/status.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const store = new PrinterStore(untrack(() => data.team.id));
	$effect(() => store.acquire());

	let adding = $state(false);
	let editing = $state<PrinterPublic | null>(null);
	let confirmRemove = $state<string | null>(null);
	let error = $state('');

	async function toggle(p: PrinterPublic) {
		try {
			await updatePrinter(p.id, { enabled: !p.enabled });
			await store.load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed';
		}
	}
	async function remove(p: PrinterPublic) {
		try {
			await removePrinter(p.id);
			confirmRemove = null;
			await store.load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed';
		}
	}
	async function unlink(id: string) {
		await jobAction(id, { action: 'unlink' }).catch(() => {});
		await store.load();
	}
	const done = () => {
		adding = false;
		editing = null;
		void store.load();
	};
	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
</script>

<svelte:head><title>Printers · {data.team.name}</title></svelte:head>

<section class="stack">
	<h2>Printers</h2>
	<p class="muted">
		Connect the printers your chapter prints on to see live progress next to each plate, and to log
		finished prints without typing. Status is read-only: this app never starts, stops or moves a
		printer.
	</p>
	{#if error}<div class="error" role="alert">{error}</div>{/if}
	{#if store.error}<div class="error" role="alert">{store.error}</div>{/if}

	<div class="grid" data-testid="printer-list">
		{#each store.printers as p (p.id)}
			{#if editing?.id === p.id}
				<PrinterForm
					org={data.team.id}
					printer={p}
					ondone={done}
					oncancel={() => (editing = null)}
				/>
			{:else}
				<PrinterCard printer={p}>
					{#snippet actions()}
						{#if data.canEdit}
							<button class="btn sm" type="button" onclick={() => (editing = p)}>Edit</button>
							<button class="btn sm" type="button" onclick={() => toggle(p)}
								>{p.enabled ? 'Pause' : 'Resume'}</button
							>
							{#if confirmRemove === p.id}
								<button class="btn sm danger solid" type="button" onclick={() => remove(p)}
									>Remove for good</button
								>
								<button class="btn sm" type="button" onclick={() => (confirmRemove = null)}
									>Keep</button
								>
							{:else}
								<button class="btn sm danger" type="button" onclick={() => (confirmRemove = p.id)}
									>Remove…</button
								>
							{/if}
						{/if}
					{/snippet}
				</PrinterCard>
			{/if}
		{:else}
			{#if store.loaded}<p class="muted">No printers yet.</p>{/if}
		{/each}
	</div>

	{#if data.canEdit}
		{#if adding}
			<PrinterForm org={data.team.id} ondone={done} oncancel={() => (adding = false)} />
		{:else}
			<div>
				<button
					class="btn primary"
					type="button"
					onclick={() => (adding = true)}
					data-testid="add-printer">Add a printer</button
				>
			</div>
		{/if}
	{:else}
		<p class="muted">Ask a chapter owner or editor to add printers.</p>
	{/if}

	{#if store.jobs.length}
		<h2>Recent prints</h2>
		<ul class="tpl-list" data-testid="job-list">
			{#each store.jobs as j (j.id)}
				<li class="tpl jobrow">
					<div>
						<b>{j.fileName || 'Unnamed print'}</b>
						<div class="muted small">
							{j.printerName} · {j.status}{j.progress != null
								? ` · ${Math.round(j.progress)}%`
								: ''} · {when(j.startedAt)}
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
									<button class="btn ghost sm" type="button" onclick={() => unlink(j.id)}
										>Unlink</button
									>
								{/if}
							{:else}
								<span class="muted">Not linked to a plate</span>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
		gap: 12px;
	}
	.small {
		font-size: 13px;
	}
	.error {
		white-space: normal;
	}
</style>
