import type { PrinterKind } from '#lib/printers/status.ts';
import { isPublicMode } from '../../config';
import { PUBLIC_MODE_MESSAGE } from '../outbound';
import { StatusSubject, type AdapterHandle, type ConnectFn, type PrinterConfig } from '../types';
import { connectBambu } from './bambu';
import { connectMoonraker } from './moonraker';
import { connectOctoprint } from './octoprint';
import { connectSdcp } from './sdcp';

/** Public mode: no adapter ever opens a socket. The handle reports the refusal once and idles. */
function guarded(connect: ConnectFn): ConnectFn {
	return (cfg: PrinterConfig): AdapterHandle => {
		if (!isPublicMode()) return connect(cfg);
		const subj = new StatusSubject();
		subj.emit({ state: 'error', progress: null, message: PUBLIC_MODE_MESSAGE });
		return {
			status$: (cb) => subj.subscribe(cb),
			close: () => {
				subj.closed = true;
			}
		};
	};
}

export const adapters: Record<PrinterKind, ConnectFn> = {
	'elegoo-sdcp': guarded(connectSdcp),
	moonraker: guarded(connectMoonraker),
	octoprint: guarded(connectOctoprint),
	'bambu-lan': guarded(connectBambu)
};
