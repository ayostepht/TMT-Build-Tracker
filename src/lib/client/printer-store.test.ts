import { describe, expect, it, vi, beforeEach } from 'vitest';

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
