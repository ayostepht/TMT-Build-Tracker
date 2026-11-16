<script lang="ts">
	import { prelinkUndo, prelinkDeduct, linkSpoolmanFilament } from '#lib/client/api.ts';
	import { fmt } from '#lib/domain/index.ts';
	import type { FilamentRole } from '#lib/domain/types.ts';
	import SpoolmanFilamentPicker from './SpoolmanFilamentPicker.svelte';

	/**
	 * One slot's Spoolman line (issue #59): not linked -> "Link to Spoolman", linked -> the filament,
	 * grams left (stale note when Spoolman was unreachable), spool in use, "Shared with N other
	 * builds", the pre-link prompt and unlink. Everything it changes goes through the server; it
	 * calls `onchange` so the parent reloads the build. Needs no build context.
	 *
	 * Place it under a filament slot (FilamentTiles, SlotPanel, wizard step). `slot.spoolman` comes
	 * with the build view (`FilamentRole.spoolman`); `workspaceConfigured` is `view.spoolman.configured`.
	 */
	let {
		buildId,
		slot,
		workspaceConfigured,
		canEdit,
		integrationsHref = null,
		onchange
	}: {
		buildId: string;
		slot: Pick<FilamentRole, 'key' | 'name' | 'spoolman'>;
		workspaceConfigured: boolean;
		canEdit: boolean;
		/** Where an owner sets Spoolman up (the Integrations page); shown when it is not set up yet. */
		integrationsHref?: string | null;
		onchange?: () => void | Promise<void>;
	} = $props();

	const sp = $derived(slot.spoolman);
	const linked = $derived(sp?.filamentId != null);
	let picking = $state<'filament' | 'spool' | null>(null);
	let busy = $state(false);
	let error = $state('');
	let warning = $state('');

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		error = '';
		warning = '';
		try {
			const r = (await fn()) as { warning?: string } | null | undefined;
			if (r?.warning) warning = r.warning; // e.g. only part of the grams could be subtracted
			await onchange?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Spoolman failed';
		}
		busy = false;
	}
	const ago = (ms: number) => {
		const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
		return m < 2
			? 'just now'
			: m < 120
				? `${m} min ago`
				: m < 2880
					? `${Math.round(m / 60)} h ago`
					: `${Math.round(m / 1440)} days ago`;
	};
</script>

{#if !workspaceConfigured}
	{#if integrationsHref}
		<p class="sl muted" data-testid="spoolman-line-off">
			Track this filament's grams in Spoolman.
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href is resolved by the parent -->
			<a href={integrationsHref}>Connect Spoolman</a>
		</p>
	{/if}
{:else}
	<div class="sl" data-testid="spoolman-line">
		{#if !linked}
			<span class="muted">Not linked to Spoolman</span>
			{#if canEdit}
				<button
					class="btn sm"
					type="button"
					data-testid="spoolman-link"
					onclick={() => (picking = picking ? null : 'filament')}>Link to Spoolman…</button
				>
			{/if}
		{:else}
			<div class="main">
				<span class="lbl" data-testid="spoolman-label"
					>{sp?.filamentName ?? `Spoolman filament #${sp?.filamentId}`}</span
				>
				{#if sp?.stock}
					<span class="num" data-testid="spoolman-stock">
						{sp.stock.remainingG != null ? `${fmt(sp.stock.remainingG)} g left` : 'weight unknown'}
					</span>
					{#if sp.stock.stale}
						<span class="warn" data-testid="spoolman-stale" title={sp.stock.error ?? ''}
							>Spoolman unreachable, last seen {ago(sp.stock.fetchedAt)}</span
						>
					{/if}
				{:else}
					<span class="muted">weight not fetched yet</span>
				{/if}
			</div>
			<div class="meta muted">
				{#if sp?.spoolId != null}<span
						>Spool #{sp.spoolId} in use{sp.spoolName ? ` (${sp.spoolName})` : ''}</span
					>{/if}
				{#if sp && sp.sharedWith > 0}
					<span data-testid="spoolman-shared"
						>Shared with {sp.sharedWith} other build{sp.sharedWith === 1 ? '' : 's'}</span
					>
				{/if}
				{#if sp?.keptBy === 'other'}<span>Weights kept up to date elsewhere</span>{/if}
			</div>
			{#if sp && sp.preLinkLoggedG > 0 && sp.prelinkDeductedG <= 0 && sp.keptBy === 'app' && canEdit}
				<div class="note" data-testid="spoolman-prelink-note">
					{fmt(sp.preLinkLoggedG)} g logged before linking are not taken from Spoolman.
					<button
						class="btn sm"
						type="button"
						disabled={busy}
						data-testid="prelink-apply"
						onclick={() => run(() => prelinkDeduct(buildId, slot.key))}>Subtract now</button
					>
				</div>
			{:else if sp && sp.prelinkDeductedG > 0}
				<div class="note" data-testid="spoolman-prelink-done">
					{fmt(sp.prelinkDeductedG)} g from earlier prints were subtracted from Spoolman.
					{#if canEdit}
						<button
							class="btn sm"
							type="button"
							disabled={busy}
							data-testid="prelink-undo"
							onclick={() => run(() => prelinkUndo(buildId, slot.key))}>Give back</button
						>
					{/if}
				</div>
			{/if}
			{#if canEdit}
				<div class="acts">
					<button
						class="btn sm"
						type="button"
						onclick={() => (picking = picking === 'filament' ? null : 'filament')}
						>Other filament…</button
					>
					<button
						class="btn sm"
						type="button"
						onclick={() => (picking = picking === 'spool' ? null : 'spool')}>Spool…</button
					>
					<button
						class="btn ghost sm"
						type="button"
						disabled={busy}
						data-testid="spoolman-unlink"
						onclick={() => run(() => linkSpoolmanFilament(buildId, slot.key, null))}>Unlink</button
					>
				</div>
			{/if}
		{/if}
		{#if warning}<div class="warn" role="status" data-testid="spoolman-warning">{warning}</div>{/if}
		{#if error}<div class="error" role="alert" style="white-space:normal">{error}</div>{/if}
		{#if picking}
			<SpoolmanFilamentPicker
				{buildId}
				role={slot.key}
				mode={picking}
				keptBy={sp?.keptBy ?? 'app'}
				currentFilamentId={sp?.filamentId ?? null}
				currentSpoolId={sp?.spoolId ?? null}
				{onchange}
				onclose={() => (picking = null)}
			/>
		{/if}
	</div>
{/if}

<style>
	.sl {
		display: grid;
		justify-items: start;
		gap: var(--sp-3);
		font-size: var(--fs-sm);
		margin: 0;
		min-width: 0;
	}
	.main {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-4);
		align-items: baseline;
	}
	.lbl {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-2) var(--sp-5);
		font-size: var(--fs-xs);
	}
	.warn {
		color: var(--warn);
	}
	.note {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3) var(--sp-4);
		align-items: center;
		border-left: 3px solid var(--line);
		padding-left: var(--sp-4);
	}
	.acts {
		display: flex;
		gap: var(--sp-3);
		flex-wrap: wrap;
	}
</style>
