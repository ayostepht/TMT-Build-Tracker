import { ApiError } from '#lib/server/access.ts';
import { respond } from '#lib/server/api.ts';
import { getDb } from '#lib/server/db/index.ts';
import { requireAdminForTemplate } from '#lib/server/models/guard.ts';
import { getJob } from '#lib/server/models/jobs.ts';
import type { RequestHandler } from './$types';

/** Site admin: progress of a conversion job (poll every second or two). */
export const GET: RequestHandler = (event) =>
	respond(() => {
		requireAdminForTemplate(event, event.params.id);
		const job = getJob(getDb(), event.params.id, event.params.jobId);
		if (!job) throw new ApiError(404, 'Not found');
		return {
			job: {
				id: job.id,
				status: job.status,
				progress: job.progress,
				// While queued the message only holds the uploaded file name.
				message: job.status === 'queued' ? 'Waiting in the queue' : job.message,
				report: job.report,
				createdAt: job.createdAt.toISOString(),
				finishedAt: job.finishedAt?.toISOString() ?? null
			}
		};
	});
