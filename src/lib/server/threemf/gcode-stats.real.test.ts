// Runs only when TMT_SLICED_3MF points at a sliced project with G-code for every plate (never in git).
// Measures the per-object scan: time, peak memory, and how well the measured objects add up to the plate.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attachGcodeObjectStats } from './gcode-stats';
import { parseThreeMfFile } from './index';

const file = process.env.TMT_SLICED_3MF;
const peakMb = () => Math.round(process.resourceUsage().maxRSS / 1024);

describe.skipIf(!file || !existsSync(file))('real sliced project: per-object G-code scan', () => {
	it('measures every plate cheaply', { timeout: 600_000 }, async () => {
		const s = await parseThreeMfFile(file!);
		const rssBefore = peakMb();
		const t0 = performance.now();
		const rep = await attachGcodeObjectStats(file!, s);
		const ms = Math.round(performance.now() - t0);
		const lines = [
			`gcode scan: ${JSON.stringify(rep)} in ${ms} ms; peak RSS ${peakMb()} MB (before ${rssBefore} MB)`
		];
		for (const p of s.plates) {
			const ex = p.exact ?? [];
			const sum = ex.reduce((a, o) => a + o.seconds, 0);
			lines.push(
				`plate ${p.index}: slicer ${p.estSeconds}s grams=${JSON.stringify(p.filamentGrams)}; objects ${p.objects.map((o) => `${o.name}x${o.count}`).join(', ')}; exact ${ex.map((o) => `${o.name}:${Math.round(o.seconds)}s ${JSON.stringify(o.mm)}`).join(' | ')}; sum ${Math.round(sum)}s`
			);
		}
		console.log(lines.join('\n'));
		expect(rep.plates).toBeGreaterThan(0);
	});
});
