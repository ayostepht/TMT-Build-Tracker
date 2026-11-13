import { describe, expect, it } from 'vitest';
import {
	applyPartRole,
	designColors,
	effectivePartRoles,
	hiddenSlugs,
	materialAllowed,
	newRoleKey,
	paletteReset,
	removeImpact,
	replacementOptions,
	roleOptions,
	symmetryPeers
} from './design.ts';
import { makeView } from './fixtures.ts';

describe('materialAllowed', () => {
	it('matches by family and exact name, and allows anything when unrestricted', () => {
		expect(materialAllowed(['PETG'], 'PETG')).toBe(true);
		expect(materialAllowed(['PETG'], 'PETG-CF')).toBe(true);
		expect(materialAllowed(['PETG'], 'TPU 95A')).toBe(false);
		expect(materialAllowed(['TPU 95A'], 'TPU 85A')).toBe(true);
		expect(materialAllowed(['TPU 95A'], 'PLA')).toBe(false);
		expect(materialAllowed(['TPU 90A foaming'], 'TPU 95A')).toBe(true);
		expect(materialAllowed(['PLA'], 'pla')).toBe(true);
		expect(materialAllowed(['PLA'], 'ABS')).toBe(false);
		expect(materialAllowed([], 'anything')).toBe(true);
	});
});

describe('slots, colors and hidden parts', () => {
	const view = makeView();
	const wing = view.allParts.find((p) => p.slug === 'wing-left')!;

	it('lists every slot with a reason for the ones a part cannot use', () => {
		const opts = roleOptions(wing, view.filaments);
		const soft = opts.find((o) => o.filament.key === 'soft')!;
		expect(soft.ok).toBe(false);
		expect(soft.reason).toMatch(/PETG/);
		expect(opts.filter((o) => o.ok).map((o) => o.filament.key)).toEqual(['primary', 'accent']);
	});

	it('builds the slug to hex map from each part role, with overrides', () => {
		const colors = designColors(view);
		const accent = view.filaments.find((f) => f.key === 'accent')!;
		expect(colors['wing-left']).toBe(accent.hex);
		expect(Object.keys(colors)).toHaveLength(view.allParts.length);
		const primary = view.filaments.find((f) => f.key === 'primary')!;
		expect(designColors(view, { 'wing-left': 'primary' })['wing-left']).toBe(primary.hex);
	});

	it('hides parts of variant options that are not chosen', () => {
		const groups = view.variantGroups;
		const g = groups.find((x) => x.options.length > 1)!;
		const other = g.options.find((o) => o.key !== g.defaultOption)!;
		const hidden = hiddenSlugs(view);
		for (const s of other.parts) expect(hidden).toContain(s);
		const switched = makeView(undefined, 0, { [g.key]: other.key });
		const hidden2 = hiddenSlugs(switched);
		for (const s of other.parts) expect(hidden2).not.toContain(s);
		const def = g.options.find((o) => o.key === g.defaultOption)!;
		for (const s of def.parts) expect(hidden2).toContain(s);
	});

	it('effectivePartRoles covers every template part', () => {
		expect(Object.keys(effectivePartRoles(view))).toHaveLength(view.allParts.length);
	});
});

describe('applyPartRole', () => {
	const view = makeView();

	it('moves both sides of a symmetry group by default option', () => {
		expect(
			symmetryPeers(view, 'wing-left')
				.map((p) => p.slug)
				.sort()
		).toEqual(['wing-left', 'wing-right']);
		const both = applyPartRole(view, 'wing-left', 'primary', { bothSides: true });
		expect(both.changes).toEqual({ 'wing-left': 'primary', 'wing-right': 'primary' });
		const one = applyPartRole(view, 'wing-left', 'primary', { bothSides: false });
		expect(one.changes).toEqual({ 'wing-left': 'primary' });
	});

	it('skips parts already on the slot and parts without a symmetry group', () => {
		expect(applyPartRole(view, 'wing-left', 'accent', { bothSides: true }).changes).toEqual({});
		const solo = view.allParts.find((p) => !p.symmetryGroup && p.allowedMaterials[0] === 'PETG')!;
		const r = applyPartRole(view, solo.slug, 'accent', { bothSides: true });
		expect(Object.keys(r.changes).every((s) => s === solo.slug)).toBe(true);
	});

	it('refuses slots with the wrong material and reports why', () => {
		const r = applyPartRole(view, 'wing-left', 'soft', { bothSides: true });
		expect(r.changes).toEqual({});
		expect(r.blocked.map((b) => b.slug).sort()).toEqual(['wing-left', 'wing-right']);
		expect(applyPartRole(view, 'wing-left', 'nope').changes).toEqual({});
	});
});

describe('newRoleKey', () => {
	it('slugifies and de-duplicates', () => {
		expect(newRoleKey(['primary'], 'Polymaker Red')).toBe('polymaker-red');
		expect(newRoleKey(['polymaker-red'], 'Polymaker Red')).toBe('polymaker-red-2');
		expect(newRoleKey([], '!!!')).toBe('color');
	});
});

describe('paletteReset', () => {
	it('lists unlocked parts off their kit slot as reset and locked parts as kept', () => {
		const view = makeView();
		const [a, b, c] = view.allParts;
		const other = view.filaments.find((f) => f.key !== a.defaultRole)!.key;
		const moved = {
			...view,
			allParts: view.allParts.map((p) =>
				p.slug === a.slug
					? { ...p, role: other }
					: p.slug === b.slug
						? { ...p, role: other, locked: true }
						: p.slug === c.slug
							? { ...p, locked: true }
							: p
			)
		};
		const r = paletteReset(moved);
		expect(r.reset.map((p) => p.slug)).toEqual([a.slug]);
		expect(r.kept.map((p) => p.slug).sort()).toEqual([b.slug, c.slug].sort());
		expect(paletteReset(view)).toEqual({ reset: [], kept: [] });
	});
});

describe('removeImpact and replacementOptions', () => {
	const base = makeView();
	const withRed = {
		...base,
		filaments: [
			...base.filaments,
			{ ...base.filaments[0], key: 'red', name: 'Red', kit: false, tpu: false }
		]
	};
	const g = base.variantGroups.find((x) => x.options.length > 1)!;
	const inactivePart = base.allParts.find((p) => !base.parts.some((x) => x.slug === p.slug))!;

	it('counts every part on the slot and flags the ones of an unchosen option', () => {
		expect(g).toBeTruthy();
		const view = {
			...withRed,
			allParts: withRed.allParts.map((p) =>
				p.slug === inactivePart.slug || p.slug === 'wing-left' ? { ...p, role: 'red' } : p
			)
		};
		view.parts = view.parts.map((p) => (p.slug === 'wing-left' ? { ...p, role: 'red' } : p));
		const impact = removeImpact(view, 'red');
		expect(impact.map((i) => i.part.slug)).toEqual(['wing-left', inactivePart.slug]);
		expect(impact.map((i) => i.inactive)).toEqual([false, true]);
		expect(removeImpact(view, 'nothing')).toEqual([]);
	});

	it('offers the other slots and blocks the ones an affected part cannot use', () => {
		const view = {
			...withRed,
			allParts: withRed.allParts.map((p) => (p.slug === 'wing-left' ? { ...p, role: 'red' } : p))
		};
		const opts = replacementOptions(view, 'red');
		expect(opts.map((o) => o.filament.key)).not.toContain('red');
		const soft = opts.find((o) => o.filament.key === 'soft')!;
		expect(soft.ok).toBe(false);
		expect(soft.reason).toMatch(/PETG/);
		expect(opts.find((o) => o.filament.key === 'primary')).toMatchObject({
			ok: true,
			reason: null
		});
	});
});
