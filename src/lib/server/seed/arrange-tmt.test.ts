import { describe, expect, it } from 'vitest';
import { arrange, type ArrangePart } from '#lib/domain/arrange.ts';
import { seedToFootprint } from '#lib/domain/print-footprint.ts';
import { tmtTemplate } from './tmt';

// The kit's seed footprints (measured from the H profile) arranged on three beds.
const roles = tmtTemplate.filamentRoles.map((r) => ({
	key: r.key,
	name: r.key,
	material: r.material,
	tpu: r.tpu
}));
const design = tmtTemplate.designs[0].partRoles;
const inactive = new Set([
	'bucket-seat',
	'footrest-front',
	'footrest-rear',
	'rear-caster-left-mcmaster',
	'rear-caster-right-mcmaster',
	'rims-small-1-4',
	'rims-small-2-3'
]);
const fps = new Map((tmtTemplate.printFootprints ?? []).map((f) => [f.slug, seedToFootprint(f)]));
const parts: ArrangePart[] = tmtTemplate.parts
	.filter((p) => !inactive.has(p.slug) && fps.has(p.slug))
	.map((p) => ({
		slug: p.slug,
		name: p.name,
		role: design[p.slug] ?? p.defaultRole,
		footprint: fps.get(p.slug)!,
		units: p.qty ?? 1,
		grams: p.bomGrams,
		group: p.symmetryGroup ? `sym:${p.symmetryGroup}` : null
	}));
const run = (bedX: number, bedY: number, mmSlots: number) => {
	const t0 = performance.now();
	const r = arrange({ parts, roles, printer: { bedX, bedY, margin: 5, spacing: 8, mmSlots } });
	return { ...r, ms: performance.now() - t0 };
};
const oversize = (r: ReturnType<typeof run>) =>
	r.warnings.filter((w) => w.code === 'oversize').map((w) => w.slug);

describe('TMT seed footprints on real beds', () => {
	it('seed covers the kit', () => {
		const missing = tmtTemplate.parts.filter((p) => !fps.has(p.slug)).map((p) => p.slug);
		expect(missing).toEqual([]);
	});

	it('Elegoo Centauri Carbon 256 x 256 with CANVAS 4', () => {
		const r = run(256, 256, 4);
		expect(r.ms).toBeLessThan(1500); // cold JIT under parallel test load; ~220 ms warm with the layout optimiser
		// wings, one-piece footrest and storage need a bigger bed in the H orientation
		expect(oversize(r).sort()).toEqual(
			['footrest', 'storage-left', 'storage-right', 'wing-left', 'wing-right'].sort()
		);
		expect(r.plates.length).toBeGreaterThan(15);
		expect(r.plates.length).toBeLessThan(26);
		for (const p of r.plates) {
			const mats = new Set(p.roles.map((k) => roles.find((x) => x.key === k)!.tpu));
			expect(mats.size).toBe(1);
		}
		// rims are printed twice per plate run
		expect(r.plates.find((p) => p.parts.includes('rims-1-4'))!.runs).toBe(2);
	});

	it('Bambu H2D 350 x 320 fits everything', () => {
		const r = run(350, 320, 4);
		expect(oversize(r)).toEqual([]);
		expect(r.plates.length).toBeLessThan(20);
	});

	it('a 220 x 220 bed leaves many parts over', () => {
		const r = run(220, 220, 1);
		expect(oversize(r).length).toBeGreaterThan(8);
		expect(oversize(r)).toContain('wheel-mount-left');
	});
});
