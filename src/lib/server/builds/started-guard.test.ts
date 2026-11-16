import { describe, expect, it } from 'vitest';
import { makeView, applyPatches } from '#lib/domain/fixtures.ts';
import { respond } from '../api';
import { refuseIfStarted } from './started-guard';

describe('refuseIfStarted', () => {
	it('does nothing for a build that has not started', () => {
		expect(() => refuseIfStarted(makeView(), 'no')).not.toThrow();
	});
	it('renders as 409 { error, code, started, summary }', async () => {
		const view = applyPatches(makeView(), [{ slug: makeView().parts[0].slug, status: 'Printing' }]);
		const res = await respond(() => refuseIfStarted(view, 'This build has started printing.'));
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body).toMatchObject({
			error: 'This build has started printing.',
			code: 'build-started',
			started: { started: true, printingParts: 1 }
		});
		expect(typeof body.summary).toBe('string');
	});
});
