<script lang="ts">
	import Dialog from '#lib/components/design/share/Dialog.svelte';
	import type { createAsk } from '#lib/client/ask.svelte.ts';

	let { ask }: { ask: ReturnType<typeof createAsk> } = $props();
	const q = $derived(ask.current);
</script>

{#if q}
	<Dialog title={q.title} onclose={() => q.resolve(false)} testid="ask-dialog" danger={q.danger}>
		<p class="ask-msg" data-testid="ask-message">{q.message}</p>
		<div class="ask-actions">
			<button
				class="btn"
				type="button"
				data-testid="ask-cancel"
				data-cancel
				onclick={() => q.resolve(false)}>{q.cancelLabel}</button
			>
			<button
				class="btn primary"
				type="button"
				data-testid="ask-confirm"
				onclick={() => q.resolve(true)}>{q.confirmLabel}</button
			>
		</div>
	</Dialog>
{/if}

<style>
	.ask-msg {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.ask-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
