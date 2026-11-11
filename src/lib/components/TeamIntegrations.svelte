<script lang="ts">
	import {
		getOrgSettings,
		saveOrgSettings,
		testSpoolman,
		type OrgSettingsDto
	} from '#lib/client/api.ts';

	/** Integrations tab: "log finished prints automatically", Spoolman address and auto-deduct. */
	let { orgId, available = true }: { orgId: string; available?: boolean } = $props();

	let s = $state<OrgSettingsDto | null>(null);
	let canEdit = $state(false);
	let url = $state('');
	let msg = $state('');
	let err = $state('');
	let busy = $state(false);
	let blocked = $state<string | null>(null);

	$effect(() => {
		if (!available) return;
		void getOrgSettings(orgId)
			.then((r) => {
				s = r.settings;
				canEdit = r.canEdit;
				blocked = (r as { blocked?: string | null }).blocked ?? null;
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

<section class="card" data-testid="team-integrations">
	<h2>Auto-log and Spoolman</h2>
	{#if !available}
		<p data-testid="integrations-unavailable">
			Printer status, automatic print logging and Spoolman are not available on this hosted site
			yet.
		</p>
		<p class="muted">
			Logging prints by hand works everywhere: open a build and log a plate when it finishes.
		</p>
	{:else if s}
		<label class="chk">
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
			slicer grams and the printer's print time. Off: you get a "Confirm print log" prompt instead.
		</p>
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
		<label class="chk">
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
			<div class="row">
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
		{#if blocked}<div
				class="error"
				role="alert"
				data-testid="spoolman-blocked"
				style="white-space:normal"
			>
				This saved Spoolman address can no longer be used: {blocked}
			</div>{/if}
		<p class="muted">
			Link each filament to a spool in a build's Settings. The server talks to Spoolman, so the
			address must be reachable from this container.
		</p>
	{/if}
	<div role="status" class="msg">{msg}</div>
	{#if err}<div class="error" role="alert" style="white-space:normal">{err}</div>{/if}
</section>

<style>
	.chk {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 14px;
	}
	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.msg {
		font-size: 13px;
		color: var(--ok);
		min-height: 1em;
	}
</style>
