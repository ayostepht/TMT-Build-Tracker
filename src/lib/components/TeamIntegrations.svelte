<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		getOrgSettings,
		saveOrgSettings,
		testSpoolman,
		type OrgSettingsDto
	} from '#lib/client/api.ts';

	/** Team page section: printers link, "log finished prints automatically", Spoolman address and auto-deduct. */
	let { orgId, slug }: { orgId: string; slug: string } = $props();

	let s = $state<OrgSettingsDto | null>(null);
	let canEdit = $state(false);
	let url = $state('');
	let msg = $state('');
	let err = $state('');
	let busy = $state(false);

	$effect(() => {
		void getOrgSettings(orgId)
			.then((r) => {
				s = r.settings;
				canEdit = r.canEdit;
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
	<h2>Printers and Spoolman</h2>
	<div>
		<a
			class="btn"
			href={resolve('/(app)/teams/[slug]/printers', { slug })}
			data-testid="printers-link">Printers</a
		>
	</div>
	{#if s}
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
