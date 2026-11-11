import { describe, expect, it } from 'vitest';
import type { ArrangedPlate } from '#lib/domain/arrange.ts';
import { buildTimeModel } from '#lib/domain/time-estimate.ts';
import { estimateArrangedPlates } from './time-model.ts';

const model = buildTimeModel(
	[{ slug: 'a', bomGrams: 10, qty: 1 }],
	[{ number: 1, estSeconds: 3600, runs: 1, parts: ['a'] }]
);

describe('estimateArrangedPlates', () => {
	it('falls back to the plate parts when stored arrangement items are not an array', () => {
		const bad = { items: 'oops' } as unknown as ArrangedPlate;
		const out = estimateArrangedPlates(model, [
			{ number: 1, runs: 1, arrangement: bad, parts: ['a'] }
		]);
		expect(out.get(1)).toBeDefined();
	});

	it('also tolerates a missing arrangement and null items', () => {
		const nulls = { items: [null] } as unknown as ArrangedPlate;
		expect(() =>
			estimateArrangedPlates(model, [
				{ number: 1, runs: 1, arrangement: null, parts: ['a'] },
				{ number: 2, runs: 1, arrangement: nulls, parts: ['a'] }
			])
		).not.toThrow();
	});
});
