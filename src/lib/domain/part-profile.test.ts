import { describe, expect, it } from 'vitest';
import {
	learnPartProfiles,
	meshVolume,
	resolveProfile,
	type LearnPart,
	type LearnPlate
} from './part-profile.ts';

const parts: LearnPart[] = [
	{ slug: 'wing-left', role: 'primary', qty: 1 },
	{ slug: 'handle', role: 'accent', qty: 1 },
	{ slug: 'rim', role: 'primary', qty: 4, piecesPerUnit: 1 }
];
const filamentMap = { '1': 'primary', '2': 'accent' };

describe('learnPartProfiles: volume split', () => {
	const plate: LearnPlate = {
		index: 1,
		seconds: 10000,
		runs: 1,
		filamentGrams: { '1': 300, '2': 100 },
		objects: [
			{ name: 'WING', slug: 'wing-left', count: 1, volume: 300 },
			{ name: 'HANDLE', slug: 'handle', count: 1, volume: 100 }
		]
	};

	it('shares time by volume and each filament among the parts in its role', () => {
		const out = learnPartProfiles({ plates: [plate], parts, filamentMap });
		const wing = out.find((p) => p.slug === 'wing-left')!;
		const handle = out.find((p) => p.slug === 'handle')!;
		expect(wing.secondsPerCopy).toBe(7500);
		expect(handle.secondsPerCopy).toBe(2500);
		// filament 1 is the primary role: only the wing is primary, so it takes all 300 g
		expect(wing.gramsByRole).toEqual({ primary: 300 });
		expect(handle.gramsByRole).toEqual({ accent: 100 });
		expect(wing.method).toBe('volume-split');
		expect(wing.partRole).toBe('primary');
	});

	it('does not give a stray slot (a role no part on the plate has) to the plate parts', () => {
		const stray: LearnPlate = { ...plate, filamentGrams: { '1': 300, '2': 100, '3': 20 } };
		const out = learnPartProfiles({
			plates: [stray],
			parts,
			filamentMap: { ...filamentMap, '3': 'tire' }
		});
		expect(out.find((p) => p.slug === 'wing-left')!.gramsByRole).toEqual({ primary: 300 });
		expect(out.find((p) => p.slug === 'handle')!.gramsByRole).toEqual({ accent: 100 });
	});

	it('still counts a plate sliced only in a color no part has under the parts own color', () => {
		const only: LearnPlate = { ...plate, filamentGrams: { '3': 400 } };
		const out = learnPartProfiles({ plates: [only], parts, filamentMap: { '3': 'tire' } });
		const total = out.reduce(
			(a, p) => a + Object.values(p.gramsByRole).reduce((x, y) => x + y, 0),
			0
		);
		expect(total).toBeCloseTo(400, 1);
	});

	it('splits a filament by volume when several parts share its role', () => {
		const two: LearnPlate = {
			...plate,
			filamentGrams: { '1': 400 },
			objects: [
				{ name: 'A', slug: 'wing-left', count: 1, volume: 300 },
				{ name: 'B', slug: 'rim', count: 1, volume: 100 }
			]
		};
		const out = learnPartProfiles({ plates: [two], parts, filamentMap });
		const g = (s: string) => out.find((p) => p.slug === s)!.gramsByRole.primary;
		expect(g('wing-left')).toBe(300);
		// the rim is qty 4 but the plate has one: 1 piece per unit and 1 instance, so one copy
		expect(g('rim')).toBe(100);
	});

	it('counts copies: a plate printed 4 times with 1 object per run is 4 copies of a qty 4 part', () => {
		const rim: LearnPlate = {
			index: 1,
			seconds: 36000,
			runs: 4,
			filamentGrams: { '1': 280 },
			objects: [{ name: 'RIM', slug: 'rim', count: 1, volume: 50 }]
		};
		const [p] = learnPartProfiles({ plates: [rim], parts, filamentMap });
		expect(p.copies).toBe(4);
		expect(p.secondsPerCopy).toBe(36000);
		expect(p.gramsByRole).toEqual({ primary: 280 });
	});

	it('counts instances on the plate: 8 tires on one plate for a qty 8 part', () => {
		const tire: LearnPlate = {
			index: 2,
			seconds: 80000,
			runs: 1,
			filamentGrams: { '2': 640 },
			objects: [{ name: 'TIRE', slug: 'tire', count: 8, volume: 10 }]
		};
		const [p] = learnPartProfiles({
			plates: [tire],
			parts: [{ slug: 'tire', role: 'accent', qty: 8, piecesPerUnit: 1 }],
			filamentMap
		});
		expect(p.copies).toBe(8);
		expect(p.secondsPerCopy).toBe(10000);
		expect(p.gramsByRole).toEqual({ accent: 80 });
	});

	it('ignores unmapped objects and plates without data, and untracked filaments', () => {
		const out = learnPartProfiles({
			plates: [
				{
					index: 1,
					seconds: 1000,
					runs: 1,
					filamentGrams: { '1': 10, '3': 5 },
					objects: [
						{ name: 'X', slug: null, count: 1, volume: 5 },
						{ name: 'WING', slug: 'wing-left', count: 1, volume: 5 }
					]
				},
				{ index: 2, seconds: null, runs: 1, filamentGrams: {}, objects: [] }
			],
			parts,
			filamentMap
		});
		expect(out).toHaveLength(1);
		expect(out[0].secondsPerCopy).toBe(1000);
		expect(out[0].gramsByRole).toEqual({ primary: 10 });
	});

	it('falls back to equal shares per instance when no volume is known', () => {
		const out = learnPartProfiles({
			plates: [
				{
					index: 1,
					seconds: 900,
					runs: 1,
					filamentGrams: { '1': 90 },
					objects: [
						{ name: 'A', slug: 'wing-left', count: 2 },
						{ name: 'B', slug: 'rim', count: 1 }
					]
				}
			],
			parts: [
				{ slug: 'wing-left', role: 'primary', qty: 2 },
				{ slug: 'rim', role: 'primary', qty: 1 }
			],
			filamentMap
		});
		const by = Object.fromEntries(out.map((p) => [p.slug, p]));
		expect(by['wing-left'].secondsPerCopy).toBe(300); // 2 copies share 600 s
		expect(by.rim.secondsPerCopy).toBe(300);
	});
});

describe('learnPartProfiles: exact', () => {
	it('uses the measured seconds and extrusion per object, tower waste shared proportionally', () => {
		const plate: LearnPlate = {
			index: 1,
			seconds: 1000,
			runs: 1,
			filamentGrams: { '1': 100, '2': 10 },
			objects: [
				{ name: 'WING', slug: 'wing-left', count: 1, volume: 1 }, // volumes would say 50/50
				{ name: 'HANDLE', slug: 'handle', count: 1, volume: 1 }
			],
			exact: [
				{ name: 'WING', seconds: 600, mm: { '1': 750 } },
				{ name: 'handle', seconds: 300, mm: { '1': 250, '2': 100 } }
			]
		};
		const out = learnPartProfiles({ plates: [plate], parts, filamentMap });
		const by = Object.fromEntries(out.map((p) => [p.slug, p]));
		expect(by['wing-left'].method).toBe('exact');
		expect(by['wing-left'].secondsPerCopy).toBe(Math.round((1000 * 600) / 900));
		expect(by.handle.secondsPerCopy).toBe(Math.round((1000 * 300) / 900));
		// filament 1: 100 g split 750:250
		expect(by['wing-left'].gramsByRole.primary).toBe(75);
		expect(by.handle.gramsByRole).toEqual({ primary: 25, accent: 10 });
	});

	it('mixes: a plate without exact data for every object uses volumes and marks the method', () => {
		const plate: LearnPlate = {
			index: 1,
			seconds: 1000,
			runs: 1,
			filamentGrams: { '1': 100 },
			objects: [
				{ name: 'WING', slug: 'wing-left', count: 1, volume: 3 },
				{ name: 'HANDLE', slug: 'handle', count: 1, volume: 1 }
			],
			exact: [{ name: 'WING', seconds: 10, mm: {} }]
		};
		const out = learnPartProfiles({ plates: [plate], parts, filamentMap });
		expect(out.every((p) => p.method === 'volume-split')).toBe(true);
		expect(out.find((p) => p.slug === 'wing-left')!.secondsPerCopy).toBe(750);
	});
});

describe('resolveProfile: recolor', () => {
	const stored = {
		secondsPerCopy: 7500,
		gramsByRole: { primary: 300, soft: 2 },
		method: 'volume-split',
		context: { partRole: 'primary' }
	};
	const roles = ['primary', 'accent', 'soft', 'tire'];

	it('keeps everything while the part keeps its role', () => {
		const r = resolveProfile(stored, 'primary', roles);
		expect(r).toMatchObject({ gramsByRole: { primary: 300, soft: 2 }, remapped: false });
	});

	it('moves the part own grams to its new role and leaves the time and other filaments alone', () => {
		const r = resolveProfile(stored, 'accent', roles);
		expect(r.gramsByRole).toEqual({ accent: 300, soft: 2 });
		expect(r.secondsPerCopy).toBe(7500);
		expect(r.remapped).toBe(true);
		expect(r.learnedRole).toBe('primary');
	});

	it('counts a part sliced in another filament than its design color under its own color', () => {
		const r = resolveProfile(
			{ ...stored, gramsByRole: { primary: 300 }, context: { partRole: 'accent' } },
			'accent',
			roles
		);
		expect(r.gramsByRole).toEqual({ accent: 300 });
		expect(r.remapped).toBe(false);
	});

	it('folds grams of a role that no longer exists into the part role', () => {
		const r = resolveProfile(stored, 'primary', ['primary', 'accent']);
		expect(r.gramsByRole).toEqual({ primary: 302 });
		expect(r.remapped).toBe(true);
	});
});

describe('meshVolume', () => {
	it('measures a unit cube', () => {
		const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
		const i = [
			0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3,
			0, 4, 3, 4, 7
		];
		expect(meshVolume(p, i)).toBeCloseTo(1, 6);
	});
});
