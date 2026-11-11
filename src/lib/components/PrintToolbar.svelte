<script lang="ts">
	import { filamentLabel } from '#lib/domain/index.ts';
	import { getBuildCtx } from './build-context.svelte.ts';
	import Swatch from './Swatch.svelte';

	type By = 'role' | 'section' | 'plate';

	/**
	 * The Print tab's filter bar. Desktop: one compact inline row (filament chips, Hide printed,
	 * Group by, build guide). Phone (<= 760 px): one short row with a Filter button that opens a
	 * bottom sheet holding the same controls, so the bar costs ~50 px instead of ~300. Not sticky:
	 * it scrolls away with the page and never covers plate headings.
	 */
	let {
		role,
		hide,
		by,
		onrole,
		onhide,
		onby
	}: {
		/** Filament role key shown, or 'all'. */
		role: string;
		hide: boolean;
		by: By;
		onrole: (k: string) => void;
		onhide: (v: boolean) => void;
		onby: (v: By) => void;
	} = $props();
	const ctx = getBuildCtx();
	const uid = $props.id();

	let dlg = $state<HTMLDialogElement>();
	let open = $state(false);
	let trigger: HTMLElement | null = null;
	$effect(() => {
		if (!dlg) return;
		if (open && !dlg.open) {
			trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			dlg.showModal();
		} else if (!open && dlg.open) dlg.close();
	});
	function onclose() {
		open = false;
		if (trigger?.isConnected) trigger.focus();
		trigger = null;
	}

	const BY_LABEL: Record<By, string> = { role: 'Filament', section: 'Section', plate: 'Plate' };
	const roleName = $derived(
		role === 'all' ? '' : filamentLabel(ctx.view.filaments.find((f) => f.key === role))
	);
	// Phone summary next to the button: what is narrowing the list right now.
	const summary = $derived(
		[hide ? 'Printed hidden' : '', roleName, `by ${BY_LABEL[by]}`].filter(Boolean).join(' · ')
	);
	const active = $derived((hide ? 1 : 0) + (role !== 'all' ? 1 : 0));
</script>

{#snippet controls(prefix: string)}
	<div class="ptb-chips">
		<button class="chip" type="button" aria-pressed={role === 'all'} onclick={() => onrole('all')}
			>All filament</button
		>
		{#each ctx.view.filaments as f (f.key)}
			<button
				class="chip"
				type="button"
				aria-pressed={role === f.key}
				onclick={() => onrole(f.key)}
			>
				<Swatch hex={f.hex} tpu={f.tpu} size="mini" />
				{filamentLabel(f)}
			</button>
		{/each}
	</div>
	<label class="ptb-tog" for="{prefix}-hide"
		><input
			id="{prefix}-hide"
			type="checkbox"
			checked={hide}
			onchange={(e) => onhide(e.currentTarget.checked)}
		/> Hide printed</label
	>
	<label class="ptb-tog" for="{prefix}-by"
		>Group by
		<select id="{prefix}-by" value={by} onchange={(e) => onby(e.currentTarget.value as By)}>
			<option value="role">Filament</option>
			<option value="section">Section</option>
			<option value="plate">Plate</option>
		</select>
	</label>
{/snippet}

<div class="ptb" role="toolbar" aria-label="Filter parts">
	<div class="ptb-inline">
		{@render controls(`${uid}-i`)}
	</div>
	<div class="ptb-phone">
		<button
			class="btn sm"
			type="button"
			data-testid="print-filter-open"
			aria-haspopup="dialog"
			onclick={() => (open = true)}>Filter{active ? ` · ${active}` : ''}</button
		>
		<span class="ptb-sum">{summary}</span>
	</div>
	<button class="btn sm ptb-guide" type="button" onclick={() => ctx.openGuide(null)}
		>Open build guide</button
	>
</div>

<dialog
	bind:this={dlg}
	class="ptb-sheet"
	aria-labelledby="{uid}-t"
	{onclose}
	onclick={(e) => e.target === dlg && (open = false)}
>
	{#if open}
		<div class="ptb-body">
			<header>
				<h2 id="{uid}-t">Filter parts</h2>
				<button class="ptb-x" type="button" aria-label="Close" onclick={() => (open = false)}
					>×</button
				>
			</header>
			{@render controls(`${uid}-s`)}
			<button class="btn primary" type="button" onclick={() => (open = false)}>Done</button>
		</div>
	{/if}
</dialog>

<style>
	.ptb {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		align-items: center;
		padding: 8px 0;
		border-bottom: 1px solid var(--line);
	}
	.ptb-inline {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		align-items: center;
		min-width: 0;
		flex: 1 1 auto;
	}
	.ptb-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.ptb-tog {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--muted);
	}
	.ptb-tog select {
		padding: 4px 6px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--card);
		color: var(--ink);
	}
	.ptb-phone {
		display: none;
		align-items: center;
		gap: 10px;
		min-width: 0;
		flex: 1 1 0;
	}
	.ptb-phone .btn {
		flex: none;
		white-space: nowrap;
	}
	.ptb-sum {
		font-size: 13px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.ptb-sheet {
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--card);
		color: var(--ink);
		padding: 0;
		width: min(480px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow: auto;
	}
	.ptb-sheet::backdrop {
		background: rgb(10 12 24 / 0.55);
	}
	.ptb-body {
		display: grid;
		gap: 14px;
		padding: 16px;
	}
	.ptb-body header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.ptb-body h2 {
		margin: 0;
		font-family: var(--f-display);
		font-size: 24px;
	}
	.ptb-x {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 24px;
		line-height: 1;
		padding: 4px 10px;
		cursor: pointer;
	}
	.ptb-body .ptb-tog {
		min-height: 40px;
		font-size: 15px;
		color: var(--ink);
	}
	.ptb-body .ptb-tog select {
		min-height: 40px;
		font-size: 16px;
	}
	.ptb-body .ptb-tog input {
		width: 20px;
		height: 20px;
	}
	@media (max-width: 760px) {
		.ptb-inline {
			display: none;
		}
		.ptb-phone {
			display: flex;
		}
		.ptb-guide {
			flex: none;
			white-space: nowrap;
		}
		.ptb-sheet {
			width: 100%;
			max-width: 100%;
			margin: auto 0 0;
			border-radius: 16px 16px 0 0;
			max-height: 92dvh;
		}
	}
	@media (min-width: 761px) {
		.ptb-guide {
			margin-left: auto;
		}
	}
</style>
