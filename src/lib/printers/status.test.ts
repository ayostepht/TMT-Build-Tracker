import { describe, expect, it } from 'vitest';
import { splitTeamJobs, type PrinterJobView } from './status.ts';

const job = (id: string, over: Partial<PrinterJobView>): PrinterJobView => ({
	id,
	printerId: 'p',
	printerName: 'Shop printer',
	buildId: null,
	plateNumber: null,
	partSlugs: null,
	fileName: `${id}.gcode`,
	status: 'done',
	progress: 100,
	startedAt: null,
	finishedAt: null,
	runId: null,
	pendingConfirm: false,
	...over
});

describe('splitTeamJobs', () => {
	it('lists linked and running jobs, hides older unlinked ones', () => {
		const { shown, other } = splitTeamJobs([
			job('linked', { buildId: 'b', plateNumber: 2 }),
			job('running', { status: 'printing' }),
			job('paused', { status: 'paused' }),
			job('cancelled', { status: 'cancelled' }),
			job('failed', { status: 'failed' }),
			job('done', {})
		]);
		expect(shown.map((j) => j.id)).toEqual(['linked', 'running', 'paused']);
		expect(other.map((j) => j.id)).toEqual(['cancelled', 'failed', 'done']);
	});
	it('has nothing in other when every job is linked', () => {
		expect(splitTeamJobs([job('a', { buildId: 'b' })]).other).toEqual([]);
	});
});
