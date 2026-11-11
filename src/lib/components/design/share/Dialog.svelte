<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isTopTrap, trapFocus } from '#lib/client/focus-trap.ts';

	/** Small modal: centered card on desktop, bottom sheet on phones. Escape or the backdrop closes it. */
	let {
		title,
		onclose,
		children,
		testid
	}: { title: string; onclose: () => void; children: Snippet; testid?: string } = $props();

	let box = $state<HTMLElement>();
	const uid = $props.id();
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && isTopTrap(box)) onclose();
	}}
/>

<div class="back" role="presentation" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="dlg"
		role="dialog"
		aria-modal="true"
		aria-labelledby="{uid}-title"
		tabindex="-1"
		data-testid={testid}
		bind:this={box}
		use:trapFocus={{ initial: 'input, select, button.primary' }}
		onclick={(e) => e.stopPropagation()}
	>
		<header>
			<h2 id="{uid}-title">{title}</h2>
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
		background: var(--scrim);
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
		border-radius: var(--r-xl) var(--r-xl) 0 0;
		box-shadow: var(--shadow-sheet);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--sp-7) var(--sp-8) var(--sp-3);
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
	.body {
		padding: var(--sp-3) var(--sp-8) var(--sp-9);
		overflow-y: auto;
		display: grid;
		gap: var(--sp-7);
	}
	@media (min-width: 761px) {
		.back {
			align-items: center;
		}
		.dlg {
			width: min(480px, calc(100vw - 32px));
			border-radius: var(--r-xl);
			box-shadow: var(--shadow-3);
		}
	}
</style>
