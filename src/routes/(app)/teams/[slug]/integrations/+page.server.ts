import { isPublicMode } from '#lib/server/config.ts';
import type { PageServerLoad } from './$types';

/** Printer and Spoolman connections do not exist on the hosted (public) site: the page says so. */
export const load: PageServerLoad = () => ({ printersAvailable: !isPublicMode() });
