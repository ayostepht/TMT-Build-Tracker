// Single source of the app version: package.json. Vite inlines just this string
// into the bundles, so the image needs no package.json at this path.
import { version } from '../../package.json';

export const APP_VERSION: string = version;
