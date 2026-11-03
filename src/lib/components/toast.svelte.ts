/** Tiny toast queue. Lives outside any one page so a toast survives the card that caused it disappearing. */
export interface ToastItem {
	id: number;
	text: string;
	/** Optional action button (e.g. Undo). */
	action?: { label: string; run: () => Promise<void> | void };
}

class Toasts {
	items = $state<ToastItem[]>([]);
	#n = 0;

	push(text: string, action?: ToastItem['action'], ms = 8000): number {
		const id = ++this.#n;
		this.items = [...this.items, { id, text, action }];
		setTimeout(() => this.dismiss(id), ms);
		return id;
	}
	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
