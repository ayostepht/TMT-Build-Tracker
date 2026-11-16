import { ApiError } from './api.ts';
import type { StartedInfo } from '#lib/domain/types.ts';
import type { createAsk } from './ask.svelte.ts';

/** The 409 `build-started` answer of a call that would renumber the plates, or null for any other error. */
export function startedConflict(e: unknown): { message: string; live: boolean } | null {
	if (!(e instanceof ApiError) || e.status !== 409 || e.code !== 'build-started') return null;
	const started = e.body.started as StartedInfo | undefined;
	return { message: e.message, live: (started?.liveJobs ?? 0) > 0 };
}

export type GuardedResult<T> =
	| { done: true; value: T }
	/** The person said no to the prompt. */
	| { done: false; refused: null }
	/** A live printer job blocks the change; `refused` is the sentence to show (no override). */
	| { done: false; refused: string };

/**
 * Runs a plate-replacing call. A live printer job refuses it (nothing to confirm); a started build
 * asks once and retries with `confirm = true`. Other errors are rethrown.
 */
export async function withStartedConfirm<T>(
	ask: ReturnType<typeof createAsk>,
	run: (confirm: boolean) => Promise<T>,
	opts: { title: string; confirmLabel: string }
): Promise<GuardedResult<T>> {
	try {
		return { done: true, value: await run(false) };
	} catch (e) {
		const c = startedConflict(e);
		if (!c) throw e;
		if (c.live) return { done: false, refused: c.message };
		if (!(await ask.ask(`${c.message}\n\nContinue?`, opts))) return { done: false, refused: null };
		return { done: true, value: await run(true) };
	}
}
