import { EventEmitter } from 'node:events';

export interface BuildEvent {
	type: 'changed';
	kind: string;
	by: string | null;
	at: string;
}

/** In-process pub/sub keyed by build id. Single container, so no external broker. */
const KEY = Symbol.for('tmt.build-events');
type G = typeof globalThis & { [KEY]?: EventEmitter };
const g = globalThis as G;
const bus = (g[KEY] ??= new EventEmitter().setMaxListeners(0));

export function emitBuildEvent(buildId: string, event: BuildEvent): void {
	bus.emit(buildId, event);
}

/** Returns an unsubscribe function. */
export function subscribeBuildEvents(buildId: string, fn: (e: BuildEvent) => void): () => void {
	bus.on(buildId, fn);
	return () => bus.off(buildId, fn);
}
