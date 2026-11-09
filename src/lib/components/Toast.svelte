<script lang="ts">
	import { toasts } from './toast.svelte.ts';

	let busy = $state<number | null>(null);

	async function act(id: number, run: () => Promise<void> | void) {
		busy = id;
		try {
			await run();
		} finally {
			busy = null;
			toasts.dismiss(id);
		}
	}
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each toasts.items as t (t.id)}
		<div class="toast">
			<span>{t.text}</span>
			{#if t.action}
				{@const a = t.action}
				<button
					class="toast-act"
					type="button"
					disabled={busy === t.id}
					onclick={() => act(t.id, a.run)}>{a.label}</button
				>
			{/if}
			<button
				class="toast-x"
				type="button"
				aria-label="Dismiss"
				onclick={() => toasts.dismiss(t.id)}>×</button
			>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 16px;
		right: 16px;
		/* Phones: top, under the nav, so toasts never sit on the sticky Apply bar, a bottom sheet or the
		   in-page confirmations. Stacked toasts are laid out in a column, never on top of each other. */
		top: 64px;
		display: grid;
		justify-items: center;
		gap: 8px;
		z-index: 2000;
		pointer-events: none;
	}
	/* Desktop: bottom-left, away from the right-hand panel and its Apply / Cancel bar. */
	@media (min-width: 900px) {
		.toasts {
			top: auto;
			bottom: 16px;
			right: auto;
			max-width: min(440px, calc(100vw - 32px));
			justify-items: start;
		}
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: 100%;
		background: var(--ink);
		color: var(--paper);
		padding: 10px 12px 10px 16px;
		border-radius: 10px;
		font-size: 14px;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.3);
	}
	.toast-act {
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		text-decoration: underline;
		cursor: pointer;
		padding: 4px 6px;
	}
	.toast-x {
		border: 0;
		background: transparent;
		color: inherit;
		opacity: 0.7;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		padding: 2px 6px;
	}
</style>
