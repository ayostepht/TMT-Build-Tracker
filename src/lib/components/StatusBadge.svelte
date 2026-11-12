<script lang="ts">
	/**
	 * One status badge that is also the control: a button that opens a small menu of the statuses
	 * valid from here (`options`, in order; the current one shows as checked). Used for a plate
	 * (PlateControl) and for a part row (PartRow). With nothing to change to, or for viewers
	 * (`interactive` false), it is a plain badge: same look, no button, no menu.
	 *
	 * The menu is a manual popover (top layer), so no card with `overflow: hidden` can clip it; it is
	 * placed with fixed coordinates under the badge (flipped above when there is no room) and kept
	 * on screen. Keyboard: Enter/Space/ArrowDown opens, arrows/Home/End move, Enter picks, Escape
	 * closes and returns focus to the badge, Tab closes. `onpick` runs after the menu has closed
	 * and focus is back on the badge, so a dialog opened from it restores focus here.
	 */
	let {
		label,
		status,
		options = [],
		onpick,
		interactive = true,
		testid,
		optionPrefix = 'status-option',
		small = false
	}: {
		/** What the badge is for, in the accessible name: "Plate 2", "Handle Right". */
		label: string;
		/** The status text shown on the badge. */
		status: string;
		/** Statuses offered in the menu. */
		options?: string[];
		onpick?: (status: string) => void;
		interactive?: boolean;
		testid: string;
		optionPrefix?: string;
		small?: boolean;
	} = $props();

	const uid = $props.id();
	let open = $state(false);
	let btn = $state<HTMLButtonElement>();

	const tone = $derived(
		status === 'Printing'
			? 'ds-badge--run'
			: status === 'Printed'
				? 'ds-badge--ok'
				: status === 'Reprint'
					? 'ds-badge--bad'
					: status === 'Partly printed'
						? 'ds-badge--warn'
						: ''
	);
	const live = $derived(interactive && options.some((o) => o !== status));

	function close(back: boolean) {
		open = false;
		if (back) btn?.focus({ preventScroll: true });
	}
	function pick(s: string) {
		close(true);
		if (s !== status) onpick?.(s);
	}

	/** Place the popover under the badge, on screen, then focus the checked (else first) item. */
	function popup(node: HTMLElement) {
		node.showPopover();
		const a = btn!.getBoundingClientRect();
		const w = node.offsetWidth;
		const h = node.offsetHeight;
		const vw = document.documentElement.clientWidth;
		const vh = window.innerHeight;
		const left = Math.max(8, Math.min(a.left, vw - w - 8));
		const below = a.bottom + 4;
		const top = below + h + 8 <= vh || a.top - h - 4 < 8 ? below : a.top - h - 4;
		node.style.left = `${left}px`;
		node.style.top = `${Math.max(8, top)}px`;
		const items = node.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
		(node.querySelector<HTMLElement>('[aria-checked="true"]') ?? items[0])?.focus({
			preventScroll: true
		});
		return {
			destroy() {
				if (node.matches(':popover-open')) node.hidePopover();
			}
		};
	}

	function onmenukey(e: KeyboardEvent) {
		const items = [
			...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitemradio"]')
		];
		const i = items.indexOf(document.activeElement as HTMLElement);
		const go = (n: number) => {
			e.preventDefault();
			items[(n + items.length) % items.length]?.focus();
		};
		if (e.key === 'ArrowDown') go(i + 1);
		else if (e.key === 'ArrowUp') go(i - 1);
		else if (e.key === 'Home') go(0);
		else if (e.key === 'End') go(items.length - 1);
		else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close(true);
		} else if (e.key === 'Tab') close(false);
	}
	function onbtnkey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' && !open) {
			e.preventDefault();
			open = true;
		}
	}
	function outside(e: Event) {
		if (!open) return;
		const t = e.target as Node;
		if (btn?.contains(t) || document.getElementById(`${uid}-menu`)?.contains(t)) return;
		close(false);
	}
</script>

<svelte:window onpointerdown={outside} onresize={() => close(false)} />

{#if live}
	<button
		bind:this={btn}
		class="ds-badge sb-badge {tone}"
		class:sb-sm={small}
		type="button"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? `${uid}-menu` : undefined}
		aria-label="{label} status: {status}. Change status"
		data-testid={testid}
		data-status={status}
		onclick={() => (open ? close(false) : (open = true))}
		onkeydown={onbtnkey}
		><span>{status}</span><span class="sb-caret" aria-hidden="true">▾</span></button
	>
	{#if open}
		<div
			id="{uid}-menu"
			class="sb-menu"
			popover="manual"
			role="menu"
			aria-label="{label} status"
			tabindex="-1"
			data-testid="status-menu"
			use:popup
			onkeydown={onmenukey}
		>
			{#each options as o (o)}
				<button
					class="sb-item"
					type="button"
					role="menuitemradio"
					aria-checked={o === status}
					data-testid="{optionPrefix}-{o}"
					onclick={() => pick(o)}
				>
					<span class="sb-mark" aria-hidden="true">{o === status ? '✓' : ''}</span>{o}
				</button>
			{/each}
		</div>
	{/if}
{:else}
	<span
		class="ds-badge sb-badge sb-static {tone}"
		class:sb-sm={small}
		data-testid={testid}
		data-status={status}
		title="{label} status: {status}">{status}</span
	>
{/if}

<style>
	.sb-badge {
		box-sizing: border-box;
		font-weight: 600;
		white-space: nowrap;
		min-height: 30px;
	}
	.sb-sm {
		padding-block: var(--sp-2);
		font-size: var(--fs-sm);
		min-height: 28px;
	}
	.sb-caret {
		font-size: 0.8em;
		opacity: 0.8;
	}
	@media (pointer: coarse), (max-width: 760px) {
		button.sb-badge {
			min-height: 44px;
			padding-inline: var(--sp-7);
		}
	}
	.sb-menu {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: var(--sp-2);
		min-width: 11rem;
		max-width: calc(100vw - 16px);
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-2, 0 8px 24px rgb(0 0 0 / 0.22));
		display: grid;
		gap: 2px;
	}
	.sb-item {
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		text-align: left;
		border: 0;
		background: transparent;
		color: inherit;
		font: 600 var(--fs-base) / 1.2 var(--f-body);
		padding: var(--sp-5) var(--sp-6);
		min-height: 36px;
		border-radius: var(--r-md);
		cursor: pointer;
	}
	@media (pointer: coarse), (max-width: 760px) {
		.sb-item {
			min-height: 44px;
		}
	}
	.sb-item:hover,
	.sb-item:focus-visible {
		background: var(--accent-soft);
		outline: none;
	}
	.sb-item:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.sb-mark {
		display: inline-block;
		width: 1em;
		color: var(--accent);
	}
</style>
