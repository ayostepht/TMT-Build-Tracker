/**
 * The two "Test" routes (`/api/printers/test`, `/api/printers/camera-test`) make the server dial
 * a destination the caller typed, so each user gets a small token bucket of their own (10 a minute,
 * a burst of 5). It reuses the write limiter's public bucket function under its own key, so it
 * neither shares nor spends the general write budget. On a hosted site every refusal or failure
 * about a shared link reads the same, so the route cannot confirm a guessed link.
 */
import { ApiError } from '../access';
import { isPublicMode } from '../config';
import { takeWriteToken } from '../write-rate';
import { OutboundError } from './outbound';

export const TEST_RATE = { perMin: 10, burst: 5 } as const;

/** 429 when the user has run too many tests lately. */
export function limitTests(userId: string, now = Date.now()): void {
	const wait = takeWriteToken(`printer-test:${userId}`, TEST_RATE, now);
	if (wait > 0) throw new ApiError(429, `Too many tests. Try again in ${wait} seconds.`);
}

/** The one sentence a hosted site gives for every link that could not be used. */
export const HOSTED_LINK_FAILURE = 'Could not reach a printer through that link. Check the link.';

/** On a hosted site, any outbound refusal about the destination becomes the same sentence. */
export function uniformHostedFailure<T>(run: () => Promise<T>): Promise<T> {
	return run().catch((e) => {
		if (isPublicMode() && e instanceof OutboundError) throw new ApiError(400, HOSTED_LINK_FAILURE);
		throw e;
	});
}

/** Camera test on a hosted site: unreachable link, no camera and a failed frame all read the same. */
export const HOSTED_CAMERA_FAILURE =
	'No camera picture came through that link. Check the link and that the printer has a camera.';
