import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, runMigrations, type Db } from './db';
import { organization, organizationSettings, spoolmanCache } from './db/schema';
import {
	getDeductions,
	getOrgSettings,
	ledgerRole,
	prelinkLedgerKey,
	setDeduction,
	setOrgSettings
} from './org-settings';
import { eq } from 'drizzle-orm';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	db.insert(organization).values({ id: 'org1', name: 'T', slug: 't', createdAt: new Date() }).run();
});

describe('spoolmanKeptBy', () => {
	it('defaults to the current auto-deduct behaviour', () => {
		expect(getOrgSettings(db, 'org1').spoolmanKeptBy).toBe('other');
		setOrgSettings(db, 'org1', { spoolmanAutoDeduct: true });
		expect(getOrgSettings(db, 'org1').spoolmanKeptBy).toBe('app');
	});
	it('follows an old row that has auto-deduct on and no choice stored', () => {
		db.insert(organizationSettings)
			.values({ organizationId: 'org1', spoolmanAutoDeduct: true, settings: {} })
			.run();
		expect(getOrgSettings(db, 'org1').spoolmanKeptBy).toBe('app');
	});
	it('keeps the auto-deduct column in step', () => {
		setOrgSettings(db, 'org1', { spoolmanKeptBy: 'app' });
		expect(getOrgSettings(db, 'org1')).toMatchObject({
			spoolmanKeptBy: 'app',
			spoolmanAutoDeduct: true
		});
		setOrgSettings(db, 'org1', { spoolmanKeptBy: 'other' });
		expect(getOrgSettings(db, 'org1').spoolmanAutoDeduct).toBe(false);
	});
});

describe('deduction ledger', () => {
	it('reads old two-element entries and new role entries', () => {
		db.insert(organizationSettings)
			.values({
				organizationId: 'org1',
				settings: { spoolmanDeductions: { r1: [[1, 40]], r2: [[2, 5, 'primary']], bad: [['x']] } }
			})
			.run();
		const l = getDeductions(db, 'org1');
		expect(l.r1).toEqual([[1, 40]]);
		expect(ledgerRole(l.r1[0])).toBeNull();
		expect(l.r2).toEqual([[2, 5, 'primary']]);
		expect(ledgerRole(l.r2[0])).toBe('primary');
		expect(l.bad).toBeUndefined();
	});
	it('records and removes a pre-link one-off', () => {
		const k = prelinkLedgerKey('b1', 'primary');
		setDeduction(db, 'org1', k, [[3, 120, 'primary']]);
		expect(getDeductions(db, 'org1')[k]).toEqual([[3, 120, 'primary']]);
		setDeduction(db, 'org1', k, null);
		expect(getDeductions(db, 'org1')[k]).toBeUndefined();
	});
});

describe('spoolman_cache', () => {
	it('is keyed per workspace and filament and cascades with the org', () => {
		const row = (org: string, id: number) => ({
			organizationId: org,
			spoolmanFilamentId: id,
			data: { name: 'x' },
			fetchedAt: new Date(),
			error: null
		});
		db.insert(spoolmanCache).values(row('org1', 7)).run();
		expect(() => db.insert(spoolmanCache).values(row('org1', 7)).run()).toThrow();
		expect(
			db.select().from(spoolmanCache).where(eq(spoolmanCache.organizationId, 'org1')).all()
		).toHaveLength(1);
	});
});
