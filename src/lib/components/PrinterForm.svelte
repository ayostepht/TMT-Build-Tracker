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
	import { SHARE_LINK_HOST_PLACEHOLDER } from '#lib/printers/share-link.ts';
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
		f.kind === 'elegoo-sdcp' && (!!secrets.shareLink?.trim() || (hasSavedLink && !removeLink))
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
		{#each info.secrets.filter((x) => !(viaLink && x.key === 'mainboardId')) as fld (fld.key)}
			<label class="field"
				>{fld.label}
				<input
					type={fld.secret ? 'password' : 'text'}
					autocomplete="off"
					autocapitalize="none"
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
				{#if fld.hint}<small>{fld.hint}</small>{/if}
				{#if fld.key === 'shareLink' && hasSavedLink && !secrets.shareLink?.trim()}
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

	{#if f.kind === 'elegoo-sdcp' && !viaLink}
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
						>Leave empty to use the automatic address. A custom address must be on the same address
						as the printer (any port).</small
					>
				</label>
			{/if}
			<div class="actions">
				<button
					class="btn sm"
					type="button"
					onclick={runCameraTest}
					disabled={camTesting || (!f.host && !viaLink)}
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
			disabled={testing || (!f.host && !viaLink)}
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
	.cam {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 10px 12px;
		display: grid;
		gap: 8px;
	}
	.cam legend {
		font-size: 13px;
		padding: 0 4px;
	}
	.camprev {
		display: block;
		width: 100%;
		max-width: 480px;
		aspect-ratio: 16 / 9;
		object-fit: contain;
		background: #0c0e16;
		border-radius: 6px;
	}
	.linkrm {
		justify-self: start;
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
