/**
 * Keeps a text box in step with a prop without overwriting what the maker is typing.
 *
 * A re-render that lands while the box has focus or holds an edit (their own save of another box still in
 * flight, or another member's change arriving) must not replace the half-typed text: the box would read the
 * old value, no `change` would fire on blur and the typed value would be lost. So the DOM value is written by
 * an effect that skips a focused or edited box. After a blur without a commit the box falls back to the
 * prop; after a commit it keeps the text until the saved value arrives.
 */
export function followProp(el: () => HTMLInputElement | undefined, text: () => string) {
	let edited = false;
	let committed = false;
	$effect(() => {
		const t = text(); // tracked: runs again when the prop changes
		const node = el();
		if (!node || edited || document.activeElement === node) return;
		if (node.value !== t) node.value = t;
	});
	const sync = () => {
		const node = el();
		if (node && node.value !== text()) node.value = text();
	};
	return {
		input() {
			edited = true;
			committed = false;
		},
		/** Call when the `change` event fires: the edit is being saved. */
		committed() {
			committed = true;
		},
		blur() {
			// an edit that was not committed is abandoned: show the stored value again
			if (!committed) sync();
			edited = false;
			committed = false;
		},
		/** Escape: drop the edit and show the stored value. */
		abandon() {
			edited = false;
			committed = false;
			sync();
			el()?.blur();
		}
	};
}
