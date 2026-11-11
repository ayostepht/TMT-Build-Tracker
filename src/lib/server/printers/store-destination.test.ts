import { describe, expect, it } from 'vitest';
import { openDb, runMigrations } from '../db';
import { organization, user } from '../db/schema';
import { configFromInput, createPrinter, updatePrinter } from './store';
import { decryptSecrets } from './secrets';

const L1 = 'https://shared-testtoken12345678.octoeverywhere.com';
const L2 = 'https://shared-othertoken87654321.octoeverywhere.com';

function setup() {
	const db = openDb(':memory:');
	runMigrations(db);
	db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.test' }).run();
	db.insert(organization).values({ id: 'o', name: 'O', slug: 'o', createdAt: new Date() }).run();
	const lan = createPrinter(db, 'o', 'u1', {
		name: 'LAN',
		kind: 'elegoo-sdcp',
		host: '10.0.0.5',
		secrets: { mainboardId: 'MB1' }
	});
	const linked = createPrinter(db, 'o', 'u1', {
		name: 'Linked',
		kind: 'elegoo-sdcp',
		secrets: { shareLink: L1 }
	});
	const octo = createPrinter(db, 'o', 'u1', {
		name: 'Octo',
		kind: 'octoprint',
		host: '10.0.0.6',
		secrets: { apiKey: 'KEY' }
	});
	return { db, lan, linked, octo };
}

describe('stored secrets belong to their destination (address or link)', () => {
	it('keeping the same link keeps it; the typed host is ignored while a link is set', () => {
		const { db, linked } = setup();
		const r = updatePrinter(db, linked.id, 'o', { host: '10.0.0.9', name: 'Renamed' });
		expect(decryptSecrets(r.secretEnc)).toEqual({ shareLink: L1 });
		expect(r.host).toBe('octoeverywhere'); // an address cannot hide next to a link
		const t = configFromInput(db, 'o', { id: linked.id, host: '10.0.0.9' });
		expect(t.host).toBe('octoeverywhere');
		expect(t.secrets.shareLink).toBe(L1);
	});

	it('changing the link replaces it and carries nothing else over', () => {
		const { db, linked } = setup();
		const r = updatePrinter(db, linked.id, 'o', { secrets: { shareLink: L2, mainboardId: '' } });
		expect(decryptSecrets(r.secretEnc)).toEqual({ shareLink: L2 });
	});

	it('address to link: the old identifiers do not ride along to the relay', () => {
		const { db, lan } = setup();
		const r = updatePrinter(db, lan.id, 'o', { secrets: { shareLink: L1 } });
		expect(decryptSecrets(r.secretEnc)).toEqual({ shareLink: L1 });
		expect(r.host).toBe('octoeverywhere');
	});

	it('link to address needs an address, and leaves no link behind', () => {
		const { db, linked } = setup();
		expect(() => updatePrinter(db, linked.id, 'o', { secrets: { shareLink: '' } })).toThrow(
			/address/i
		);
		const r = updatePrinter(db, linked.id, 'o', { host: '10.0.0.7', secrets: { shareLink: '' } });
		expect(r.host).toBe('10.0.0.7');
		expect(r.secretEnc).toBeNull();
	});

	it('a connection test cannot move stored secrets to another destination', () => {
		const { db, octo, lan, linked } = setup();
		// address to another address: the key must be typed again (existing rule, unchanged)
		expect(() => configFromInput(db, 'o', { id: octo.id, host: '10.0.0.99' })).toThrow(
			/Re-enter the api key/
		);
		// a typed link on a stored LAN printer does not bring the stored identifiers along
		const toLink = configFromInput(db, 'o', { id: lan.id, secrets: { shareLink: L2 } });
		expect(toLink.secrets).toEqual({ shareLink: L2 });
		expect(toLink.host).toBe('octoeverywhere');
		// the stored link is not reused against a typed address once removed
		const toAddr = configFromInput(db, 'o', {
			id: linked.id,
			host: '10.0.0.9',
			secrets: { shareLink: '' }
		});
		expect(toAddr.secrets).toEqual({});
		expect(toAddr.host).toBe('10.0.0.9');
		// the stored link is reachable only as the link: another link replaces it
		const other = configFromInput(db, 'o', { id: linked.id, secrets: { shareLink: L2 } });
		expect(other.secrets.shareLink).toBe(L2);
	});

	it('a printer type that cannot use links never gets one, so addresses stay the rule', () => {
		const { db, octo } = setup();
		expect(() => updatePrinter(db, octo.id, 'o', { host: '10.0.0.77' })).toThrow(/Re-enter/);
		expect(() =>
			updatePrinter(db, octo.id, 'o', { secrets: { shareLink: L1 }, host: '10.0.0.6' })
		).not.toThrow();
		const r = updatePrinter(db, octo.id, 'o', { name: 'x' });
		expect(decryptSecrets(r.secretEnc).shareLink).toBeUndefined();
		expect(decryptSecrets(r.secretEnc).apiKey).toBe('KEY');
		expect(r.host).toBe('10.0.0.6');
	});
});
