<script lang="ts">
	import { resolve } from '$app/paths';
	import { getBuildCtx } from '#lib/components/build-context.svelte.ts';
	import ExportCard from '#lib/components/ExportCard.svelte';

	let { open = $bindable(false) }: { open: boolean } = $props();

	const ctx = getBuildCtx();
	let dlg = $state<HTMLDialogElement>();
	let trigger: HTMLElement | null = null;
	const uid = $props.id();

	$effect(() => {
		if (!dlg) return;
		if (open && !dlg.open) {
			trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			dlg.showModal();
		} else if (!open && dlg.open) {
			dlg.close();
		}
	});

	function onclose() {
		open = false;
		const t = trigger;
		trigger = null;
		if (t?.isConnected) t.focus();
	}
	function onbackdrop(e: MouseEvent) {
		if (e.target === dlg) open = false;
	}
</script>

<dialog
	bind:this={dlg}
	class="sheet"
	aria-labelledby="{uid}-t"
	data-testid="export-dialog"
	{onclose}
	onclick={onbackdrop}
>
	{#if open}
		<div class="body">
			<header>
				<h2 id="{uid}-t">Export 3MF</h2>
				<button class="x" type="button" aria-label="Close" onclick={() => (open = false)}>×</button>
			</header>
			{#if ctx.view.printer}
				<ExportCard />
			{:else}
				<div class="card" data-testid="export-dialog-no-printer">
					<p>
						Choose your printer first: the file uses its bed size and filament slots, and the plates
						are arranged for it.
					</p>
					<a class="btn primary" href={resolve('/(app)/builds/[id]/plates', { id: ctx.id })}
						>Choose a printer on the Plates tab</a
					>
				</div>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--paper);
		color: var(--ink);
		padding: 0;
		width: min(640px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow: auto;
	}
	.sheet::backdrop {
		background: rgb(10 12 24 / 0.55);
	}
	.body {
		display: grid;
		gap: 12px;
		padding: 16px;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-family: var(--f-display);
		font-size: 24px;
	}
	.x {
		border: 0;
		background: transparent;
		color: var(--muted);
		font-size: 28px;
		line-height: 1;
		cursor: pointer;
		padding: 0 6px;
	}
	.card p {
		margin: 0;
	}
	.card a {
		justify-self: start;
	}
	@media (max-width: 599px) {
		.sheet {
			width: 100%;
			max-width: 100%;
			margin: auto 0 0;
			border-radius: 16px 16px 0 0;
			max-height: 92dvh;
		}
	}
</style>
