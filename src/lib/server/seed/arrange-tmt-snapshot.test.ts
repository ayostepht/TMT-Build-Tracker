import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { arrange, type ArrangePart } from '#lib/domain/arrange.ts';
import { seedToFootprint } from '#lib/domain/print-footprint.ts';
import { tmtTemplate } from './tmt';

// Regression guard: the flat-rotation arranger must keep producing exactly these plates for
// the seed kit (hash of the full result: plates, items, positions, rotations, warnings).
const roles = tmtTemplate.filamentRoles.map((r) => ({
	key: r.key,
	name: r.key,
	material: r.material,
	tpu: r.tpu
}));
const design = tmtTemplate.designs[0].partRoles;
const fps = new Map((tmtTemplate.printFootprints ?? []).map((f) => [f.slug, seedToFootprint(f)]));
const parts: ArrangePart[] = tmtTemplate.parts
	.filter((p) => fps.has(p.slug))
	.map((p) => ({
		slug: p.slug,
		name: p.name,
		role: design[p.slug] ?? p.defaultRole,
		footprint: fps.get(p.slug)!,
		units: p.qty ?? 1,
		grams: p.bomGrams,
		group: p.symmetryGroup ? `sym:${p.symmetryGroup}` : null
	}));
const hash = (bedX: number, bedY: number, mmSlots: number) => {
	const r = arrange({ parts, roles, printer: { bedX, bedY, margin: 5, spacing: 8, mmSlots } });
	return {
		plates: r.plates.length,
		sha: createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0, 16)
	};
};

describe('seed arrangement snapshot', () => {
	it('is unchanged', () => {
		const got = [hash(256, 256, 4), hash(350, 320, 4), hash(220, 220, 1), hash(256, 256, 1)];
		expect(got).toEqual(EXPECTED);
	});
});
const EXPECTED = [
	{ plates: 32, sha: 'f19e6c47d6bd67a7' },
	{ plates: 18, sha: 'af144969f359fb4b' },
	{ plates: 36, sha: 'a511e54e90e93d71' },
	{ plates: 32, sha: 'f19e6c47d6bd67a7' }
];
