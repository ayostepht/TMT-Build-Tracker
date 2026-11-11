import type { PrinterKind } from '#lib/printers/status.ts';
import { shareLinkOf, SHARE_LINK_HOST_PLACEHOLDER } from '#lib/printers/share-link.ts';
import { isPublicMode } from '../../config';
import { PUBLIC_MODE_MESSAGE } from '../outbound';
import { StatusSubject, type AdapterHandle, type ConnectFn, type PrinterConfig } from '../types';
import { connectBambu } from './bambu';
import { connectMoonraker } from './moonraker';
import { connectOctoprint } from './octoprint';
import { connectSdcp } from './sdcp';

/** An adapter handle that reports one status and never opens a socket. */
function idle(message: string, state: 'error' | 'offline'): AdapterHandle {
	const subj = new StatusSubject();
	subj.emit({ state, progress: null, message });
	return {
		status$: (cb) => subj.subscribe(cb),
		close: () => {
			subj.closed = true;
		}
	};
}

/**
 * Public mode: no adapter ever opens a socket. The placeholder host means "reached through an
 * OctoEverywhere link"; without a usable link (secrets lost after a key rotation, wrong printer
 * type) it is not a real host: never dial it, report offline with a clear message instead.
 */
function guarded(connect: ConnectFn): ConnectFn {
	return (cfg: PrinterConfig): AdapterHandle => {
		if (isPublicMode()) return idle(PUBLIC_MODE_MESSAGE, 'error');
		if (
			cfg.host === SHARE_LINK_HOST_PLACEHOLDER &&
			!(cfg.kind === 'elegoo-sdcp' && shareLinkOf(cfg.secrets))
		)
			return idle(
				'The OctoEverywhere shared link is missing. Edit the printer and enter it again.',
				'offline'
			);
		return connect(cfg);
	};
}

export const adapters: Record<PrinterKind, ConnectFn> = {
	'elegoo-sdcp': guarded(connectSdcp),
	moonraker: guarded(connectMoonraker),
	octoprint: guarded(connectOctoprint),
	'bambu-lan': guarded(connectBambu)
};
