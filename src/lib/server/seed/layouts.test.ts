import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeView } from '#lib/domain/fixtures.ts';
import { matchPlates, objectKey } from '#lib/domain/plates-match.ts';
import { parseThreeMfFile } from '../threemf';
import { tmtTemplate } from './tmt';

const layouts = tmtTemplate.plateLayouts ?? [];

describe('built-in plate layouts', () => {
	it('xpa is the default and equals the template plates', () => {
		const xpa = layouts.find((l) => l.key === 'xpa')!;
		expect(xpa.isDefault).toBe(true);
		expect(xpa.plates).toEqual(tmtTemplate.plates);
		expect(xpa.plates).toHaveLength(24);
		expect(layouts.filter((l) => l.isDefault)).toHaveLength(1);
	});

	it('h2d has 21 plates with real, unique part slugs and no times', () => {
		const h = layouts.find((l) => l.key === 'h2d')!;
		expect(h.plates).toHaveLength(21);
		const slugs = new Set(tmtTemplate.parts.map((p) => p.slug));
		const seen = new Set<string>();
		for (const p of h.plates) {
			expect(p.estSeconds).toBeNull();
			for (const s of p.parts) {
				expect(slugs.has(s), s).toBe(true);
				expect(seen.has(s), `${s} twice`).toBe(false);
				seen.add(s);
			}
		}
		const on = (n: number) => h.plates.find((p) => p.number === n)!.parts;
		expect(on(8)).toEqual(['rear-caster-left-mcmaster', 'rear-caster-right-mcmaster']);
		expect(on(10)).toContain('footrest-front');
		expect(on(20)).toEqual(['rims-small-1-4', 'rims-small-2-3']);
	});

	it('with default variants some H plates are empty and get dropped from a build', () => {
		const view = makeView();
		const active = new Set(view.parts.map((p) => p.slug));
		const h = layouts.find((l) => l.key === 'h2d')!;
		const empty = h.plates.filter((p) => !p.parts.some((s) => active.has(s))).map((p) => p.number);
		expect(empty).toEqual([8, 20]);
	});
});

// The matcher must reproduce the hand-made H layout from the real file's object names.
const real = process.env.MAKEGOOD_H_3MF;
describe.skipIf(!real || !existsSync(real))('matcher against the real H-series file', () => {
	it('agrees with the h2d layout', async () => {
		const s = await parseThreeMfFile(real!);
		const view = makeView();
		const m = matchPlates(s.plates, view.allParts, s.filaments);
		const h = layouts.find((l) => l.key === 'h2d')!;
		const unmatched: string[] = [];
		const diffs: string[] = [];
		for (const pl of s.plates) {
			const got = new Set<string>();
			for (const o of pl.objects) {
				const r = m[objectKey(pl.index, o.id)];
				if (r.slug) got.add(r.slug);
				else unmatched.push(`${pl.index}: ${o.name}`);
			}
			const want = new Set(h.plates.find((p) => p.number === pl.index)!.parts);
			const missing = [...want].filter((x) => !got.has(x));
			const extra = [...got].filter((x) => !want.has(x));
			if (missing.length || extra.length)
				diffs.push(`plate ${pl.index}: missing [${missing}] extra [${extra}]`);
		}
		console.log('unmatched:', unmatched, 'diffs:', diffs);
		expect(unmatched).toEqual([]);
		// Rim halves share one file: the matcher picks one of the two.
		expect(diffs.filter((d) => !/^plate (12|20):/.test(d))).toEqual([]);
	});
});
