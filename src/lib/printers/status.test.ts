import { describe, expect, it } from 'vitest';
import { splitTeamJobs, unloggedEndedJobs, unloggedNotice, type PrinterJobView } from './status.ts';

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

describe('unloggedEndedJobs', () => {
	const ended = (id: string, over: Partial<PrinterJobView> = {}) =>
		job(id, { buildId: 'b1', plateNumber: 9, status: 'failed', pendingConfirm: true, ...over });

	it('finds unlogged ended jobs on the same build and plate', () => {
		const jobs = [
			ended('a'),
			ended('logged', { pendingConfirm: false, runId: 'r1' }),
			ended('dismissed', { pendingConfirm: false, runId: 'dismissed' }),
			ended('other-plate', { plateNumber: 8 }),
			ended('other-build', { buildId: 'b2' }),
			job('running', { buildId: 'b1', plateNumber: 9, status: 'printing' })
		];
		expect(unloggedEndedJobs(jobs, 'b1', 9).map((j) => j.id)).toEqual(['a']);
	});
	it('needs overlapping parts when both sides name some', () => {
		const jobs = [ended('x', { partSlugs: ['left'] }), ended('y', { partSlugs: ['right'] })];
		expect(unloggedEndedJobs(jobs, 'b1', 9, ['right']).map((j) => j.id)).toEqual(['y']);
		expect(unloggedEndedJobs(jobs, 'b1', 9).map((j) => j.id)).toEqual(['x', 'y']);
		expect(unloggedEndedJobs([ended('z')], 'b1', 9, ['left']).map((j) => j.id)).toEqual(['z']);
	});
	it('skips the job being linked', () => {
		expect(unloggedEndedJobs([ended('a')], 'b1', 9, null, 'a')).toEqual([]);
	});
	it('words the notice by how the job ended', () => {
		expect(unloggedNotice(ended('a'), '4:04 PM')).toBe(
			'Plate 9 has an unlogged failed print from 4:04 PM.'
		);
		expect(unloggedNotice(ended('a', { status: 'done' }), '')).toBe(
			'Plate 9 has an unlogged earlier print.'
		);
	});
});
