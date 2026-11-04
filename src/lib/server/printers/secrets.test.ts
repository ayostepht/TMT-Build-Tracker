import { describe, expect, it } from 'vitest';
import { decryptSecrets, encryptSecrets } from './secrets';
import { openDb, runMigrations } from '../db';
import { organization, printers, user } from '../db/schema';
import { createPrinter, toPublic } from './store';

describe('printer secrets', () => {
	it('round-trips and uses a fresh IV each time', () => {
		const a = encryptSecrets({ accessCode: '12345678', serial: 'S1' }, 'k1');
		const b = encryptSecrets({ accessCode: '12345678', serial: 'S1' }, 'k1');
		expect(a).not.toBe(b);
		expect(a).not.toContain('12345678');
		expect(decryptSecrets(a, 'k1')).toEqual({ accessCode: '12345678', serial: 'S1' });
	});
	it('fails closed with the wrong key or a tampered blob', () => {
		const a = encryptSecrets({ apiKey: 'abc' }, 'k1');
		expect(decryptSecrets(a, 'k2')).toEqual({});
		const parts = a.split('.');
		parts[3] = Buffer.from('tampered').toString('base64url');
		expect(decryptSecrets(parts.join('.'), 'k1')).toEqual({});
		expect(decryptSecrets(null)).toEqual({});
		expect(decryptSecrets('garbage')).toEqual({});
	});

	it('never appears in the public view or its JSON', () => {
		const db = openDb(':memory:');
		runMigrations(db);
		db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
		db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
		const row = createPrinter(db, 'o', 'u1', {
			name: 'Bambu',
			kind: 'bambu-lan',
			host: '10.0.0.5',
			secrets: { accessCode: 'SUPERSECRET1', serial: '01P00A' }
		});
		expect(row.secretEnc).toBeTruthy();
		expect(row.secretEnc).not.toContain('SUPERSECRET1');
		const pub = toPublic(row);
		const json = JSON.stringify(pub);
		expect(json).not.toContain('SUPERSECRET1');
		expect(json).not.toContain('secretEnc');
		expect(pub.secretsSet.sort()).toEqual(['accessCode', 'serial']);
		expect(pub.identifiers).toEqual({ serial: '01P00A' });
		expect(db.select().from(printers).all()).toHaveLength(1);
	});
});
