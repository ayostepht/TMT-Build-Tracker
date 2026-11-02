import { subscribeBuildEvents, type BuildEvent } from '../events';

/** Collects events for a build (test helper). */
export function onBuildEvents(buildId: string): BuildEvent[] {
	const out: BuildEvent[] = [];
	subscribeBuildEvents(buildId, (e) => out.push(e));
	return out;
}
