<script lang="ts">
	import {
		addPrinter,
		discoverPrinters,
		testPrinter,
		updatePrinter,
		type DiscoveredPrinterDto
	} from '#lib/client/api.ts';
	import { printerBrands } from '#lib/printers/catalog.ts';
	import {
		PRINTER_KIND_INFO,
		PRINTER_KINDS,
		type PrinterKind,
		type PrinterPublic,
		type PrinterStatus
	} from '#lib/printers/status.ts';
	import PrinterCard from './PrinterCard.svelte';

	/** Add or edit a printer. Secret fields are write-only: blank keeps the stored value. */
	let {
		org,
		printer = null,
		ondone,
		oncancel
	}: {
		org: string;
		printer?: PrinterPublic | null;
		ondone: () => void;
		oncancel: () => void;
	} = $props();

	const brands = printerBrands();
	const init = () => ({
		name: printer?.name ?? '',
		kind: (printer?.kind ?? 'elegoo-sdcp') as PrinterKind,
		host: printer?.host ?? '',
		port: printer?.port ?? null,
		catalogId: printer?.catalogId ?? '',
		enabled: printer?.enabled ?? true
	});
	let f = $state(init());
	let secrets = $state<Record<string, string>>({});
	$effect(() => {
		// reset typed secrets when switching kind
		void f.kind;
		secrets = {};
	});
	const info = $derived(PRINTER_KIND_INFO[f.kind]);

	let busy = $state(false);
	let error = $state('');
	let testing = $state(false);
	let test = $state<{ connected: boolean; status: PrinterStatus | null; message?: string } | null>(
		null
	);
	let discovering = $state(false);
	let found = $state<DiscoveredPrinterDto[] | null>(null);

	function payload() {
		const s: Record<string, string> = {};
		for (const fld of info.secrets) {
			const typed = secrets[fld.key];
			if (typed !== undefined && (typed !== '' || !fld.secret)) s[fld.key] = typed;
		}
		return {
			name: f.name,
			kind: f.kind,
			host: f.host,
			port: f.port,
			catalogId: f.catalogId || null,
			enabled: f.enabled,
			secrets: s
		};
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			if (printer) await updatePrinter(printer.id, payload());
			else await addPrinter(org, payload());
			ondone();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not save';
		} finally {
			busy = false;
		}
	}

	async function runTest() {
		testing = true;
		test = null;
		error = '';
		try {
			test = await testPrinter(org, { ...payload(), id: printer?.id });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Test failed';
		} finally {
			testing = false;
		}
	}

	async function discover() {
		discovering = true;
		found = null;
		try {
			found = (await discoverPrinters(org)).found;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Search failed';
		} finally {
			discovering = false;
		}
	}
	function pick(d: DiscoveredPrinterDto) {
		f.host = d.host;
		f.kind = 'elegoo-sdcp';
		if (!f.name) f.name = d.name || d.machineName || 'Elegoo printer';
		secrets = { ...secrets, mainboardId: d.mainboardId };
		found = null;
	}
</script>

<form class="card pf" onsubmit={save} data-testid="printer-form">
	<h3>{printer ? `Edit ${printer.name}` : 'Add a printer'}</h3>
	<div class="form-grid">
		<label class="field"
			>Name <input bind:value={f.name} required maxlength="80" placeholder="Shop Centauri" /></label
		>
		<label class="field"
			>Type
			<select bind:value={f.kind} disabled={!!printer} data-testid="pf-kind">
				{#each PRINTER_KINDS as k (k)}<option value={k}>{PRINTER_KIND_INFO[k].label}</option>{/each}
			</select>
		</label>
		<label class="field"
			>Address <input
				bind:value={f.host}
				required
				placeholder="192.168.0.50"
				autocapitalize="none"
				autocomplete="off"
				data-testid="pf-host"
			/></label
		>
		<label class="field"
			>Port
			<input
				type="number"
				min="1"
				max="65535"
				inputmode="numeric"
				value={f.port ?? ''}
				placeholder={String(info.defaultPort)}
				data-testid="pf-port"
				oninput={(e) => (f.port = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
			/></label
		>
		{#each info.secrets as fld (fld.key)}
			<label class="field"
				>{fld.label}
				<input
					type={fld.secret ? 'password' : 'text'}
					autocomplete="off"
					autocapitalize="none"
					value={secrets[fld.key] ?? (fld.secret ? '' : (printer?.identifiers[fld.key] ?? ''))}
					placeholder={fld.secret && printer?.secretsSet.includes(fld.key)
						? 'Saved (leave blank to keep)'
						: ''}
					data-testid="pf-{fld.key}"
					oninput={(e) => (secrets[fld.key] = e.currentTarget.value)}
				/>
				{#if fld.hint}<small>{fld.hint}</small>{/if}
			</label>
		{/each}
		<label class="field"
			>Model (optional)
			<select bind:value={f.catalogId}>
				<option value="">Not set</option>
				{#each brands as b (b.brand)}
					<optgroup label={b.brand}>
						{#each b.printers as p (p.id)}<option value={p.id}>{p.model}</option>{/each}
					</optgroup>
				{/each}
			</select>
		</label>
	</div>
	<p class="muted hint">{info.hint}</p>

	{#if f.kind === 'elegoo-sdcp'}
		<div class="disc">
			<button
				class="btn sm"
				type="button"
				onclick={discover}
				disabled={discovering}
				data-testid="pf-discover"
				>{discovering ? 'Searching…' : 'Find Elegoo printers on the network'}</button
			>
			{#if found}
				{#if found.length}
					<ul class="found">
						{#each found as d (d.mainboardId || d.host)}
							<li>
								<span><b>{d.name || d.machineName}</b> <span class="muted">{d.host}</span></span>
								<button class="btn sm" type="button" onclick={() => pick(d)}>Use this</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted">
						Nothing answered. The search is a UDP broadcast, so it only reaches printers on the same
						network segment as this server (run the container with host networking, or on br0). Type
						the printer's address instead; its IP is on the printer's network screen.
					</p>
				{/if}
			{/if}
		</div>
	{/if}

	<label class="chk"
		><input type="checkbox" bind:checked={f.enabled} /> Connected (uncheck to pause)</label
	>

	{#if error}<div class="error" role="alert">{error}</div>{/if}
	{#if test}
		<div class="testbox" data-testid="test-result">
			<b class={test.connected ? 'ok' : 'bad'}
				>{test.connected ? 'Connected' : 'Could not connect'}</b
			>
			{#if test.message}<span class="muted"> {test.message}</span>{/if}
			{#if test.status && test.connected}
				<PrinterCard
					printer={{
						name: f.name || 'Printer',
						kind: f.kind,
						enabled: true,
						lastSeenAt: null,
						status: test.status
					}}
				/>
			{/if}
		</div>
	{/if}

	<div class="actions">
		<button class="btn primary" disabled={busy} data-testid="pf-save"
			>{printer ? 'Save' : 'Add printer'}</button
		>
		<button
			class="btn"
			type="button"
			onclick={runTest}
			disabled={testing || !f.host}
			data-testid="pf-test">{testing ? 'Testing…' : 'Test connection'}</button
		>
		<button class="btn" type="button" onclick={oncancel}>Cancel</button>
	</div>
</form>

<style>
	.pf small {
		color: var(--muted);
		font-size: 12px;
	}
	.hint {
		margin: 0;
		font-size: 13px;
	}
	.disc {
		display: grid;
		gap: 8px;
	}
	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.found li {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: center;
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 6px 10px;
	}
	.chk {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 14px;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.testbox {
		display: grid;
		gap: 8px;
	}
	.ok {
		color: var(--ok);
	}
	.bad {
		color: var(--bad);
	}
	.error {
		white-space: normal;
	}
</style>
