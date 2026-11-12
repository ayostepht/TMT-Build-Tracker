/**
 * Focus helpers for inline (non-modal) confirmation panels that replace the button that opened
 * them: `focusIn` and `use:inlineConfirm`.
 */

export const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) => el.offsetParent !== null || el === document.activeElement
	);
}

/**
 * For inline (non-modal) confirmation panels that replace the button that opened them: focus
 * would otherwise fall to the page when that button disappears, so move it onto the panel.
 */
export function focusIn(node: HTMLElement, initial?: string) {
	const target =
		(initial ? node.querySelector<HTMLElement>(initial) : null) ?? focusables(node)[0] ?? node;
	target.focus({ preventScroll: true });
}

export type InlineConfirmOptions = {
	/** CSS selector of the element to focus first (default: the first focusable). */
	initial?: string;
	/** Called on Escape (and only then): close the panel. */
	oncancel: () => void;
	/**
	 * The button that opens the panel. When the panel goes away while focus is lost (the page
	 * body has it), focus goes back there once it is rendered again.
	 */
	returnTo?: () => HTMLElement | null | undefined;
};

/**
 * Inline confirmation panel that replaces its trigger: focuses into the panel, closes on Escape
 * and, when the panel is removed and focus fell to the page, hands focus back to the trigger.
 */
export function inlineConfirm(node: HTMLElement, options: InlineConfirmOptions) {
	let opts = options;
	focusIn(node, opts.initial);

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		e.preventDefault();
		e.stopPropagation();
		opts.oncancel();
	}
	node.addEventListener('keydown', onkeydown);

	return {
		update(next: InlineConfirmOptions) {
			opts = next;
		},
		destroy() {
			node.removeEventListener('keydown', onkeydown);
			// The trigger is rendered again after this panel is gone: wait for it.
			setTimeout(() => {
				const active = document.activeElement;
				if (active && active !== document.body) return;
				opts.returnTo?.()?.focus({ preventScroll: true });
			}, 0);
		}
	};
}

/**
 * Focus return for a native <dialog> opened with showModal() inside a Svelte action. Call it
 * before showModal() (it records the opener), and call the returned function from the action's
 * `destroy`: an unmounted <dialog> gets no native focus restore, only Escape does. The opener is
 * refocused only when focus is lost (on <body> or inside the closing dialog), so a native Escape
 * restore is not repeated and a deliberate focus move elsewhere is not stolen. It runs now and
 * again after a tick, because the opener may be re-rendered after a form action. If the opener is
 * gone by then (e.g. the photo it showed was deleted), `fallback` picks another target.
 */
export function rememberOpener(
	fallback?: () => HTMLElement | null | undefined
): (dialog: HTMLElement) => void {
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	return (dialog) => {
		const lost = () => {
			const a = document.activeElement;
			return !a || a === document.body || dialog.contains(a);
		};
		const restore = (useFallback: boolean) => {
			if (!lost()) return;
			const target = opener?.isConnected ? opener : useFallback ? fallback?.() : null;
			if (target?.isConnected) target.focus({ preventScroll: true });
		};
		restore(false);
		setTimeout(() => restore(true), 0);
	};
}
