import type { PrinterKind } from '#lib/printers/status.ts';
import { shareLinkOf, SHARE_LINK_HOST_PLACEHOLDER } from '#lib/printers/share-link.ts';
import { StatusSubject, type ConnectFn } from '../types';
import { connectBambu } from './bambu';
import { connectMoonraker } from './moonraker';
import { connectOctoprint } from './octoprint';
import { connectSdcp } from './sdcp';

/**
 * The placeholder host means "reached through an OctoEverywhere link". Without a usable link
 * (secrets lost after a key rotation, wrong printer type) it is not a real host: never dial it,
 * report offline with a clear message instead.
 */
const guarded =
	(connect: ConnectFn): ConnectFn =>
	(cfg) => {
		if (
			cfg.host !== SHARE_LINK_HOST_PLACEHOLDER ||
			(cfg.kind === 'elegoo-sdcp' && shareLinkOf(cfg.secrets))
		)
			return connect(cfg);
		const subj = new StatusSubject();
		subj.emit({
			state: 'offline',
			progress: null,
			message: 'The OctoEverywhere shared link is missing. Edit the printer and enter it again.'
		});
		return {
			status$: (cb) => subj.subscribe(cb),
			close: () => {
				subj.closed = true;
			}
		};
	};

export const adapters: Record<PrinterKind, ConnectFn> = {
	'elegoo-sdcp': guarded(connectSdcp),
	moonraker: guarded(connectMoonraker),
	octoprint: guarded(connectOctoprint),
	'bambu-lan': guarded(connectBambu)
};
