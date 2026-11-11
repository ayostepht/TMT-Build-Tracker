import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const calls: Array<(v: unknown) => void> = [];
const fails: Array<(e: unknown) => void> = [];
vi.mock('./api.ts', () => ({
	buildPrinterJobs: () =>
		new Promise((res, rej) => {
			calls.push(res);
			fails.push(rej);
		}),
	listPrinters: vi.fn()
}));
import { PrinterStore } from './printer-store.svelte.ts';

beforeEach(() => {
	calls.length = 0;
	fails.length = 0;
});

describe('PrinterStore.load', () => {
	it('ignores a stale response that lands after a newer one', async () => {
		const s = new PrinterStore('o', 'b');
		const a = s.load();
		const b = s.load();
		calls[1]({ printers: [], jobs: [{ id: 'j1' }] });
		await b;
		calls[0]({ printers: [], jobs: [] });
		await a;
		expect(s.jobs).toHaveLength(1);
	});
	it('records an error and recovers on retry', async () => {
		const s = new PrinterStore('o', 'b');
		const a = s.load();
		fails[0](new Error('boom'));
		await a;
		expect(s.error).toBe('boom');
		const b = s.load();
		calls[1]({ printers: [], jobs: [{ id: 'j1' }] });
		await b;
		expect(s.error).toBeNull();
		expect(s.jobs).toHaveLength(1);
	});
});

class FakeEventSource {
	static all: FakeEventSource[] = [];
	closed = false;
	onopen: (() => void) | null = null;
	onmessage: ((m: { data: string }) => void) | null = null;
	constructor(readonly url: string) {
		FakeEventSource.all.push(this);
	}
	close() {
		this.closed = true;
	}
}

describe('PrinterStore shared org stream', () => {
	beforeEach(() => {
		FakeEventSource.all = [];
		vi.stubGlobal('EventSource', FakeEventSource);
	});
	afterEach(() => vi.unstubAllGlobals());
	const open = () => FakeEventSource.all.filter((e) => !e.closed);

	it('two consumers of one org share one EventSource', () => {
		const a = new PrinterStore('o1', 'b1');
		const b = new PrinterStore('o1', 'b2');
		const ra = a.acquire();
		const rb = b.acquire();
		expect(FakeEventSource.all).toHaveLength(1);
		expect(FakeEventSource.all[0].url).toContain('org=o1');
		ra();
		rb();
	});

	it('releasing one keeps the stream open; the last release closes it', () => {
		const a = new PrinterStore('o2', 'b1');
		const b = new PrinterStore('o2');
		const ra = a.acquire();
		const rb = b.acquire();
		ra();
		expect(open()).toHaveLength(1);
		rb();
		expect(open()).toHaveLength(0);
		// A new consumer afterwards opens a fresh stream.
		const rc = new PrinterStore('o2').acquire();
		expect(FakeEventSource.all).toHaveLength(2);
		rc();
	});

	it('a different org gets its own stream', () => {
		const ra = new PrinterStore('o3', 'b1').acquire();
		const rb = new PrinterStore('o4', 'b1').acquire();
		expect(open()).toHaveLength(2);
		expect(FakeEventSource.all.map((e) => e.url).sort()).toEqual([
			'/api/printers/events?org=o3',
			'/api/printers/events?org=o4'
		]);
		ra();
		expect(open()).toHaveLength(1);
		rb();
		expect(open()).toHaveLength(0);
	});

	it('refetches every store on stream open and fans a status event out to all', async () => {
		const a = new PrinterStore('o5', 'b1');
		const b = new PrinterStore('o5', 'b2');
		a.printers = [{ id: 'p', status: null } as never];
		b.printers = [{ id: 'p', status: null } as never];
		const ra = a.acquire();
		const rb = b.acquire();
		expect(calls).toHaveLength(2); // initial loads
		FakeEventSource.all[0].onopen?.();
		expect(calls).toHaveLength(4); // one refetch per store
		FakeEventSource.all[0].onmessage?.({
			data: JSON.stringify({ type: 'status', printerId: 'p', status: { state: 'printing' } })
		});
		expect(a.status('p')).toEqual({ state: 'printing' });
		expect(b.status('p')).toEqual({ state: 'printing' });
		ra();
		rb();
	});
});
