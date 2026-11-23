/**
 * The checks every 3MF upload route makes around `receiveThreeMf`, in one place: the per-user upload slot
 * (429), then "already over the upload space?" (409); the disk floor (507) is checked inside the receive.
 * The slot is released whatever happens.
 */
import { diskHasRoom } from '../config';
import type { Db } from '../db';
import { acquireUploadSlot, assertUploadRoom } from '../quota';
import { receiveThreeMf, type ReceiveOptions } from './upload';

export async function guardedReceiveThreeMf<T>(
	db: Db,
	args: {
		user: Parameters<typeof acquireUploadSlot>[1];
		userId: string;
		organizationId: string;
		request: Request;
		name: string | null;
		receive?: Omit<ReceiveOptions, 'hasRoom'>;
	},
	use: (up: Awaited<ReturnType<typeof receiveThreeMf>>) => T | Promise<T>
): Promise<T> {
	const release = acquireUploadSlot(db, args.user);
	try {
		assertUploadRoom(db, args.organizationId, 0, { userId: args.userId });
		const up = await receiveThreeMf(args.request, args.name, {
			...args.receive,
			hasRoom: diskHasRoom
		});
		return await use(up);
	} finally {
		release();
	}
}
