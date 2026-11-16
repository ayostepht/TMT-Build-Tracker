import { getContext } from 'svelte';

/** Series meaning, never a raw colour: good = kept/finished, bad = failed/lost, neutral = still to do. */
export type Tone = 'good' | 'bad' | 'neutral' | 'accent';

/** CSS colour for a tone, straight from the theme tokens (so light/dark need no code). */
export const toneVar: Record<Tone, string> = {
	good: 'var(--chart-good)',
	bad: 'var(--chart-bad)',
	neutral: 'var(--chart-todo)',
	accent: 'var(--accent)'
};

/** SVG fill for a tone: the failed/lost tone is hatched so colour is never the only cue. */
export function toneFill(tone: Tone, hatchId: string): string {
	return tone === 'bad' ? `url(#${hatchId})` : toneVar[tone];
}

export const CHART_CTX = Symbol('chart-figure');

/** The ids ChartFigure gives its title and summary; a chart's <svg> is labelled by them. */
export function chartLabelledBy(): string | undefined {
	return (getContext(CHART_CTX) as { labelledby: string } | undefined)?.labelledby;
}
