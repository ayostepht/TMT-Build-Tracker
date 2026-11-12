import { isPublicMode } from '#lib/server/config.ts';
import type { PageServerLoad } from './$types';

/** `hosted` is known before anything loads, so the hosted note and the Spoolman card never flash. */
export const load: PageServerLoad = () => ({ hosted: isPublicMode() });
