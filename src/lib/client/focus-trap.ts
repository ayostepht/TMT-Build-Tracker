/**
 * Focus handling for modals and sheets: one helper instead of a copy per component.
 *
 * `use:trapFocus` on the dialog element:
 *  - on open, moves focus into it (the `initial` selector, else the first focusable, else the
 *    element itself, which needs tabindex="-1"),
 *  - keeps Tab / Shift+Tab inside it (and pulls stray focus back),
 *  - on close, restores focus to the element that had it before.
 * Traps stack: with a confirmation open on top of a viewer, only the top one is active.
 * Escape stays with the component (it knows what "close" means).
 */

export const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Index to focus when Tab / Shift+Tab leaves the ends of a list of `count` focusables. */
export function wrapTarget(count: number, current: number, shift: boolean): number | null {
	if (count <= 0) return null;
	if (current < 0) return shift ? count - 1 : 0;
	if (shift && current === 0) return count - 1;
	if (!shift && current === count - 1) return 0;
	return null;
}

const stack: HTMLElement[] = [];

/** True when `node` is the innermost open trap (or no trap is registered for it at all). */
export function isTopTrap(node: HTMLElement | undefined): boolean {
	return !node || stack.length === 0 || stack[stack.length - 1] === node;
}

function focusables(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) => el.offsetParent !== null || el === document.activeElement
	);
}

export type TrapOptions = {
	/** CSS selector of the element to focus first (default: the first focusable). */
	initial?: string;
	/** Restore focus to the opener on close (default true). */
	restore?: boolean;
};

export function trapFocus(node: HTMLElement, options: TrapOptions = {}) {
	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	stack.push(node);

	const target =
		(options.initial ? node.querySelector<HTMLElement>(options.initial) : null) ??
		focusables(node)[0] ??
		node;
	target.focus({ preventScroll: true });

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab' || stack[stack.length - 1] !== node) return;
		const els = focusables(node);
		if (!els.length) {
			e.preventDefault();
			node.focus();
			return;
		}
		const at = wrapTarget(
			els.length,
			els.indexOf(document.activeElement as HTMLElement),
			e.shiftKey
		);
		if (at !== null) {
			e.preventDefault();
			els[at].focus();
		}
	}
	function onfocusin(e: FocusEvent) {
		if (stack[stack.length - 1] !== node) return;
		if (e.target instanceof Node && !node.contains(e.target)) (focusables(node)[0] ?? node).focus();
	}
	document.addEventListener('keydown', onkeydown);
	document.addEventListener('focusin', onfocusin);

	return {
		destroy() {
			document.removeEventListener('keydown', onkeydown);
			document.removeEventListener('focusin', onfocusin);
			const i = stack.lastIndexOf(node);
			if (i >= 0) stack.splice(i, 1);
			if (options.restore !== false && opener && opener.isConnected) opener.focus();
		}
	};
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
