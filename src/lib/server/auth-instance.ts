import { createAuth, type Auth } from './auth';
import { getDb } from './db';

let instance: Auth | undefined;

export function getAuth(): Auth {
	return (instance ??= createAuth(getDb()));
}
