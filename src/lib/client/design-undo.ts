import { designSnapshot, undoPatch, type DesignSnapshot } from '#lib/domain/design-apply.ts';
import { toasts } from '#lib/components/toast.svelte.ts';
import { getView, setBuildDesign } from './api.ts';

/** How long the Undo toast after applying a design to a started build stays (ms). */
const UNDO_MS = 15000;

/** The build's colors, part colors and locks as they are now (fresh from the server). */
export async function snapshotBuild(buildId: string): Promise<DesignSnapshot> {
	return designSnapshot(await getView(buildId));
}

/**
 * Toast with Undo for a design change on a started build. Undo puts `before` back in one
 * `PATCH .../design` call (old filaments, every part's slot, locks, and `removeRoles` for slots added
 * since); `after` runs once it is done (e.g. refresh the view). A failure shows as a toast.
 */
export function offerDesignUndo(
	text: string,
	buildId: string,
	before: DesignSnapshot,
	after?: () => Promise<unknown> | unknown
): void {
	toasts.push(
		text,
		{
			label: 'Undo',
			run: async () => {
				try {
					await setBuildDesign(buildId, undoPatch(before, await getView(buildId)));
					toasts.push('Undone', undefined, 4000);
				} catch (e) {
					toasts.push(e instanceof Error ? e.message : 'Could not undo that.', undefined, 6000);
				}
				await after?.();
			}
		},
		UNDO_MS
	);
}
