import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, runMigrations, type Db } from '../db';
import { activity, member, organization, templates, user } from '../db/schema';
import { templateSeeds } from '../seed';
import { seedTemplates } from '../seed/run';
import { addSpool, MAX_SPOOL_ADDS, removeSpoolAdd, updateFilament } from './actions';
import { createBuild } from './create';
import { updateBuildDesign } from '../designs/mutate';
import { loadBuildView } from './view';
import { filamentStats, stockKg } from '../../domain/accounting';
import { describeActivity } from '../../domain/activity';

let db: Db;
let templateId: string;
const orgId = 'org1';

beforeEach(() => {
	db = openDb(':memory:');
	runMigrations(db);
	seedTemplates(db, templateSeeds);
	templateId = db.select({ id: templates.id }).from(templates).get()!.id;
	db.insert(organization)
		.values({ id: orgId, name: 'Chapter', slug: 'chapter', createdAt: new Date() })
		.run();
	for (const u of ['owner', 'editor', 'viewer']) {
		db.insert(user)
			.values({ id: u, name: `User ${u}`, email: `${u}@example.test` })
			.run();
		db.insert(member)
			.values({ id: `m-${u}`, organizationId: orgId, userId: u, role: u, createdAt: new Date() })
			.run();
	}
});

const mk = (kind: 'build' | 'draft' = 'build') =>
	createBuild(db, { organizationId: orgId, templateId, designId: null, name: 'B', kind }, 'owner');
const view = (id: string) => loadBuildView(db, id, 'owner')!;
const status = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	return 0;
};
const acts = (id: string, kind: string) =>
	db
		.select()
		.from(activity)
		.where(eq(activity.buildId, id))
		.all()
		.filter((a) => a.kind === kind);

describe('spool adds', () => {
	it('adds with a date, user and note; stock is start + adds', () => {
		const id = mk();
		const f0 = view(id).filaments[0];
		const add = addSpool(db, id, 'editor', f0.key, { kg: 1.234, note: ' Overture restock ' });
		const f = view(id).filaments[0];
		expect(f.spoolAdds).toHaveLength(1);
		expect(f.spoolAdds![0]).toMatchObject({
			id: add,
			kg: 1.23,
			userId: 'editor',
			userName: 'User editor',
			note: 'Overture restock'
		});
		expect(Date.now() - f.spoolAdds![0].at).toBeLessThan(5000);
		expect(stockKg(f)).toBe(Math.round((f0.spools + 1.23) * 100) / 100);
		const st = filamentStats(view(id)).find((s) => s.role === f.key)!;
		expect(st.haveGrams).toBeCloseTo((f0.spools + 1.23) * 1000);
		expect(st.startKg).toBe(f0.spools);
		expect(st.addedKg).toBe(1.23);
		const row = acts(id, 'filament.stock.add').at(-1)!;
		expect(row.payload).toMatchObject({
			role: f.key,
			kg: 1.23,
			addId: add,
			note: 'Overture restock'
		});
		const v = view(id);
		expect(describeActivity(v.activity[0], v)).toMatch(
			/^User editor added 1\.23 kg of .+ \(Overture restock\)$/
		);
	});

	it('removes an add; unknown add 404', () => {
		const id = mk();
		const key = view(id).filaments[0].key;
		const add = addSpool(db, id, 'owner', key, { kg: 1 });
		removeSpoolAdd(db, id, 'owner', key, add);
		expect(view(id).filaments[0].spoolAdds).toEqual([]);
		expect(acts(id, 'filament.stock.remove')).toHaveLength(1);
		expect(status(() => removeSpoolAdd(db, id, 'owner', key, add))).toBe(404);
		expect(status(() => removeSpoolAdd(db, id, 'owner', key, '__proto__'))).toBe(404);
	});

	it('limits kg, note length and the number of adds per slot', () => {
		const id = mk();
		const key = view(id).filaments[0].key;
		for (const kg of [0, 0.004, -1, 99.5, NaN, '1', null, undefined]) {
			expect(status(() => addSpool(db, id, 'owner', key, { kg }))).toBe(400);
		}
		expect(status(() => addSpool(db, id, 'owner', key, { kg: 1, note: 'x'.repeat(201) }))).toBe(
			400
		);
		expect(status(() => addSpool(db, id, 'owner', key, { kg: 1, note: 5 }))).toBe(400);
		expect(status(() => addSpool(db, id, 'owner', key, 'x'))).toBe(400);
		addSpool(db, id, 'owner', key, { kg: 99, note: 'x'.repeat(200) });
		addSpool(db, id, 'owner', key, { kg: 0.01 });
		for (let i = 2; i < MAX_SPOOL_ADDS; i++) addSpool(db, id, 'owner', key, { kg: 1 });
		expect(view(id).filaments[0].spoolAdds).toHaveLength(MAX_SPOOL_ADDS);
		expect(status(() => addSpool(db, id, 'owner', key, { kg: 1 }))).toBe(400);
	});

	it('stores a note without control characters', () => {
		const id = mk();
		const key = view(id).filaments[0].key;
		addSpool(db, id, 'owner', key, { kg: 1, note: ' a\nb\r\n\tc\u0000d\u0001e\u202ef ' });
		const note = view(id).filaments[0].spoolAdds![0].note!;
		expect(note).toBe('a b c d e f');
		expect(acts(id, 'filament.stock.add').at(-1)!.payload).toMatchObject({ note });
		addSpool(db, id, 'owner', key, { kg: 1, note: '\n\u0000' });
		expect(view(id).filaments[0].spoolAdds![1].note).toBeUndefined();
	});

	it('is for owners and editors; viewers 403, outsiders 404, drafts 400', () => {
		const id = mk();
		const key = view(id).filaments[0].key;
		expect(status(() => addSpool(db, id, 'viewer', key, { kg: 1 }))).toBe(403);
		expect(status(() => addSpool(db, id, 'nobody', key, { kg: 1 }))).toBe(404);
		expect(status(() => addSpool(db, id, 'editor', key, { kg: 1 }))).toBe(0);
		const add = view(id).filaments[0].spoolAdds![0].id;
		expect(status(() => removeSpoolAdd(db, id, 'viewer', key, add))).toBe(403);
		const draft = mk('draft');
		const dkey = view(draft).filaments[0].key;
		expect(status(() => addSpool(db, draft, 'owner', dkey, { kg: 1 }))).toBe(400);
		expect(view(draft).filaments[0].spoolAdds).toEqual([]);
	});

	it('404s for an unknown or prototype-key color', () => {
		const id = mk();
		for (const role of ['nope', 'constructor', '__proto__', 'toString']) {
			expect(status(() => addSpool(db, id, 'owner', role, { kg: 1 }))).toBe(404);
			expect(status(() => removeSpoolAdd(db, id, 'owner', role, 'x'))).toBe(404);
		}
	});

	it('survives a design apply and a starting-spools edit; removal reports the stock total', () => {
		const id = mk();
		const f0 = view(id).filaments[0];
		addSpool(db, id, 'owner', f0.key, { kg: 2 });
		updateBuildDesign(db, id, 'owner', {
			palette: {
				label: 'Test',
				slots: { [f0.key]: { name: 'Other', material: f0.material, hex: '#123456' } }
			}
		});
		let f = view(id).filaments.find((x) => x.key === f0.key)!;
		expect(f.name).toBe('Other');
		expect(f.spoolAdds).toHaveLength(1);
		updateFilament(db, id, 'owner', f0.key, { spools: 3.5 });
		f = view(id).filaments.find((x) => x.key === f0.key)!;
		expect(f.spools).toBe(3.5);
		expect(stockKg(f)).toBe(5.5);
		const row = acts(id, 'filament.spools').at(-1)!;
		const v = view(id);
		expect(describeActivity({ ...v.activity[0] }, v)).toMatch(/starting spools to 3\.5 kg$/);
		expect(row.payload).toMatchObject({ spools: 3.5 });
	});

	it('removing a custom color records its whole stock', () => {
		const id = mk();
		updateBuildDesign(db, id, 'owner', {
			addRole: { key: 'extra', name: 'Extra', material: 'PETG', hex: '#abcdef' }
		});
		updateFilament(db, id, 'owner', 'extra', { spools: 1 });
		addSpool(db, id, 'owner', 'extra', { kg: 2 });
		updateBuildDesign(db, id, 'owner', { removeRole: 'extra' });
		const row = acts(id, 'design.update').at(-1)!;
		expect((row.payload.removed as { spools: number }).spools).toBe(3);
	});
});
