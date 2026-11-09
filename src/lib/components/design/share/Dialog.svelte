<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Small modal: centered card on desktop, bottom sheet on phones. Escape or the backdrop closes it. */
	let {
		title,
		onclose,
		children,
		testid
	}: { title: string; onclose: () => void; children: Snippet; testid?: string } = $props();

	let box = $state<HTMLElement>();
	let opener: HTMLElement | null = null;
	const FOCUSABLE =
		'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], textarea:not([disabled])';

	$effect(() => {
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		box?.querySelector<HTMLElement>('input, select, button.primary')?.focus();
		return () => opener?.focus();
	});

	function key(e: KeyboardEvent) {
		if (e.key !== 'Tab' || !box) return;
		const els = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (!els.length) return;
		const first = els[0];
		const last = els[els.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>

<div class="back" role="presentation" onclick={onclose}>
	<div
		class="dlg"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		data-testid={testid}
		bind:this={box}
		onkeydown={key}
		onclick={(e) => e.stopPropagation()}
	>
		<header>
			<h2>{title}</h2>
			<button type="button" class="x" aria-label="Close" onclick={onclose}>×</button>
		</header>
		<div class="body">{@render children()}</div>
	</div>
</div>

<style>
	.back {
		position: fixed;
		inset: 0;
		z-index: 1500;
		background: rgb(0 0 0 / 0.45);
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.dlg {
		background: var(--card);
		color: var(--ink);
		width: 100%;
		max-height: 88dvh;
		display: flex;
		flex-direction: column;
		border-radius: 14px 14px 0 0;
		box-shadow: 0 -6px 30px rgb(0 0 0 / 0.3);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px 6px;
	}
	h2 {
		margin: 0;
		font-size: 18px;
	}
	.x {
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 26px;
		line-height: 1;
		min-width: 40px;
		min-height: 40px;
		cursor: pointer;
	}
	.body {
		padding: 6px 16px 18px;
		overflow-y: auto;
		display: grid;
		gap: 14px;
	}
	@media (min-width: 600px) {
		.back {
			align-items: center;
		}
		.dlg {
			width: min(480px, calc(100vw - 32px));
			border-radius: 14px;
			box-shadow: 0 10px 40px rgb(0 0 0 / 0.35);
		}
	}
</style>
