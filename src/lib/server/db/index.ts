import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { databaseUrl } from '../config';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export const MIGRATIONS_FOLDER = './drizzle';

export function openDb(url: string): Db {
	if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true });
	const client = new Database(url);
	client.pragma('journal_mode = WAL');
	client.pragma('foreign_keys = ON');
	return drizzle(client, { schema });
}

export function runMigrations(db: Db): void {
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

let instance: Db | undefined;

/** Lazily opened singleton so importing this module never touches disk (e.g. during build). */
export function getDb(): Db {
	return (instance ??= openDb(databaseUrl()));
}
