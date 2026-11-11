<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Small modal: a native <dialog> opened with showModal() (the browser provides the focus trap,
	 * the inert page behind it, Escape and focus restore). Centered card on desktop, bottom sheet on
	 * phones (`ds-modal--sheet`). Escape, the backdrop or the close button call `onclose`.
	 */
	let {
		title,
		onclose,
		children,
		testid
	}: { title: string; onclose: () => void; children: Snippet; testid?: string } = $props();

	const uid = $props.id();

	function modal(node: HTMLDialogElement) {
		let gone = false;
		node.showModal();
		// Safe control first: the field, else the primary action, else the first focusable.
		node
			.querySelector<HTMLElement>('input, select, button.primary')
			?.focus({ preventScroll: true });
		// Native Escape closes the dialog and fires `close`; ignore the one our own teardown causes.
		const onnative = () => {
			if (!gone) onclose();
		};
		node.addEventListener('close', onnative);
		return {
			destroy() {
				gone = true;
				if (node.open) node.close();
			}
		};
	}
</script>

<dialog
	class="ds-modal ds-modal--sheet"
	aria-labelledby="{uid}-title"
	data-testid={testid}
	use:modal
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<header class="ds-modal__head dlg-head">
		<h2 id="{uid}-title">{title}</h2>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>×</button>
	</header>
	<div class="ds-modal__body dlg-body">{@render children()}</div>
</dialog>

<style>
	.dlg-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: var(--sp-3);
	}
	h2 {
		margin: 0;
		font-size: var(--fs-lg);
	}
	.x {
		border: 0;
		background: transparent;
		color: inherit;
		font-size: var(--fs-2xl);
		line-height: 1;
		min-width: 40px;
		min-height: 40px;
		cursor: pointer;
	}
	.x:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
		border-radius: var(--r-md);
	}
	.dlg-body {
		padding-top: var(--sp-3);
		display: grid;
		gap: var(--sp-7);
	}
</style>
