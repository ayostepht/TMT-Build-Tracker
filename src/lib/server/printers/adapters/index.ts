import type { PrinterKind } from '#lib/printers/status.ts';
import type { ConnectFn } from '../types';
import { connectBambu } from './bambu';
import { connectMoonraker } from './moonraker';
import { connectOctoprint } from './octoprint';
import { connectSdcp } from './sdcp';

export const adapters: Record<PrinterKind, ConnectFn> = {
	'elegoo-sdcp': connectSdcp,
	moonraker: connectMoonraker,
	octoprint: connectOctoprint,
	'bambu-lan': connectBambu
};
