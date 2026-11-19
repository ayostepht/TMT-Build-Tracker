import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescer } from './coalesce.ts';

describe('createCoalescer', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('runs only the latest of a burst, after the delay', async () => {
		const c = createCoalescer(100);
		const ran: number[] = [];
		for (let i = 1; i <= 5; i++) c.schedule(async () => void ran.push(i));
		await vi.advanceTimersByTimeAsync(99);
		expect(ran).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(ran).toEqual([5]);
	});

	it('never runs two at once; updates during a run collapse into one follow-up', async () => {
		const c = createCoalescer(10);
		let active = 0;
		let maxActive = 0;
		const ran: number[] = [];
		const resolvers: (() => void)[] = [];
		const task = (n: number) => () =>
			new Promise<void>((res) => {
				active++;
				maxActive = Math.max(maxActive, active);
				ran.push(n);
				resolvers.push(() => {
					active--;
					res();
				});
			});
		c.schedule(task(1));
		await vi.advanceTimersByTimeAsync(10);
		expect(ran).toEqual([1]);
		c.schedule(task(2));
		c.schedule(task(3));
		await vi.advanceTimersByTimeAsync(50);
		expect(ran).toEqual([1]); // still waiting for the first
		resolvers[0]();
		await vi.advanceTimersByTimeAsync(10);
		expect(ran).toEqual([1, 3]);
		resolvers[1]();
		await vi.advanceTimersByTimeAsync(50);
		expect(ran).toEqual([1, 3]);
		expect(maxActive).toBe(1);
	});

	it('keeps going after a task rejects, and cancel drops the waiting task', async () => {
		const c = createCoalescer(10);
		const ran: string[] = [];
		c.schedule(async () => {
			ran.push('a');
			throw new Error('boom');
		});
		await vi.advanceTimersByTimeAsync(10);
		c.schedule(async () => void ran.push('b'));
		await vi.advanceTimersByTimeAsync(10);
		expect(ran).toEqual(['a', 'b']);
		c.schedule(async () => void ran.push('c'));
		c.cancel();
		await vi.advanceTimersByTimeAsync(100);
		expect(ran).toEqual(['a', 'b']);
	});
});
