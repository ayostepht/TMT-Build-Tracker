/** Test helpers for the socket seam (`ws-client.ts`): put a fake or loopback-redirecting class in place of `ws`. */
import { setSocketFactory, type SocketPin } from './ws-client';

/** Every socket the adapters open is `new Cls(url)` (the class may ignore the URL). `pin` is recorded on `pins`. */
export function useFakeSocket(Cls: new (url: string) => unknown, pins?: (SocketPin | undefined)[]) {
	setSocketFactory(((url: string, opts?: { pin?: SocketPin }) => {
		pins?.push(opts?.pin);
		return new Cls(url);
	}) as never);
}

export const resetFakeSocket = () => setSocketFactory(null);
