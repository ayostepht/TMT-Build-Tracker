<script lang="ts">
	import { untrack } from 'svelte';
	import {
		getOrgSettings,
		getPrinterOptions,
		saveOrgSettings,
		testSpoolman,
		type OrgSettingsDto
	} from '#lib/client/api.ts';
	import { PrinterStore } from '#lib/client/printer-store.svelte.ts';
	import type { ConnectionOptionView } from '#lib/printers/connection-options.ts';
	import { hasConnectedPrinter, hostedLabel } from '#lib/printers/integrations-view.ts';
	import { HOSTED_NOTE, SPOOLMAN_TEXT, guideUrl } from '#lib/printers/setup-steps.ts';
	import IntegrationPrinters from './IntegrationPrinters.svelte';

	/**
	 * Workspace Integrations: Printers (add, edit, remove), automatic print logging, Spoolman.
	 * `hosted` (server mode, known before anything loads) decides the top note and the Spoolman
	 * card; the printer options come from GET /api/printers/options.
	 */
	let { orgId, hosted }: { orgId: string; hosted: boolean } = $props();

	const store = new PrinterStore(untrack(() => orgId));
	$effect(() => store.acquire());

	let options = $state<ConnectionOptionView[]>([]);
	let optionsError = $state('');
	$effect(() => {
		void getPrinterOptions()
			.then((r) => (options = r.connectionOptions))
			.catch((e) => (optionsError = e instanceof Error ? e.message : 'Could not load the options'));
	});

	let s = $state<OrgSettingsDto | null>(null);
	let canEdit = $state(false);
	let url = $state('');
	let msg = $state('');
	let err = $state('');
	let busy = $state(false);
	let blocked = $state<string | null>(null);

	$effect(() => {
		void getOrgSettings(orgId)
			.then((r) => {
				s = r.settings;
				canEdit = r.canEdit;
				blocked = r.blocked ?? null;
				url = r.settings.spoolmanUrl ?? '';
			})
			.catch((e) => (err = e instanceof Error ? e.message : 'Could not load settings'));
	});

	async function save(patch: Partial<OrgSettingsDto>, note = 'Saved') {
		busy = true;
		err = '';
		msg = '';
		try {
			s = (await saveOrgSettings(orgId, patch)).settings;
			url = s.spoolmanUrl ?? '';
			msg = note;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not save';
		} finally {
			busy = false;
		}
	}
	async function test() {
		busy = true;
		err = '';
		msg = '';
		try {
			const r = await testSpoolman(orgId, url || undefined);
			msg = `Connected to Spoolman${r.version ? ` ${r.version}` : ''}: ${r.spoolCount} spool${r.spoolCount === 1 ? '' : 's'}.`;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not reach Spoolman';
		} finally {
			busy = false;
		}
	}
</script>

<!-- External guide links only (the repository on GitHub): nothing to resolve. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<div class="ti-page" data-testid="team-integrations">
	{#if hosted}
		<aside class="card ti-hosted" data-testid="hosted-note">
			<h3>Hosted or self-hosted?</h3>
			<p>{HOSTED_NOTE}</p>
		</aside>
	{/if}

	{#if optionsError}<div class="error" role="alert">{optionsError}</div>{/if}
	<IntegrationPrinters {orgId} {store} {options} canEdit={store.canEdit || canEdit} />

	<section class="card ti-sec" data-testid="autolog-section" aria-labelledby="ti-autolog-h">
		<h2 id="ti-autolog-h">Automatic print logging</h2>
		{#if store.loaded && !hasConnectedPrinter(store.printers)}
			<p class="muted" data-testid="autolog-hint">
				This appears once a printer is connected: a printer that is not connected cannot tell the
				app when a print finishes.
			</p>
		{:else if s}
			<label class="ti-chk">
				<input
					type="checkbox"
					checked={s.autoLogPrints}
					disabled={!canEdit || busy}
					data-testid="autolog"
					onchange={(e) => save({ autoLogPrints: e.currentTarget.checked })}
				/>
				Log finished prints automatically
			</label>
			<p class="muted">
				When a connected printer finishes a print that is linked to a plate, log it with the plate's
				slicer grams and the printer's print time. Off: you get a "Confirm print log" prompt
				instead.
			</p>
			{#if !canEdit}<p class="muted">Only chapter owners and editors can change this.</p>{/if}
		{/if}
	</section>

	<section
		class="card ti-sec"
		class:ti-off={hosted}
		data-testid="team-spoolman"
		aria-labelledby="ti-spool-h"
	>
		<div class="ti-head">
			<h2 id="ti-spool-h">Spoolman</h2>
			<span class="ig-tag" data-testid="spoolman-hosted-label">{hostedLabel(false)}</span>
		</div>
		<p class="muted">{SPOOLMAN_TEXT.description}</p>
		{#if hosted}
			<p data-testid="integrations-unavailable">{SPOOLMAN_TEXT.hostedReason}</p>
		{:else}
			<div class="ti-steps" data-testid="spoolman-steps">
				<h4>How to set it up</h4>
				<ol>
					{#each SPOOLMAN_TEXT.steps as st (st)}<li>{st}</li>{/each}
				</ol>
				<a
					href={guideUrl(SPOOLMAN_TEXT.anchor)}
					target="_blank"
					rel="noreferrer noopener"
					data-testid="spoolman-guide">Full guide</a
				>
			</div>
			{#if s}
				<label class="field"
					>Spoolman address
					<input
						bind:value={url}
						placeholder="http://192.168.0.20:7912"
						disabled={!canEdit}
						autocapitalize="none"
						data-testid="spoolman-url"
					/>
				</label>
				<label class="ti-chk">
					<input
						type="checkbox"
						checked={s.spoolmanAutoDeduct}
						disabled={!canEdit || busy || !s.spoolmanUrl}
						data-testid="spoolman-deduct"
						onchange={(e) => save({ spoolmanAutoDeduct: e.currentTarget.checked })}
					/>
					Deduct logged grams from spools
				</label>
				{#if canEdit}
					<div class="ti-row">
						<button
							class="btn primary"
							type="button"
							disabled={busy}
							data-testid="spoolman-save"
							onclick={() => save({ spoolmanUrl: url.trim() || null })}>Save address</button
						>
						<button class="btn" type="button" disabled={busy || !url.trim()} onclick={test}
							>Test Spoolman</button
						>
					</div>
				{:else}
					<p class="muted">Only chapter owners can change these settings.</p>
				{/if}
				{#if blocked}<div class="error" role="alert" data-testid="spoolman-blocked">
						This saved Spoolman address can no longer be used: {blocked}
					</div>{/if}
			{/if}
		{/if}
		<div role="status" class="ti-msg">{msg}</div>
		{#if err}<div class="error" role="alert">{err}</div>{/if}
	</section>
</div>

<style>
	.ti-page {
		display: grid;
		gap: var(--sp-8);
		align-content: start;
	}
	.ti-sec {
		display: grid;
		gap: var(--sp-4);
	}
	.ti-sec h2,
	.ti-hosted h3 {
		margin: 0;
	}
	.ti-sec p,
	.ti-hosted p {
		margin: 0;
	}
	.ti-off {
		opacity: 0.85;
	}
	.ti-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-4);
	}
	.ig-tag {
		font-size: var(--fs-xs);
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		padding: 1px var(--sp-4);
		color: var(--muted);
	}
	.ti-steps {
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: var(--sp-5) var(--sp-6);
	}
	.ti-steps h4 {
		margin: 0 0 var(--sp-3);
		font-size: var(--fs-md);
	}
	.ti-steps ol {
		margin: 0 0 var(--sp-4);
		padding-left: 1.3em;
		display: grid;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
	}
	.ti-chk {
		display: flex;
		gap: var(--sp-4);
		align-items: center;
		font-size: var(--fs-md);
	}
	.ti-row {
		display: flex;
		gap: var(--sp-4);
		flex-wrap: wrap;
	}
	.ti-msg {
		font-size: var(--fs-sm);
		color: var(--ok);
		min-height: 1em;
	}
	.error {
		white-space: normal;
	}
</style>
