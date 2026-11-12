<script lang="ts">
	import {
		addPrinter,
		discoverPrinters,
		testPrinter,
		testPrinterCamera,
		updatePrinter,
		type DiscoveredPrinterDto
	} from '#lib/client/api.ts';
	import { printerBrands } from '#lib/printers/catalog.ts';
	import { cameraSupported, defaultCameraUrl } from '#lib/printers/camera-url.ts';
	import type { ConnectionOptionView } from '#lib/printers/connection-options.ts';
	import { SETUP_TEXT, guideUrl } from '#lib/printers/setup-steps.ts';
	import { SHARE_LINK_HOST_PLACEHOLDER, supportsShareLink } from '#lib/printers/share-link.ts';
	import {
		PRINTER_KIND_INFO,
		PRINTER_KINDS,
		type PrinterKind,
		type PrinterPublic,
		type PrinterStatus
	} from '#lib/printers/status.ts';
	import PrinterCard from './PrinterCard.svelte';

	/**
	 * Add or edit a printer. Secret fields are write-only: blank keeps the stored value.
	 * With `option` (the Integrations page) the form is that one connection option: only its fields,
	 * its setup steps above them, no printer-type select. Without it (the plate picker's inline
	 * "New printer") it is the general form with a type select. `typeChoices` (OctoEverywhere only)
	 * adds a "Printer type" select that calls `ontype` with the chosen option's key.
	 */
	let {
		org,
		printer = null,
		option = null,
		typeChoices = [],
		ontype,
		ondone,
		oncancel
	}: {
		org: string;
		printer?: PrinterPublic | null;
		option?: ConnectionOptionView | null;
		typeChoices?: { key: string; label: string }[];
		ontype?: (key: string) => void;
		ondone: () => void;
		oncancel: () => void;
	} = $props();

	const brands = printerBrands();
	const init = () => ({
		name: printer?.name ?? '',
		kind: (printer?.kind ?? option?.kind ?? 'elegoo-sdcp') as PrinterKind,
		host: printer?.host === SHARE_LINK_HOST_PLACEHOLDER ? '' : (printer?.host ?? ''),
		port: printer?.port ?? null,
		catalogId: printer?.catalogId ?? '',
		enabled: printer?.enabled ?? true,
		cameraUrl: printer?.cameraUrl ?? '',
		cameraEnabled: printer?.cameraEnabled ?? true
	});
	let f = $state(init());
	let secrets = $state<Record<string, string>>({});
	$effect(() => {
		// reset typed secrets when switching kind
		void f.kind;
		secrets = {};
	});
	const info = $derived(PRINTER_KIND_INFO[f.kind]);
	/** "Remove link" pressed on a printer that has a saved OctoEverywhere link. */
	let removeLink = $state(false);
	const hasSavedLink = $derived(!!printer?.secretsSet.includes('shareLink'));
	/** Reached through an OctoEverywhere link (typed or saved): no address, port or camera address. */
	const viaLink = $derived(
		option
			? option.via === 'link'
			: supportsShareLink(f.kind) && (!!secrets.shareLink?.trim() || (hasSavedLink && !removeLink))
	);
	/** A printer that is never contacted: a name (and model) is all there is. */
	const isManual = $derived(f.kind === 'manual');
	const optField = (key: string) => option?.fields.find((x) => x.key === key);
	const fieldList = $derived(
		info.secrets.filter((x) => (option ? !!optField(x.key) : !(viaLink && x.key === 'mainboardId')))
	);
	const setup = $derived(option ? SETUP_TEXT[option.key] : null);
	const canTest = $derived(
		isManual ? false : viaLink ? !!secrets.shareLink?.trim() || hasSavedLink : !!f.host.trim()
	);
	// Saved secrets only work at the destination they were saved for (an address, or the link
	// itself): the server asks for them again when it changes. In link mode the link is the secret.
	const savedHost = $derived(
		printer?.host === SHARE_LINK_HOST_PLACEHOLDER ? '' : (printer?.host ?? '')
	);
	const moved = $derived(
		!!printer &&
			f.kind === printer.kind &&
			!viaLink &&
			(hasSavedLink ||
				f.host.trim().toLowerCase() !== savedHost.toLowerCase() ||
				(f.port ?? null) !== (printer.port ?? null))
	);
	const needRetype = (key: string) =>
		moved && key !== 'shareLink' && !!printer?.secretsSet.includes(key) && !secrets[key];

	let busy = $state(false);
	let error = $state('');
	let testing = $state(false);
	let test = $state<{ connected: boolean; status: PrinterStatus | null; message?: string } | null>(
		null
	);
	let camTesting = $state(false);
	let cam = $state<{ works: boolean; message?: string; image?: string } | null>(null);
	const camSupported = $derived(cameraSupported(f.kind));
	const camPlaceholder = $derived(
		f.kind === 'elegoo-sdcp'
			? (defaultCameraUrl(f.kind, f.host.trim() || 'printer-address') ?? '')
			: f.kind === 'moonraker'
				? 'Automatic: the webcam set up in Klipper'
				: 'Automatic: the webcam set in OctoPrint (needs an API key)'
	);
	let discovering = $state(false);
	let found = $state<DiscoveredPrinterDto[] | null>(null);

	function payload() {
		const s: Record<string, string> = {};
		for (const fld of info.secrets) {
			const typed = secrets[fld.key];
			if (typed !== undefined && (typed !== '' || !fld.secret)) s[fld.key] = typed;
		}
		if (removeLink && !s.shareLink) s.shareLink = '';
		if (isManual)
			return { name: f.name, kind: f.kind, catalogId: f.catalogId || null, enabled: true };
		return {
			name: f.name,
			kind: f.kind,
			host: f.host.trim() || (viaLink ? SHARE_LINK_HOST_PLACEHOLDER : ''),
			port: f.port,
			catalogId: f.catalogId || null,
			enabled: f.enabled,
			cameraUrl: cameraSupported(f.kind) && !viaLink ? f.cameraUrl.trim() || null : null,
			cameraEnabled: f.cameraEnabled,
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

	async function runCameraTest() {
		camTesting = true;
		cam = null;
		error = '';
		try {
			cam = await testPrinterCamera(org, { ...payload(), id: printer?.id });
		} catch (err) {
			cam = { works: false, message: err instanceof Error ? err.message : 'Camera test failed' };
		} finally {
			camTesting = false;
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

<!-- External guide links only (the repository on GitHub): nothing to resolve. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<form class="card pf" onsubmit={save} data-testid="printer-form">
	<h3>{printer ? `Edit ${printer.name}` : 'Add a printer'}</h3>
	{#if setup && option}
		{#if printer}
			<details class="pf-steps" data-testid="pf-steps">
				<summary>How this is set up</summary>
				<ol>
					{#each setup.steps as st (st)}<li>{st}</li>{/each}
				</ol>
				<a href={guideUrl(setup.anchor)} target="_blank" rel="noreferrer noopener">Full guide</a>
			</details>
		{:else}
			<div class="pf-steps" data-testid="pf-steps">
				<h4>How to set it up</h4>
				<ol>
					{#each setup.steps as st (st)}<li>{st}</li>{/each}
				</ol>
				<a
					class="pf-guide"
					href={guideUrl(setup.anchor)}
					target="_blank"
					rel="noreferrer noopener"
					data-testid="pf-guide">Full guide</a
				>
			</div>
		{/if}
	{/if}
	<div class="form-grid">
		<label class="field"
			>Name <input bind:value={f.name} required maxlength="80" placeholder="Shop Centauri" /></label
		>
		{#if typeChoices.length}
			<label class="field"
				>Printer type
				<select
					value={option?.key}
					disabled={!!printer}
					data-testid="pf-link-type"
					onchange={(e) => ontype?.(e.currentTarget.value)}
				>
					{#each typeChoices as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
				</select>
			</label>
		{:else if !option}
			<label class="field"
				>Type
				<select bind:value={f.kind} disabled={!!printer} data-testid="pf-kind">
					{#each PRINTER_KINDS as k (k)}<option value={k}>{PRINTER_KIND_INFO[k].label}</option
						>{/each}
				</select>
			</label>
		{/if}
		{#if !isManual && (option ? option.via === 'lan' : true)}
			<label class="field"
				>Address <input
					bind:value={f.host}
					required={!viaLink}
					placeholder={viaLink ? 'Not needed with a shared link' : '192.168.0.50'}
					autocapitalize="none"
					autocomplete="off"
					data-testid="pf-host"
				/></label
			>
			{#if !viaLink}
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
			{/if}
		{/if}
		{#each fieldList as fld (fld.key)}
			<label class="field"
				>{optField(fld.key)?.label ?? fld.label}
				<input
					type={fld.secret ? 'password' : 'text'}
					autocomplete="off"
					autocapitalize="none"
					required={!!optField(fld.key)?.required && !printer?.secretsSet.includes(fld.key)}
					value={secrets[fld.key] ?? (fld.secret ? '' : (printer?.identifiers[fld.key] ?? ''))}
					placeholder={fld.secret && printer?.secretsSet.includes(fld.key)
						? moved
							? 'Re-enter for the new address'
							: 'Saved (leave blank to keep)'
						: ''}
					data-testid="pf-{fld.key}"
					oninput={(e) => (secrets[fld.key] = e.currentTarget.value)}
				/>
				{#if fld.secret && needRetype(fld.key)}<small data-testid="pf-retype-{fld.key}"
						>The saved value is only used at the address it was saved for. Re-enter it to use this
						address.</small
					>{/if}
				{#if optField(fld.key)?.hint ?? fld.hint}<small>{optField(fld.key)?.hint ?? fld.hint}</small
					>{/if}
				{#if fld.key === 'shareLink' && hasSavedLink && !secrets.shareLink?.trim() && !option}
					<button
						class="btn sm linkrm"
						type="button"
						data-testid="pf-sharelink-remove"
						onclick={() => (removeLink = !removeLink)}
						>{removeLink ? 'Keep the saved link' : 'Remove the saved link'}</button
					>
				{/if}
			</label>
		{/each}
		{#if !option || optField('catalogId')}
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
		{/if}
	</div>
	{#if !option}<p class="muted hint">{info.hint}</p>{/if}

	{#if (option ? option.key === 'elegoo-lan' : f.kind === 'elegoo-sdcp') && !viaLink}
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

	{#if !isManual}
		<fieldset class="cam" data-testid="pf-camera">
			<legend>Camera</legend>
			{#if camSupported}
				<label class="chk"
					><input type="checkbox" bind:checked={f.cameraEnabled} data-testid="pf-camera-on" /> Show the
					camera while this printer is printing</label
				>
				{#if viaLink}
					<p class="muted hint" data-testid="pf-camera-via-link">
						The camera comes through the OctoEverywhere link too.
					</p>
				{:else}
					<label class="field"
						>Camera address (optional)
						<input
							bind:value={f.cameraUrl}
							placeholder={camPlaceholder}
							autocapitalize="none"
							autocomplete="off"
							maxlength="500"
							data-testid="pf-camera-url"
						/>
						<small
							>Leave empty to use the automatic address. A custom address must be on the same
							address as the printer (any port).</small
						>
					</label>
				{/if}
				<div class="actions">
					<button
						class="btn sm"
						type="button"
						onclick={runCameraTest}
						disabled={camTesting || !canTest}
						data-testid="pf-camera-test">{camTesting ? 'Testing…' : 'Test camera'}</button
					>
				</div>
				{#if cam}
					<div data-testid="pf-camera-result">
						{#if cam.works && cam.image}
							<img class="camprev" src={cam.image} alt="Camera test frame" />
						{:else}
							<span class="bad">{cam.message ?? 'No picture'}</span>
						{/if}
					</div>
				{/if}
			{:else}
				<p class="muted hint" data-testid="pf-camera-unsupported">
					Camera is not supported for Bambu Lab printers: their camera uses a proprietary stream.
				</p>
			{/if}
		</fieldset>

		<label class="chk"
			><input type="checkbox" bind:checked={f.enabled} data-testid="pf-enabled" /> Monitor this printer
			(uncheck to stop monitoring; the print is not affected)</label
		>
	{/if}

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
		{#if !isManual}
			<button
				class="btn"
				type="button"
				onclick={runTest}
				disabled={testing || !canTest}
				data-testid="pf-test">{testing ? 'Testing…' : 'Test connection'}</button
			>
		{/if}
		<button class="btn" type="button" onclick={oncancel}>Cancel</button>
	</div>
</form>

<style>
	.pf :global(.form-grid) {
		align-items: start;
	}
	.pf small {
		color: var(--muted);
		font-size: var(--fs-xs);
	}
	.cam {
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-5) var(--sp-6);
		display: grid;
		gap: var(--sp-4);
	}
	.cam legend {
		font-size: var(--fs-sm);
		padding: 0 var(--sp-2);
	}
	.camprev {
		display: block;
		width: 100%;
		max-width: 480px;
		aspect-ratio: 16 / 9;
		object-fit: contain;
		background: #0c0e16; /* camera stage: dark in both themes */
		border-radius: var(--r-md);
	}
	.pf-steps h4 {
		margin: 0 0 var(--sp-3);
		font-size: var(--fs-md);
	}
	.pf-steps {
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-5) var(--sp-6);
		background: var(--bg-soft, transparent);
	}
	.pf-steps ol {
		margin: 0 0 var(--sp-4);
		padding-left: 1.3em;
		display: grid;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}
	.pf-steps summary {
		cursor: pointer;
		min-height: 24px;
	}
	.linkrm {
		justify-self: start;
	}
	.hint {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.disc {
		display: grid;
		gap: var(--sp-4);
	}
	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--sp-3);
	}
	.found li {
		display: flex;
		justify-content: space-between;
		gap: var(--sp-4);
		align-items: center;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--sp-3) var(--sp-5);
	}
	.chk {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		font-size: var(--fs-md);
	}
	.actions {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	.testbox {
		display: grid;
		gap: var(--sp-4);
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
