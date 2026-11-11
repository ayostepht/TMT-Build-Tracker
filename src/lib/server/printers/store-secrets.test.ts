import { describe, expect, it } from 'vitest';
import { openDb, runMigrations } from '../db';
import { organization, user } from '../db/schema';
import { ApiError } from '../access';
import { configFromInput, createPrinter, updatePrinter } from './store';
import { decryptSecrets } from './secrets';

function setup(kind: 'octoprint' | 'bambu-lan' = 'octoprint') {
	const db = openDb(':memory:');
	runMigrations(db);
	db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
	db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
	const row = createPrinter(
		db,
		'o',
		'u1',
		kind === 'octoprint'
			? { name: 'P', kind, host: '10.0.0.5', port: 80, secrets: { apiKey: 'KEY' } }
			: {
					name: 'P',
					kind,
					host: '10.0.0.5',
					secrets: { accessCode: 'CODE', serial: '01S00A000000000' }
				}
	);
	return { db, row };
}

describe('stored secrets stay with the address they were saved for', () => {
	it('a test at the same address uses the stored key (host spelling and port null/default aside)', () => {
		const { db, row } = setup();
		const cfg = configFromInput(db, 'o', { id: row.id, host: '10.0.0.5' });
		expect(cfg.secrets.apiKey).toBe('KEY');
		expect(
			configFromInput(db, 'o', { id: row.id, host: ' 10.0.0.5 ', port: 80 }).secrets.apiKey
		).toBe('KEY');
	});
	it('a test at another host does not get the stored key and asks for it again', () => {
		const { db, row } = setup();
		expect(() => configFromInput(db, 'o', { id: row.id, host: '10.0.0.9' })).toThrow(
			/Re-enter the api key/
		);
		expect(() => configFromInput(db, 'o', { id: row.id, host: '10.0.0.5', port: 8080 })).toThrow(
			ApiError
		);
	});
	it('retyping the key at the new address works and uses only the typed one', () => {
		const { db, row } = setup();
		const cfg = configFromInput(db, 'o', {
			id: row.id,
			host: '10.0.0.9',
			secrets: { apiKey: 'NEW' }
		});
		expect(cfg.host).toBe('10.0.0.9');
		expect(cfg.secrets.apiKey).toBe('NEW');
	});
	it('non-secret identifiers (serial) follow a moved address; the access code does not', () => {
		const { db, row } = setup('bambu-lan');
		expect(() => configFromInput(db, 'o', { id: row.id, host: '10.0.0.9' })).toThrow(
			/Re-enter the lan access code/
		);
		const cfg = configFromInput(db, 'o', {
			id: row.id,
			host: '10.0.0.9',
			secrets: { accessCode: 'NEWCODE' }
		});
		expect(cfg.secrets).toMatchObject({ accessCode: 'NEWCODE', serial: '01S00A000000000' });
	});
	it('saving a changed host or port without retyping the key is refused; the row is untouched', () => {
		const { db, row } = setup();
		expect(() => updatePrinter(db, row.id, 'o', { host: '10.0.0.9' })).toThrow(/Re-enter/);
		expect(() => updatePrinter(db, row.id, 'o', { port: 81 })).toThrow(/Re-enter/);
		const same = updatePrinter(db, row.id, 'o', { host: '10.0.0.5', name: 'Q' });
		expect(decryptSecrets(same.secretEnc).apiKey).toBe('KEY');
	});
	it('saving a changed host with a retyped key stores only the new key', () => {
		const { db, row } = setup();
		const moved = updatePrinter(db, row.id, 'o', { host: '10.0.0.9', secrets: { apiKey: 'NEW' } });
		expect(moved.host).toBe('10.0.0.9');
		expect(decryptSecrets(moved.secretEnc).apiKey).toBe('NEW');
	});
});
