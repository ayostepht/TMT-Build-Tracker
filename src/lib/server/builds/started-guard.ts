import { ApiError } from '../access';
import { startedSummary } from '#lib/domain/started.ts';
import type { BuildView, StartedInfo } from '#lib/domain/types.ts';

/**
 * Refusal for a change that would replace plates or the design under a build that has started
 * printing. `respond()` renders it as HTTP 409
 * `{ error, code: 'build-started', started: StartedInfo, summary: string }`; the client's
 * `ApiError` carries it as `status` 409, `code` 'build-started' and `body.started`.
 */
export class BuildStartedError extends ApiError {
	readonly code = 'build-started';
	readonly extra: { started: StartedInfo; summary: string };
	constructor(started: StartedInfo, message: string) {
		super(409, message);
		this.extra = { started, summary: startedSummary(started) };
	}
}

/** Throw `BuildStartedError` when the build has started; otherwise do nothing. */
export function refuseIfStarted(view: Pick<BuildView, 'started'>, message: string): void {
	if (view.started.started) throw new BuildStartedError(view.started, message);
}
