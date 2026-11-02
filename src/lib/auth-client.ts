import { createAuthClient } from 'better-auth/svelte';
import { organizationClient } from 'better-auth/client/plugins';
import { ac, roles } from './permissions';

export const authClient = createAuthClient({
	plugins: [organizationClient({ ac, roles })]
});
