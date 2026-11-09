import { runChoices, type RunChoice } from '#lib/domain/index.ts';
import { filLabel, type BuildCtx } from './build-context.svelte.ts';

/** "Accent" style color label of a part (its filament's name, else the role). */
export function partColor(ctx: BuildCtx, slug: string): string {
	const p = ctx.view.parts.find((x) => x.slug === slug);
	return filLabel(ctx.filament(p?.role ?? ''), p?.name);
}

/** Option text for the run chooser: "Accent · 1 of 2 done". */
export function runOptionLabel(ctx: BuildCtx, c: RunChoice): string {
	const p = ctx.view.parts.find((x) => x.slug === c.slug);
	const done = c.printed ? c.total : c.done;
	return `${p?.name ?? c.slug} · ${partColor(ctx, c.slug)} · ${done} of ${c.total} done`;
}

export { runChoices };
