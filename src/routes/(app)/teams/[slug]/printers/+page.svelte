<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { jobAction, removePrinter, updatePrinter } from '#lib/client/api.ts';
	import { focusIn } from '#lib/client/focus.ts';
	import { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import PrinterCard from '#lib/components/PrinterCard.svelte';
	import PrinterJobLink from '#lib/components/PrinterJobLink.svelte';
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
	/** Cancel the inline "Remove for good" confirm and put focus back on the button that opened it. */
	async function cancelRemove(id: string) {
		confirmRemove = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-remove-printer="${id}"]`)?.focus();
	}
	function escCancel(e: KeyboardEvent, id: string) {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		void cancelRemove(id);
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

<section class="pr-page">
	<h2>Printers</h2>
	{#if data.printersAvailable}
		<p class="muted">
			Connect the printers your chapter prints on to see live progress next to each plate, and to
			log finished prints without typing. Status is read-only: this app never starts, stops or moves
			a printer.
		</p>
	{:else}
		<div class="card pr-unavailable" data-testid="printers-unavailable">
			<p>
				<b>Printer status is not available on this hosted site yet.</b>
			</p>
			<p class="muted">
				Logging prints by hand works everywhere: open a build and log a plate when it finishes.
				Connecting printers will come later; until then this site never contacts a printer.
			</p>
		</div>
	{/if}
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
							{#if data.printersAvailable}
								<button class="btn sm" type="button" onclick={() => (editing = p)}>Edit</button>
								<button class="btn sm" type="button" onclick={() => toggle(p)}
									>{p.enabled ? 'Stop monitoring' : 'Resume monitoring'}</button
								>
							{/if}
							{#if confirmRemove === p.id}
								<span
									class="pr-confirm"
									role="group"
									aria-label="Remove {p.name}?"
									use:focusIn={'button'}
								>
									<button
										class="btn sm"
										type="button"
										onkeydown={(e) => escCancel(e, p.id)}
										onclick={() => cancelRemove(p.id)}>Cancel</button
									>
									<button
										class="btn sm danger solid"
										type="button"
										onkeydown={(e) => escCancel(e, p.id)}
										onclick={() => remove(p)}>Remove for good</button
									>
								</span>
							{:else}
								<button
									class="btn sm danger"
									type="button"
									data-remove-printer={p.id}
									onclick={() => (confirmRemove = p.id)}>Remove…</button
								>
							{/if}
						{/if}
					{/snippet}
				</PrinterCard>
			{/if}
		{:else}
			{#if store.loaded && data.printersAvailable}<p class="muted">No printers yet.</p>{/if}
		{/each}
	</div>

	{#if !data.printersAvailable}
		<!-- hosted site: no form that would always fail -->
	{:else if data.canEdit}
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
				<li class="ds-card ds-card--compact jobrow">
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
								{#if data.canEdit && (j.status === 'printing' || j.status === 'paused')}
									<PrinterJobLink
										job={j}
										builds={store.builds}
										exp={store.expected.find((e) => e.jobId === j.id)}
										onlinked={() => store.load()}
									/>
								{/if}
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
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
	.pr-confirm {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-4);
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
	.pr-unavailable p {
		margin: 0 0 var(--sp-3);
	}
	.pr-unavailable p:last-child {
		margin-bottom: 0;
	}
</style>
