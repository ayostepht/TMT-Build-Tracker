import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ building: false }));
vi.mock('#lib/server/auth-instance.ts', () => ({ getAuth: () => ({}) }));
vi.mock('#lib/server/startup.ts', () => ({ startup: () => {} }));

import { handleError } from './hooks.server.ts';

describe('handleError', () => {
	afterEach(() => vi.restoreAllMocks());

	it('logs the safe text for a Drizzle-like error and returns a generic message', async () => {
		const err = Object.assign(
			new Error('Failed query: select 1 where email = $1\nparams: secret@example.test'),
			{
				name: 'DrizzleQueryError',
				params: ['secret@example.test'],
				cause: new Error('secret@example.test')
			}
		);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const out = await (handleError as (i: unknown) => unknown)({
			error: err,
			event: {},
			kind: 'unknown'
		});
		const logged = JSON.stringify(spy.mock.calls);
		expect(logged).toContain('DrizzleQueryError');
		expect(logged).toContain('Failed query');
		expect(logged).not.toContain('secret@example.test');
		expect(out).toBeUndefined();
	});

	it('does not log app or framework errors', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		for (const kind of ['app', 'framework']) {
			await (handleError as (i: unknown) => unknown)({
				error: { status: 404, message: 'Not Found' },
				event: {},
				kind
			});
		}
		expect(spy).not.toHaveBeenCalled();
	});
});
