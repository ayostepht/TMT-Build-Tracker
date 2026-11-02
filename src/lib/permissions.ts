import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, ownerAc, memberAc } from 'better-auth/plugins/organization/access';

/** Chapter roles: owner (manage chapter), editor (edit builds), viewer (read only). */
export const statement = {
	...defaultStatements,
	build: ['create', 'update', 'delete', 'view']
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
	...ownerAc.statements,
	build: ['create', 'update', 'delete', 'view']
});
export const editor = ac.newRole({
	...memberAc.statements,
	build: ['create', 'update', 'view']
});
export const viewer = ac.newRole({
	organization: [],
	member: [],
	invitation: [],
	build: ['view']
});

export const roles = { owner, editor, viewer };
