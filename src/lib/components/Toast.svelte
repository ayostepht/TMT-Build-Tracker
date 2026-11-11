<script lang="ts">
	import { toasts } from './toast.svelte.ts';

	let busy = $state<number | null>(null);
	let host = $state<HTMLElement>();

	// A manual popover lives in the top layer, so a toast raised while a modal <dialog> is open
	// is painted above the dialog's backdrop instead of under it.
	$effect(() => {
		if (!host) return;
		const open = host.matches(':popover-open');
		if (toasts.items.length && !open) host.showPopover();
		else if (!toasts.items.length && open) host.hidePopover();
	});

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

<div
	class="toasts"
	popover="manual"
	role="status"
	aria-live="polite"
	data-keep-active
	bind:this={host}
>
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
		/* Phones: just above the bottom tab bar (never over it), where the thumb is and the build header
		   stays readable. Stacked toasts are laid out in a column, never on top of each other. */
		bottom: calc(var(--bottom-bar-h, 0px) + 8px);
		display: grid;
		justify-items: center;
		gap: 8px;
		z-index: 2000;
		pointer-events: none;
		/* reset the popover UA box */
		top: auto;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		overflow: visible;
		width: auto;
		height: auto;
		inset-block-start: auto;
	}
	/* A modal dialog or bottom sheet from the shared Dialog is open: its actions sit at the bottom, so
	   toasts move to the top until it closes. (Native <dialog> sheets sit above toasts anyway.) */
	@media (max-width: 899px) {
		:global(:root:has([aria-modal='true'], dialog[open])) .toasts {
			bottom: auto;
			top: 12px;
			inset-block-start: 12px;
		}
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
		border-radius: var(--r-lg);
		font-size: var(--fs-md);
		box-shadow: var(--shadow-2);
	}
	.toast-act {
		border: 1px solid currentColor;
		border-radius: var(--r-pill);
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		padding: 6px 14px;
		min-height: 36px;
	}
	.toast-act:hover:not(:disabled) {
		background: color-mix(in srgb, currentColor 18%, transparent);
	}
	.toast-x {
		border: 0;
		background: transparent;
		color: inherit;
		opacity: 0.7;
		font-size: var(--fs-lg);
		line-height: 1;
		cursor: pointer;
		padding: 2px 6px;
	}
</style>
