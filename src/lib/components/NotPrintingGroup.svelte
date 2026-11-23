<script lang="ts">
	import { getBuildCtx, filLabel } from './build-context.svelte.ts';

	/**
	 * "Not printing (N)": the parts a maker set aside ("Not printing this part / plate"), folded at the
	 * bottom of the Print tab. They are out of progress, filament and time until brought back, which
	 * restores the status they had. Editors get the buttons; viewers only see the list.
	 */
	const ctx = getBuildCtx();
	const items = $derived(ctx.view.skipped);
	let busy = $state(false);

	async function bring(slugs: string[]) {
		if (busy) return;
		busy = true;
		await ctx.restoreSkipped(slugs);
		busy = false;
	}
	const where = (n: number | null, name: string | null) =>
		n === null ? '' : `Plate ${n}${name ? ` · ${name}` : ''}`;
</script>

{#if items.length}
	<details class="np-fold" data-testid="not-printing">
		<summary class="np-sum"
			><span>Not printing ({items.length})</span>
			<span class="np-hint">Left out of progress, filament and time</span></summary
		>
		<ul class="np-list">
			{#each items as s (s.slug)}
				<li class="np-row" data-testid="not-printing-row">
					<span class="np-main">
						<span class="np-name">{s.name}</span>
						<span class="np-meta"
							>{[
								s.custom ? 'Custom' : '',
								where(s.plateNumber, s.plateName),
								filLabel(ctx.filament(s.role), s.role),
								s.status === 'To print' ? '' : s.status
							]
								.filter(Boolean)
								.join(' · ')}</span
						>
					</span>
					{#if ctx.canEdit}
						<button
							class="btn sm np-btn"
							type="button"
							disabled={busy}
							aria-label="Bring back {s.name}"
							data-testid="bring-back"
							onclick={() => bring([s.slug])}>Bring back</button
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if ctx.canEdit && items.length > 1}
			<div class="np-all">
				<button
					class="btn np-btn"
					type="button"
					disabled={busy}
					data-testid="bring-back-all"
					onclick={() => bring(items.map((s) => s.slug))}>Bring back all</button
				>
			</div>
		{/if}
	</details>
{/if}

<style>
	.np-fold {
		margin-top: var(--sp-7);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--card);
	}
	.np-sum {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--sp-3) var(--sp-5);
		padding: var(--sp-5);
		cursor: pointer;
		font-weight: 600;
		min-height: 44px;
		box-sizing: border-box;
	}
	.np-hint {
		font-weight: 400;
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.np-list {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--line);
	}
	.np-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-5);
		padding: var(--sp-4) var(--sp-5);
		border-bottom: 1px solid var(--line);
	}
	.np-row:last-child {
		border-bottom: 0;
	}
	.np-main {
		display: grid;
		gap: var(--sp-1);
		min-width: 0;
	}
	.np-name {
		overflow-wrap: anywhere;
	}
	.np-meta {
		font-size: var(--fs-sm);
		color: var(--muted);
	}
	.np-btn {
		flex: none;
		min-height: 44px;
	}
	.np-all {
		padding: var(--sp-4) var(--sp-5);
		border-top: 1px solid var(--line);
	}
</style>
