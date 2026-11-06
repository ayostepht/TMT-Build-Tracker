import { describe, expect, it } from 'vitest';
import { tmtTemplate } from '../server/seed/tmt.ts';
import { buildTimeModel } from './time-estimate.ts';

describe('time model for the MakeGood TMT kit', () => {
	const m = buildTimeModel(tmtTemplate.parts, tmtTemplate.plates, tmtTemplate.variantGroups);
	const rough = (s: string) => m.byPart.get(s)?.rough;

	it('estimates the variant parts that are on no X/P/A plate, as rough', () => {
		for (const s of [
			'bucket-seat',
			'footrest-front',
			'footrest-rear',
			'rims-small-1-4',
			'rear-caster-left-mcmaster'
		]) {
			expect(m.byPart.get(s)?.totalSec, s).toBeGreaterThan(3600);
			expect(rough(s), s).toBe(true);
		}
	});

	it('the two-piece footrest takes about as long as the one-piece', () => {
		const one = m.byPart.get('footrest')!.totalSec;
		const two = m.byPart.get('footrest-front')!.totalSec + m.byPart.get('footrest-rear')!.totalSec;
		expect(two).toBeCloseTo(one, 0);
	});

	it('parts on X/P/A plates are not rough', () => {
		expect(rough('wing-left')).toBe(false);
		expect(rough('tires')).toBe(false);
	});
});
