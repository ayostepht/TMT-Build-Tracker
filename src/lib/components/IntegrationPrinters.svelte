<script lang="ts">
	import { removePrinter, updatePrinter } from '#lib/client/api.ts';
	import { createAsk } from '#lib/client/ask.svelte.ts';
	import type { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import type { ConnectionOptionView } from '#lib/printers/connection-options.ts';
	import {
		chooserGroups,
		connectionLabel,
		hostedLabel,
		optionForPrinter,
		type ChooserEntry
	} from '#lib/printers/integrations-view.ts';
	import type { PrinterPublic } from '#lib/printers/status.ts';
	import AskDialog from './AskDialog.svelte';
	import PrinterForm from './PrinterForm.svelte';

	/**
	 * Integrations, "Printers": the workspace's printers as compact rows, and the one place a
	 * printer is added or edited. "Add a printer" opens a chooser rendered from the options the
	 * server sends (`options`, from GET /api/printers/options); choosing a card shows that option's
	 * form with its setup steps. Permissions are the server's: editors manage, viewers only read.
	 */
	let {
		orgId,
		store,
		options,
		canEdit
	}: {
		orgId: string;
		store: PrinterStore;
		options: ConnectionOptionView[];
		canEdit: boolean;
	} = $props();

	const asking = createAsk();
	type Mode =
		| { m: 'list' }
		| { m: 'choose' }
		| { m: 'add'; entry: ChooserEntry; key: string }
		| { m: 'edit'; printer: PrinterPublic; option: ConnectionOptionView };
	let mode = $state<Mode>({ m: 'list' });
	let error = $state('');
	let busy = $state<string | null>(null);

	const groups = $derived(chooserGroups(options));

	function choose(entry: ChooserEntry) {
		if (!entry.available) return;
		const first = entry.options.find((o) => o.available) ?? entry.options[0];
		mode = { m: 'add', entry, key: first.key };
	}
	const typeChoices = (entry: ChooserEntry) =>
		entry.options.length > 1
			? entry.options
					.filter((o) => o.available)
					.map((o) => ({ key: o.key, label: o.linkPrinterType ?? o.label }))
			: [];
	function setType(key: string) {
		if (mode.m === 'add') mode = { ...mode, key };
	}
	function edit(p: PrinterPublic) {
		const option = optionForPrinter(options, p);
		if (option) mode = { m: 'edit', printer: p, option };
	}
	async function done() {
		mode = { m: 'list' };
		await store.load();
	}
	async function toggle(p: PrinterPublic) {
		busy = p.id;
		error = '';
		try {
			await updatePrinter(p.id, { enabled: !p.enabled });
			await store.load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed';
		} finally {
			busy = null;
		}
	}
	async function remove(p: PrinterPublic) {
		if (
			!(await asking.ask(
				`Remove ${p.name}? Its saved connection details and print history on this page are deleted. A print that is running on it is not affected.`,
				{ title: 'Remove printer?', confirmLabel: 'Remove', danger: true }
			))
		)
			return;
		error = '';
		try {
			await removePrinter(p.id);
			await store.load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed';
		}
	}
</script>

<section class="ig-sec" data-testid="integrations-printers" aria-labelledby="ig-printers-h">
	<div class="ig-head">
		<h2 id="ig-printers-h">Printers</h2>
		{#if canEdit && mode.m === 'list'}
			<button
				class="btn primary"
				type="button"
				data-testid="add-printer"
				onclick={() => (mode = { m: 'choose' })}>Add a printer</button
			>
		{/if}
	</div>
	<p class="muted ig-lead">
		Connect a printer to see its live progress next to your builds, or add one that is not connected
		to note which printer a print used. Status is read-only: this app never starts, stops or moves a
		printer.
	</p>
	{#if error}<div class="error ig-err" role="alert">{error}</div>{/if}
	{#if store.error}<div class="error ig-err" role="alert">{store.error}</div>{/if}

	{#if mode.m === 'choose'}
		<div class="card ig-choose" data-testid="printer-chooser">
			<div class="ig-head">
				<h3>What kind of printer?</h3>
				<button class="btn ghost" type="button" onclick={() => (mode = { m: 'list' })}
					>Cancel</button
				>
			</div>
			{#each groups as g (g.id)}
				<section class="ig-group" aria-labelledby="ig-g-{g.id}">
					<h4 id="ig-g-{g.id}">{g.title}</h4>
					<div class="ig-cards">
						{#each g.entries as e (e.id)}
							<button
								class="ig-card"
								type="button"
								disabled={!e.available}
								data-testid="option-{e.id}"
								onclick={() => choose(e)}
							>
								<b>{e.title}</b>
								<span class="ig-desc">{e.description}</span>
								<span class="ig-tags">
									<span class="ig-tag" data-testid="hosted-label">{hostedLabel(e.hosted)}</span>
									{#if e.verifiedLabel}<span class="ig-tag" data-testid="verified-label"
											>{e.verifiedLabel}</span
										>{/if}
								</span>
								{#if !e.available && e.unavailableReason}
									<span class="ig-why" data-testid="option-unavailable">{e.unavailableReason}</span>
								{/if}
							</button>
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{:else if mode.m === 'add'}
		{@const cur = mode.entry.options.find((o) => o.key === (mode as { key: string }).key)}
		{#key cur?.key}
			<PrinterForm
				org={orgId}
				option={cur}
				typeChoices={typeChoices(mode.entry)}
				ontype={setType}
				ondone={done}
				oncancel={() => (mode = { m: 'choose' })}
			/>
		{/key}
	{:else if mode.m === 'edit'}
		<PrinterForm
			org={orgId}
			printer={mode.printer}
			option={mode.option}
			ondone={done}
			oncancel={() => (mode = { m: 'list' })}
		/>
	{/if}

	{#if mode.m === 'list' || mode.m === 'choose'}
		<ul class="ig-rows" data-testid="printer-rows">
			{#each store.printers as p (p.id)}
				<li class="ig-row" data-testid="printer-row">
					<div class="ig-who">
						<b>{p.name}</b>
						<span class="muted ig-meta"
							><span data-testid="row-connection">{connectionLabel(p)}</span> ·
							<span data-testid="row-state"
								>{p.connection === 'manual'
									? 'Logged by hand'
									: p.enabled
										? 'Monitoring'
										: 'Monitoring stopped'}</span
							></span
						>
					</div>
					{#if canEdit}
						<div class="ig-acts">
							<button
								class="btn sm"
								type="button"
								data-testid="edit-printer"
								onclick={() => edit(p)}>Edit</button
							>
							{#if p.connection !== 'manual'}
								<button
									class="btn sm"
									type="button"
									disabled={busy === p.id}
									data-testid="toggle-printer"
									onclick={() => toggle(p)}
									>{p.enabled ? 'Stop monitoring' : 'Resume monitoring'}</button
								>
							{/if}
							<button
								class="btn sm danger"
								type="button"
								data-testid="remove-printer"
								onclick={() => remove(p)}>Remove…</button
							>
						</div>
					{/if}
				</li>
			{:else}
				{#if store.loaded}
					<li class="ig-none muted" data-testid="printers-none">
						No printers yet.{canEdit
							? ' Use “Add a printer” to set one up.'
							: ' Ask a chapter owner or editor to add one.'}
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</section>
<AskDialog ask={asking} />

<style>
	.ig-sec {
		display: grid;
		gap: var(--sp-5);
		align-content: start;
	}
	.ig-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
	}
	.ig-head h2,
	.ig-head h3 {
		margin: 0;
	}
	.ig-lead {
		margin: 0;
	}
	.ig-err {
		white-space: normal;
	}
	.ig-choose {
		display: grid;
		gap: var(--sp-6);
	}
	.ig-group h4 {
		margin: 0 0 var(--sp-4);
		font-size: var(--fs-md);
	}
	.ig-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
		gap: var(--sp-5);
	}
	.ig-card {
		display: grid;
		gap: var(--sp-3);
		align-content: start;
		text-align: left;
		font: inherit;
		color: var(--ink);
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-5) var(--sp-6);
		cursor: pointer;
		min-width: 0;
		min-height: 44px;
	}
	.ig-card:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.ig-card:disabled {
		cursor: not-allowed;
		opacity: 0.7;
	}
	.ig-desc {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.ig-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2);
	}
	.ig-tag {
		font-size: var(--fs-xs);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		padding: 1px var(--sp-4);
		color: var(--muted);
	}
	.ig-why {
		font-size: var(--fs-sm);
		color: var(--bad);
	}
	.ig-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
	}
	.ig-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--card);
		padding: var(--sp-4) var(--sp-6);
	}
	.ig-who {
		display: grid;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.ig-meta {
		font-size: var(--fs-sm);
	}
	.ig-acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}
	.ig-none {
		padding: var(--sp-4) 0;
	}
	@media (pointer: coarse) {
		.ig-acts .btn {
			min-height: 44px;
		}
	}
</style>
