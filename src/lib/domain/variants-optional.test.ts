import { describe, expect, it } from 'vitest';
import { tmtTemplate } from '../server/seed/tmt.ts';
import { filamentStats, overallProgress, units } from './accounting.ts';
import { makeView } from './fixtures.ts';
import { inactiveSlugs, resolveChoices, validateChoices, variantOfPart } from './variants.ts';
import type { VariantGroup } from './types.ts';

const groups: VariantGroup[] = [
	{
		key: 'acc',
		name: 'Accessory',
		defaultOption: 'include',
		options: [
			{ key: 'include', name: 'With', description: '', parts: ['a', 'b'] },
			{ key: 'none', name: 'Without', description: '', parts: [] }
		]
	}
];

describe('an option with an empty parts list', () => {
	it('the default option keeps its parts active and the empty one disables them', () => {
		expect([...inactiveSlugs(groups, {})]).toEqual([]);
		expect([...inactiveSlugs(groups, { acc: 'none' })].sort()).toEqual(['a', 'b']);
	});
	it('resolves and validates the empty option like any other', () => {
		expect(resolveChoices(groups, { acc: 'none' })).toEqual({ acc: 'none' });
		expect(resolveChoices(groups, { acc: 'bogus' })).toEqual({ acc: 'include' });
		expect(validateChoices(groups, { acc: 'none' })).toBeNull();
	});
	it('parts of the include option map to it; nothing maps to the empty option', () => {
		const m = variantOfPart(groups);
		expect(m.get('a')).toEqual({ group: 'acc', option: 'include' });
		expect([...m.values()].some((v) => v.option === 'none')).toBe(false);
	});
});

describe('TMT headrest and push handle accessories', () => {
	const HEADREST = ['headrest-mount', 'headrest-brace', 'headrest-bolt', 'soft-headrest'];
	const PUSH = ['push-top', 'push-bottom', 'push-brace', 'push-pin', 'push-grip'];
	const group = (k: string) => tmtTemplate.variantGroups!.find((g) => g.key === k)!;

	it('both default to included, with an empty "none" option', () => {
		for (const k of ['headrest', 'push-handle']) {
			expect(group(k).defaultOption).toBe('include');
			expect(group(k).options.at(-1)!.key).toBe('none');
			expect(group(k).options.at(-1)!.parts).toEqual([]);
		}
		expect(group('headrest').options.map((o) => o.key)).toEqual(['include', 'none']);
		expect(group('push-handle').options.map((o) => o.key)).toEqual([
			'include',
			'one-piece',
			'none'
		]);
		expect(group('headrest').options[0].parts.sort()).toEqual([...HEADREST].sort());
		expect(group('push-handle').options[0].parts.sort()).toEqual([...PUSH].sort());
	});
	it('every option part is a real part; only the push grip is shared, between options of one group', () => {
		const slugs = new Set(tmtTemplate.parts.map((p) => p.slug));
		const groupOf = new Map<string, string>();
		const shared: string[] = [];
		for (const g of tmtTemplate.variantGroups!) {
			const inGroup = new Set<string>();
			for (const o of g.options) {
				expect(new Set(o.parts).size, `${g.key}/${o.key} lists a part twice`).toBe(o.parts.length);
				for (const s of o.parts) {
					expect(slugs.has(s), s).toBe(true);
					expect(groupOf.get(s) ?? g.key, `${s} in two groups`).toBe(g.key);
					groupOf.set(s, g.key);
					if (inGroup.has(s)) shared.push(s);
					inGroup.add(s);
				}
			}
		}
		expect(shared).toEqual(['push-grip']);
	});
	it('one-piece push handle: its parts replace the multi-part ones, the grip stays', () => {
		const one = group('push-handle').options.find((o) => o.key === 'one-piece')!;
		expect(one.parts.sort()).toEqual(['push-grip', 'push-handle-one-piece']);
		const v = makeView(undefined, 0, { 'push-handle': 'one-piece' });
		const left = v.parts.map((p) => p.slug);
		for (const s of ['push-handle-one-piece', 'push-grip']) expect(left).toContain(s);
		for (const s of ['push-top', 'push-bottom', 'push-brace', 'push-pin'])
			expect(left).not.toContain(s);
		// default build: the one-piece part is inactive
		expect(makeView().parts.map((p) => p.slug)).not.toContain('push-handle-one-piece');
		// the shared grip belongs to the first (default) option
		expect(variantOfPart(tmtTemplate.variantGroups!).get('push-grip')).toEqual({
			group: 'push-handle',
			option: 'include'
		});
		expect(
			inactiveSlugs(tmtTemplate.variantGroups!, { 'push-handle': 'none' }).has('push-grip')
		).toBe(true);
	});
	it('the default build includes them; choosing none drops exactly those parts', () => {
		const all = makeView().parts.map((p) => p.slug);
		for (const s of [...HEADREST, ...PUSH]) expect(all).toContain(s);
		const v = makeView(undefined, 0, { headrest: 'none', 'push-handle': 'none' });
		const left = v.parts.map((p) => p.slug);
		for (const s of [...HEADREST, ...PUSH]) expect(left).not.toContain(s);
		expect(left).toHaveLength(all.length - HEADREST.length - PUSH.length);
		expect(v.allParts.length).toBe(makeView().allParts.length);
	});
	it('accounting copes with the parts gone (plates dropped when empty, totals finite)', () => {
		const v = makeView(undefined, 0, { headrest: 'none', 'push-handle': 'none' });
		expect(filamentStats(v).every((f) => Number.isFinite(f.need))).toBe(true);
		expect(overallProgress(v).total).toBe(v.parts.length);
		const seen = units(v).flatMap((u) => u.parts.map((p) => p.slug));
		expect(seen).not.toContain('push-grip');
		expect(seen.sort()).toEqual(v.parts.map((p) => p.slug).sort());
		// The TPU grip plate held only the grip, so it is gone from the build's plates.
		expect(v.plates.some((p) => p.parts.length === 0)).toBe(false);
		expect(v.plates.find((p) => p.name.includes('Push Handle Grip'))).toBeUndefined();
	});
});
