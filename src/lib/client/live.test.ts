import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESYNC_THROTTLE_MS, subscribeBuild } from './live.ts';

class FakeES {
	static CLOSED = 2;
	static instances: FakeES[] = [];
	readyState = 1;
	onopen: (() => void) | null = null;
	onmessage: ((m: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(public url: string) {
		FakeES.instances.push(this);
	}
	close() {
		this.readyState = 2;
	}
}

class Target {
	l = new Map<string, Set<() => void>>();
	visibilityState = 'visible';
	addEventListener(t: string, f: () => void) {
		(this.l.get(t) ?? this.l.set(t, new Set()).get(t)!).add(f);
	}
	removeEventListener(t: string, f: () => void) {
		this.l.get(t)?.delete(f);
	}
	fire(t: string) {
		this.l.get(t)?.forEach((f) => f());
	}
	count() {
		return [...this.l.values()].reduce((a, s) => a + s.size, 0);
	}
}

describe('subscribeBuild resync', () => {
	let doc: Target;
	let win: Target;
	beforeEach(() => {
		vi.useFakeTimers();
		FakeES.instances = [];
		doc = new Target();
		win = new Target();
		vi.stubGlobal('EventSource', FakeES);
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', win);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('does not resync on the first open, does after a reconnect', () => {
		const onResync = vi.fn();
		subscribeBuild('b1', () => {}, { onResync });
		FakeES.instances[0].onopen!();
		expect(onResync).not.toHaveBeenCalled();
		FakeES.instances[0].onerror!();
		FakeES.instances[0].readyState = 2;
		FakeES.instances[0].onerror!();
		vi.advanceTimersByTime(5000);
		FakeES.instances[1].onopen!();
		expect(onResync).toHaveBeenCalledTimes(1);
	});

	it('resyncs on visible/online/focus, throttled to one, never while hidden', () => {
		const onResync = vi.fn();
		subscribeBuild('b1', () => {}, { onResync });
		doc.visibilityState = 'hidden';
		doc.fire('visibilitychange');
		expect(onResync).not.toHaveBeenCalled();
		doc.visibilityState = 'visible';
		doc.fire('visibilitychange');
		win.fire('online');
		win.fire('focus');
		expect(onResync).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(RESYNC_THROTTLE_MS + 1);
		win.fire('focus');
		expect(onResync).toHaveBeenCalledTimes(2);
	});

	it('removes listeners on unsubscribe', () => {
		const onResync = vi.fn();
		const off = subscribeBuild('b1', () => {}, { onResync });
		expect(doc.count() + win.count()).toBe(3);
		off();
		expect(doc.count() + win.count()).toBe(0);
		win.fire('focus');
		expect(onResync).not.toHaveBeenCalled();
	});
});
