<script lang="ts">
	import { onMount } from 'svelte';
	import { getKitStatus } from '#lib/client/api.ts';
	import { kitChecklist, type ChecklistRow, type KitStatusDto } from '#lib/domain/kit-import.ts';

	/**
	 * What this install holds for the kit: 3D chair, print geometry, guide, hardware model, each
	 * with a warning and a hint when something is missing. Loads itself; call `refresh()` after an import.
	 */
	let {
		templateId,
		compact = false,
		onloaded
	}: {
		templateId: string;
		compact?: boolean;
		onloaded?: (info: { canImport: boolean }) => void;
	} = $props();

	let status = $state<KitStatusDto | null>(null);
	let error = $state('');

	export async function refresh() {
		try {
			const r = await getKitStatus(templateId);
			status = r.status;
			error = '';
			onloaded?.({ canImport: r.canImport });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load the kit status';
		}
	}
	onMount(refresh);

	const rows = $derived<ChecklistRow[]>(status ? kitChecklist(status) : []);
	const mark = { ok: 'Ready', partial: 'Needs attention', missing: 'Missing' } as const;
</script>

<section class="ks" class:compact data-testid="kit-status" aria-label="MakeGood files status">
	{#if !compact}<h2>MakeGood files</h2>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if !status && !error}<p class="muted">Loading…</p>{/if}
	<ul>
		{#each rows as r (r.id)}
			<li class={r.state} data-testid="kit-row-{r.id}" data-state={r.state}>
				<div class="head">
					<span class="dot" aria-hidden="true"></span>
					<strong>{r.title}</strong>
					<span class="chip">{mark[r.state]}</span>
				</div>
				{#if !compact}
					{#each r.lines as l (l)}<div class="meta">{l}</div>{/each}
				{:else if r.lines[0]}
					<div class="meta">{r.lines[0]}</div>
				{/if}
				{#each r.hints as h (h)}<div class="hint">{h}</div>{/each}
			</li>
		{/each}
	</ul>
</section>

<style>
	.ks {
		display: grid;
		gap: 8px;
	}
	h2 {
		margin: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
	}
	li {
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 10px 12px;
		display: grid;
		gap: 2px;
		background: var(--paper);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--muted);
	}
	li.ok .dot {
		background: var(--ok);
	}
	li.partial .dot {
		background: var(--warn, #c98a00);
	}
	li.missing .dot {
		background: var(--bad);
	}
	.chip {
		margin-left: auto;
		font-size: 12px;
		color: var(--muted);
	}
	li.ok .chip {
		color: var(--ok);
	}
	li.missing .chip {
		color: var(--bad);
	}
	.meta {
		font-size: 13px;
		color: var(--muted);
	}
	.hint {
		font-size: 13px;
		color: var(--ink);
		border-left: 3px solid var(--warn, #c98a00);
		padding-left: 8px;
		margin-top: 4px;
	}
	li.missing .hint {
		border-left-color: var(--bad);
	}
</style>
