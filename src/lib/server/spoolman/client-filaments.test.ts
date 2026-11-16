import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	fromCacheData,
	parseFilament,
	parseSpoolStock,
	SpoolmanClient,
	toCacheData
} from './client';
import { startMockSpoolman, type MockSpoolman } from './mock-spoolman';
import { readSpoolmanStock } from '#lib/domain/spoolman.ts';

let mock: MockSpoolman;
beforeAll(async () => (mock = await startMockSpoolman()));
afterAll(() => mock.close());
beforeEach(() => mock.reset());

describe('response validation', () => {
	it('drops records without a usable id and clamps odd values', () => {
		expect(parseFilament(null)).toBeNull();
		expect(parseFilament({ id: 'x' })).toBeNull();
		expect(parseFilament({ id: 0 })).toBeNull();
		expect(parseSpoolStock({ id: -1 })).toBeNull();
		const f = parseFilament({
			id: 3,
			name: 5,
			color_hex: 'zzz',
			density: -1,
			weight: '1000',
			vendor: 'no'
		})!;
		expect(f).toMatchObject({
			id: 3,
			name: 'Filament 3',
			colorHex: null,
			density: null,
			weightG: null
		});
		expect(parseFilament({ id: 4, name: 'x'.repeat(500) })!.name).toHaveLength(200);
	});

	it('lists filaments with their spools, archived ones included', async () => {
		mock.addFilament({ name: 'A' });
		mock.addFilament({ name: 'B' });
		mock.addSpool({ filament_id: 1, used_weight: 250 });
		mock.addSpool({ filament_id: 1, archived: true });
		const c = new SpoolmanClient(mock.url);
		const all = await c.listFilamentsWithSpools();
		expect(all.map((f) => f.spools.length)).toEqual([2, 0]);
		expect(all[0].spools[0]).toMatchObject({ remainingG: 750, archived: false });
		const one = await c.getFilamentWithSpools(1);
		expect(one.spools).toHaveLength(2);
		await expect(c.getFilamentWithSpools(9)).rejects.toThrow(/404/);
	});

	it('rejects something that is not a list and a record that is not the filament asked for', async () => {
		mock.addFilament({ name: 'A' });
		const c = new SpoolmanClient(mock.url, 2000, (async (u: string | URL | Request) => {
			const url = String(u);
			const body = url.endsWith('/filament') ? { not: 'a list' } : { id: 2, name: 'Other' };
			return new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json' }
			});
		}) as typeof fetch);
		await expect(c.listFilaments()).rejects.toThrow(/unexpected/);
		await expect(c.getFilament(1)).rejects.toThrow(/unexpected/);
	});

	it('the cache record reads back and feeds the stock reader', async () => {
		mock.addFilament({ name: 'A', weight: 1000 });
		mock.addSpool({ filament_id: 1, used_weight: 400 });
		mock.addSpool({ filament_id: 1, archived: true, used_weight: 0 });
		const f = await new SpoolmanClient(mock.url).getFilamentWithSpools(1);
		const data = toCacheData(f);
		expect(fromCacheData(data)).toMatchObject({ id: 1, name: 'A', spools: [{ id: 1 }, { id: 2 }] });
		const row = { fetchedAt: 1, error: null };
		expect(readSpoolmanStock(data, row, null).remainingG).toBe(600); // open spools only
		expect(readSpoolmanStock(data, row, 1)).toMatchObject({ remainingG: 600, initialG: 1000 });
		expect(fromCacheData({ nonsense: true })).toBeNull();
	});
});
