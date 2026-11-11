/** Promise-based yes/no question for the shared Dialog (replaces the browser's confirm()). */
export type AskOptions = { title?: string; confirmLabel?: string; cancelLabel?: string };
export type AskState = {
	message: string;
	title: string;
	confirmLabel: string;
	cancelLabel: string;
	resolve: (yes: boolean) => void;
};

export function createAsk() {
	let current = $state<AskState | null>(null);
	return {
		get current() {
			return current;
		},
		/** Resolves true on confirm, false on cancel, Escape or backdrop. */
		ask(message: string, opts: AskOptions = {}): Promise<boolean> {
			current?.resolve(false);
			return new Promise<boolean>((res) => {
				current = {
					message,
					title: opts.title ?? 'Are you sure?',
					confirmLabel: opts.confirmLabel ?? 'Continue',
					cancelLabel: opts.cancelLabel ?? 'Cancel',
					resolve: (yes) => {
						current = null;
						res(yes);
					}
				};
			});
		}
	};
}
